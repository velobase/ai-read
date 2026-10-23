import { accountRevision, subscribeAccount, useAccount } from '../adapters/account';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Book, NoteAnchor, Position, ReadingScope } from '@bypage/reading-core';
import { effectiveBookLanguage, readingScopeParagraphs } from '@bypage/reading-core';
import type { MobileCapabilities } from '@bypage/api-client';
import { apiOrigin, askReading, checkConnection } from '../adapters/api';
import {
  assistantHistoryPartition,
  captureAssistantHistoryFocus,
  hydrateAssistantHistoryTurn,
  listAssistantHistory,
  markAssistantTurnSaved,
  sameAssistantHistoryPartition,
  saveAssistantTurn,
  type AssistantHistoryCursor,
  type AssistantHistoryPartition,
  type AssistantHistoryTurn,
} from '../adapters/assistant-history';
import { readExactTranslation, readExactTranslations } from '../adapters/database';
import {
  originalEvidenceWindow,
  readingEvidence,
  validEvidenceSelection,
  type EvidenceSource,
} from '../adapters/reading-evidence';
import { shareAssistantAnswer } from '../adapters/assistant-share';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import type { LibraryLease } from '../adapters/library-scope';
import { Button, Chip, Sheet, styles } from './ui';
import type { PassageSelection } from './passage';
import { FormattedAnswer } from './formatted-answer';

type Turn = {
  lease: LibraryLease;
  record: AssistantHistoryTurn;
  sources: EvidenceSource[];
  focus: PassageSelection | null;
  pending: boolean;
  persisted: boolean;
  saveError?: boolean;
};
const identityKey = (partition: AssistantHistoryPartition) =>
  JSON.stringify([partition.origin, partition.accountId]);
const scopeKeys = { chapter: 'aiScopeChapter', read: 'aiScopeRead', book: 'aiScopeBook' } as const;
function citedSources(turn: Turn) {
  const allowed = new Map(
    turn.sources.flatMap((source) => [
      [source.id, source.id],
      [`${source.chapter}.${source.id}`, source.id],
      [`${source.chapter.slice(0, 200)}.${source.id}`, source.id],
    ]),
  );
  const cited = new Set<string>();
  // Link labels/reference definitions are Markdown, not reading-source citations.
  const answer = turn.record.answer
    .replace(/!?\[[^\]\r\n]*\]\s*(?:\([^\r\n)]*\)|\[[^\]\r\n]*\])/gu, '')
    .replace(/^\s{0,3}\[[^\]\r\n]+\]:[^\r\n]*/gmu, '')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/giu, '');
  for (const match of answer.matchAll(/\[([^\[\]\r\n]+)\]/gu)) {
    if (answer[match.index - 1] === '!') continue;
    const content = match[1].trim();
    for (const token of allowed.has(content)
      ? [content]
      : content.split(/[,，;；]/u).map((part) => part.trim())) {
      const id = allowed.get(token);
      if (id) cited.add(id);
    }
  }
  return turn.sources.filter((source) => cited.has(source.id));
}

export function AssistantSheet({
  book,
  position,
  focus,
  visible,
  onShow,
  onDismiss,
  close,
  open,
  save,
}: {
  book: Book;
  position: Position;
  focus: PassageSelection;
  visible: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  close: () => void;
  open: (
    chapter: number,
    paragraph: string,
    anchor: NoteAnchor,
    signal: AbortSignal,
  ) => Promise<boolean>;
  save: (answer: string, focus: PassageSelection) => Promise<boolean>;
}) {
  const { colors, preferences, t, openAccount } = useApp();
  const lease = useLibrary();
  const account = useAccount();
  const origin = apiOrigin;
  const [capabilities, setCapabilities] = useState<MobileCapabilities | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<ReadingScope>('chapter');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoadedIdentity, setHistoryLoadedIdentity] = useState<{
    lease: LibraryLease;
    bookId: string;
    identity: string;
  } | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [cursor, setCursor] = useState<AssistantHistoryCursor | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [openingCitation, setOpeningCitation] = useState<string | null>(null);
  const [citationError, setCitationError] = useState<string | null>(null);
  const citationOperation = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentScope = useRef({ lease, bookId: book.id });
  currentScope.current = { lease, bookId: book.id };
  const connectionSequence = useRef(0);
  const historySequence = useRef(0);
  const writes = useRef(new Map<string, Promise<void>>());
  const savingRef = useRef(false);
  const sharingRef = useRef(false);
  const scrollView = useRef<ScrollView | null>(null);
  const turnOffsets = useRef(new Map<string, number>());
  const pendingScroll = useRef<string | null>(null);
  const browsingRevision = useRef(0);
  const isVisible = useRef(visible);
  isVisible.current = visible;
  const partition = assistantHistoryPartition(origin, capabilities?.aiContextKey);
  const identity = partition ? identityKey(partition) : null;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const focusEntry = useMemo(() => {
    for (const [chapterIndex, chapter] of book.chapters.entries()) {
      const paragraph = chapter.paragraphs.find((item) => item.id === focus.paragraph.id);
      if (paragraph) return { paragraph, chapterIndex };
    }
    return null;
  }, [book, focus.paragraph.id]);
  // A page can contain two PDF chapters, and a scroll viewport can span chapters.
  // Explicitly asking about a visible passage must use that passage's chapter.
  // The read-only scope still keeps its existing progress boundary.
  const evidencePosition = useMemo(
    () =>
      focusEntry && scope !== 'read'
        ? { ...position, chapter: focusEntry.chapterIndex, paragraph: focusEntry.paragraph.id }
        : position,
    [focusEntry, position, scope],
  );
  const entries = useMemo(
    () => (visible ? readingScopeParagraphs(book, evidencePosition, scope) : []),
    [book, evidencePosition, scope, visible],
  );
  const allowedIds = useMemo(() => new Set(entries.map((entry) => entry.paragraph.id)), [entries]);
  const selected = useMemo<PassageSelection | null>(() => {
    if (
      focusEntry &&
      allowedIds.has(focus.paragraph.id) &&
      validEvidenceSelection(focus) &&
      focus.paragraph.text === focusEntry.paragraph.text &&
      (focus.source === 'original'
        ? focus.text === focusEntry.paragraph.text
        : focus.source === 'translation' &&
          !!focus.language &&
          /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(focus.language))
    )
      return focus;
    // Never silently replace an invalid explicit selection with another passage.
    return null;
  }, [allowedIds, focusEntry, focus]);
  const selectionError = !selected
    ? 'aiSelectionUnavailable'
    : selected.end - selected.start > 4000
      ? 'aiSelectionTooLong'
      : null;
  const visibleTurns = turns.filter(
    (turn) =>
      turn.lease === lease &&
      turn.record.bookId === book.id &&
      identityKey(turn.record.partition) === identity,
  );
  const historyLoadedHere =
    historyLoadedIdentity?.lease === lease &&
    historyLoadedIdentity.bookId === book.id &&
    historyLoadedIdentity.identity === identity;
  const historyReady = !!identity && historyLoadedHere && !historyLoading && !historyError;

  function ownsView() {
    return (
      mounted.current &&
      lease.isCurrent() &&
      currentScope.current.lease === lease &&
      currentScope.current.bookId === book.id
    );
  }
  function ownsTurn(turn: Turn) {
    return (
      ownsView() &&
      turn.lease === lease &&
      turn.record.bookId === book.id &&
      identityKey(turn.record.partition) === currentIdentity.current
    );
  }
  function scrollToTurn(id: string) {
    if (!ownsView()) return;
    Keyboard.dismiss();
    pendingScroll.current = id;
    requestAnimationFrame(() => {
      if (!ownsView() || !isVisible.current || pendingScroll.current !== id) return;
      const y = turnOffsets.current.get(id);
      if (y === undefined || !scrollView.current) return;
      pendingScroll.current = null;
      scrollView.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
    });
  }
  function beganBrowsing() {
    browsingRevision.current++;
    pendingScroll.current = null;
  }

  function replaceTurn(id: string, change: (turn: Turn) => Turn) {
    if (ownsView())
      setTurns((old) => old.map((turn) => (turn.record.id === id ? change(turn) : turn)));
  }
  async function persist(turn: Turn) {
    // A terminal answer may flush after its lease is revoked, always into its captured database.
    const writeKey = JSON.stringify([turn.lease.handle.key, turn.record.bookId, turn.record.id]);
    const existing = writes.current.get(writeKey);
    if (existing) return existing;
    const task = (async () => {
      try {
        const stored = await saveAssistantTurn(turn.lease.handle, book, turn.record);
        replaceTurn(stored.id, (current) => ({
          ...current,
          record: stored,
          persisted: true,
          saveError: false,
        }));
      } catch {
        replaceTurn(turn.record.id, (current) => ({
          ...current,
          persisted: false,
          saveError: true,
        }));
      }
    })();
    writes.current.set(writeKey, task);
    try {
      await task;
    } finally {
      if (writes.current.get(writeKey) === task) writes.current.delete(writeKey);
    }
  }
  async function loadHistory(older = false) {
    const captured = assistantHistoryPartition(origin, capabilities?.aiContextKey);
    if (!ownsView() || !captured || (older && (!cursor || !historyLoadedHere))) return;
    if (older) beganBrowsing();
    const key = identityKey(captured);
    const ticket = ++historySequence.current;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      await Promise.allSettled([...writes.current.values()]);
      if (!ownsView() || ticket !== historySequence.current || currentIdentity.current !== key)
        return;
      const page = await listAssistantHistory(lease.handle, book, {
        identity: captured,
        ...(older && cursor ? { before: cursor } : {}),
        limit: 20,
      });
      const translations: Record<string, string> = Object.create(null);
      const exact = await readExactTranslations(lease.handle, book.id, [
        ...new Set(
          page.turns.flatMap((turn) =>
            turn.focus.source === 'translation' ? [turn.focus.translationKey] : [],
          ),
        ),
      ]);
      for (const version of Object.values(exact)) translations[version.key] = version.text;
      if (!ownsView() || ticket !== historySequence.current || currentIdentity.current !== key)
        return;
      const loaded: Turn[] = page.turns.map((record) => ({
        lease,
        record,
        ...hydrateAssistantHistoryTurn(book, record, translations),
        pending: false,
        persisted: true,
      }));
      setTurns((old) => {
        // Preserve in-flight or unsaved answers during a reload/Fast Refresh.
        const items = new Map(
          old
            .filter(
              (turn) =>
                turn.lease === lease &&
                turn.record.bookId === book.id &&
                identityKey(turn.record.partition) === key &&
                (older || turn.pending || !turn.persisted),
            )
            .map((turn) => [turn.record.id, turn]),
        );
        for (const turn of loaded) {
          const previous = items.get(turn.record.id);
          if (!previous?.pending && !previous?.saveError)
            items.set(
              turn.record.id,
              previous?.record.saved ? { ...turn, record: { ...turn.record, saved: true } } : turn,
            );
        }
        return [...items.values()].sort(
          (a, b) =>
            a.record.createdAt - b.record.createdAt || a.record.id.localeCompare(b.record.id),
        );
      });
      setCursor(page.nextCursor);
      setHistoryLoadedIdentity({ lease, bookId: book.id, identity: key });
    } catch {
      if (ownsView() && ticket === historySequence.current && currentIdentity.current === key)
        setHistoryError(true);
    } finally {
      if (ownsView() && ticket === historySequence.current) setHistoryLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let revision = accountRevision();
    const unsubscribe = subscribeAccount(() => {
      if (revision !== accountRevision()) {
        revision = accountRevision();
        operation.current?.abort();
        citationOperation.current?.abort();
        connectionSequence.current++;
      }
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        operation.current?.abort();
        citationOperation.current?.abort();
      }
    });
    return () => {
      mounted.current = false;
      historySequence.current++;
      connectionSequence.current++;
      operation.current?.abort();
      citationOperation.current?.abort();
      subscription.remove();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const revoke = () => {
      historySequence.current++;
      connectionSequence.current++;
      operation.current?.abort();
      citationOperation.current?.abort();
      pendingScroll.current = null;
    };
    lease.signal.addEventListener('abort', revoke, { once: true });
    if (!lease.isCurrent()) revoke();
    return () => {
      lease.signal.removeEventListener('abort', revoke);
      revoke();
    };
  }, [lease, book.id]);
  useEffect(() => {
    if (!visible || !identity || !lease.isCurrent()) return;
    void loadHistory();
    return () => {
      historySequence.current++;
    };
  }, [lease, book.id, visible, identity]);
  useEffect(() => {
    operation.current?.abort();
    citationOperation.current?.abort();
    setError('');
  }, [origin, account.revision]);
  useEffect(() => {
    operation.current?.abort();
    setError('');
  }, [
    book.id,
    scope,
    focus.paragraph.id,
    focus.source,
    focus.language,
    focus.translationKey,
    focus.text,
    focus.start,
    focus.end,
  ]);
  useEffect(() => {
    citationOperation.current?.abort();
    citationOperation.current = null;
    setOpeningCitation(null);
    setCitationError(null);
    if (!visible || !lease.isCurrent()) {
      operation.current?.abort();
      pendingScroll.current = null;
      turnOffsets.current.clear();
      return;
    }
    if (account.loading || account.busy) return;
    let alive = true;
    const controller = new AbortController();
    setCapabilities(null);
    setConnecting(Boolean(origin));
    if (origin)
      void checkConnection(origin, controller.signal)
        .then((value) => {
          if (alive && ownsView()) setCapabilities(value);
        })
        .catch(() => {
          if (alive && ownsView()) setError(t('serverUnavailable'));
        })
        .finally(() => {
          if (alive && ownsView()) setConnecting(false);
        });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [lease, visible, origin, account.revision, account.loading, account.busy]);

  const closeSheet = () => {
    operation.current?.abort();
    citationOperation.current?.abort();
    close();
  };
  async function readCitation(source: EvidenceSource, key: string) {
    if (!ownsView() || citationOperation.current) return;
    const controller = new AbortController();
    citationOperation.current = controller;
    setOpeningCitation(key);
    setCitationError(null);
    try {
      const opened = await open(
        source.chapterIndex,
        source.id,
        { source: 'original', start: source.start, end: source.start + source.text.length },
        controller.signal,
      );
      if (!opened && !controller.signal.aborted && ownsView()) setCitationError(key);
    } catch {
      if (!controller.signal.aborted && ownsView()) setCitationError(key);
    } finally {
      if (citationOperation.current === controller) {
        citationOperation.current = null;
        if (ownsView()) setOpeningCitation(null);
      }
    }
  }
  async function connect() {
    if (!ownsView()) return;
    const ticket = ++connectionSequence.current;
    const revision = accountRevision();
    const owns = () =>
      ownsView() && ticket === connectionSequence.current && revision === accountRevision();
    setConnecting(true);
    setError('');
    try {
      const next = await checkConnection(origin);
      if (!owns()) return;
      setCapabilities(next);
    } catch {
      if (owns()) setError(t('serverUnavailable'));
    } finally {
      if (ownsView() && ticket === connectionSequence.current) setConnecting(false);
    }
  }
  async function send(value = question) {
    const capturedPartition = assistantHistoryPartition(origin, capabilities?.aiContextKey);
    if (
      !ownsView() ||
      !value.trim() ||
      busy ||
      operation.current ||
      !capabilities?.nativeAI ||
      !historyReady ||
      !capturedPartition ||
      !selected ||
      selectionError ||
      !entries.length
    )
      return;
    Keyboard.dismiss();
    const controller = new AbortController();
    operation.current = controller;
    const revision = accountRevision();
    const key = identityKey(capturedPartition);
    const browsingAtSend = browsingRevision.current;
    const owns = () =>
      ownsView() &&
      operation.current === controller &&
      revision === accountRevision() &&
      currentIdentity.current === key;
    setBusy(true);
    // Translation selections belong to the exact local language/paragraph cache.
    // Do not attach an old quote to a replacement translation or use original text
    // as a stand-in when that cache disappeared while the selection was open.
    if (selected.source === 'translation') {
      try {
        const version = selected.translationKey
          ? await readExactTranslation(lease.handle, book.id, selected.translationKey)
          : null;
        if (!owns() || controller.signal.aborted) throw new Error('cancelled');
        if (
          !version ||
          version.language !== selected.language ||
          version.paragraphId !== selected.paragraph.id ||
          version.text !== selected.text
        )
          throw new Error('selection_changed');
      } catch {
        if (owns() && !controller.signal.aborted) setError(t('aiSelectionUnavailable'));
        if (operation.current === controller) {
          operation.current = null;
          if (ownsView()) setBusy(false);
        }
        return;
      }
    }
    const createdAt = Date.now();
    let turn: Turn;
    try {
      turn = {
        lease,
        record: {
          id: Crypto.randomUUID(),
          bookId: book.id,
          createdAt,
          updatedAt: createdAt,
          partition: capturedPartition,
          ...(capabilities.aiModel ? { model: capabilities.aiModel.slice(0, 200) } : {}),
          scope,
          question: value.trim().slice(0, 3000),
          answer: '',
          status: 'stopped',
          saved: false,
          focus: captureAssistantHistoryFocus(selected),
          sources: [],
        },
        sources: [],
        focus: selected,
        pending: true,
        persisted: false,
      };
    } catch {
      operation.current = null;
      setBusy(false);
      setError(t('aiFocusUnavailable'));
      return;
    }
    setBusy(true);
    setError('');
    setQuestion('');
    setTurns((old) => [
      ...old.filter(
        (item) =>
          item.lease === lease &&
          item.record.bookId === book.id &&
          identityKey(item.record.partition) === key,
      ),
      turn,
    ]);
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const evidence = await readingEvidence(
        entries,
        evidencePosition,
        selected,
        value,
        controller.signal,
      );
      if (!owns() || controller.signal.aborted) throw new Error('cancelled');
      turn = {
        ...turn,
        sources: evidence.sources,
        record: {
          ...turn.record,
          sources: evidence.sources.map((source) => ({
            paragraphId: source.id,
            start: source.start,
            end: source.start + source.text.length,
          })),
          context: { totalParagraphs: evidence.totalParagraphs, partial: evidence.partial },
        },
      };
      replaceTurn(turn.record.id, () => turn);
      const answer = await askReading(
        origin,
        {
          title: book.title,
          bookLanguage: effectiveBookLanguage(book),
          language: preferences.locale === 'zh-CN' ? 'Simplified Chinese' : 'English',
          question: turn.record.question,
          selection: selected.text.slice(selected.start, selected.end),
          readingPassage:
            evidence.sources.find((source) => source.id === selected.paragraph.id)?.text ||
            originalEvidenceWindow(
              selected.paragraph.text,
              selected.source === 'original' ? selected : undefined,
            ).text,
          scope,
          context: turn.record.context,
          ...(capturedPartition.contextKey ? { aiContextKey: capturedPartition.contextKey } : {}),
          sources: evidence.sources.map(({ id, text, chapter }) => ({ id, text, chapter })),
          history: visibleTurns
            .filter(
              (item) =>
                item.record.status === 'complete' &&
                !item.pending &&
                !!item.record.answer.trim() &&
                item.record.sources.length > 0 &&
                sameAssistantHistoryPartition(item.record.partition, capturedPartition) &&
                item.record.sources.every((source) => allowedIds.has(source.paragraphId)),
            )
            .slice(-3)
            .flatMap((item) => [
              { role: 'user' as const, content: item.record.question },
              { role: 'assistant' as const, content: item.record.answer.slice(0, 4000) },
            ]),
        },
        controller.signal,
        (answer) => {
          turn = { ...turn, record: { ...turn.record, answer } };
          if (owns()) replaceTurn(turn.record.id, () => turn);
        },
      );
      turn = { ...turn, record: { ...turn.record, answer, status: 'complete' } };
    } catch (failure) {
      turn = {
        ...turn,
        record: { ...turn.record, status: controller.signal.aborted ? 'stopped' : 'error' },
      };
      if (owns()) {
        setQuestion(value);
        if (failure instanceof Error && failure.message === 'native_ai_configuration_changed') {
          setCapabilities(null);
          setConnecting(true);
          setError(t('aiConfigurationChanged'));
          // A changed provider/model requires a fresh, explicit Send with a new history partition.
          try {
            const next = await checkConnection(origin, controller.signal);
            if (owns()) setCapabilities(next);
          } catch {
            /* Keep the question and the visible configuration-change explanation. */
          } finally {
            if (owns()) setConnecting(false);
          }
        } else
          setError(
            controller.signal.aborted
              ? t('aiStopped')
              : failure instanceof Error &&
                  ![
                    'Network request failed',
                    'incomplete_response',
                    'empty_response',
                    'cancelled',
                  ].includes(failure.message)
                ? failure.message
                : t('aiError'),
          );
      }
    } finally {
      clearTimeout(timer);
      turn = { ...turn, pending: false };
      // The captured partition survives account switches and unmount. Persist once, never per token.
      replaceTurn(turn.record.id, () => turn);
      await persist(turn);
      if (
        owns() &&
        !controller.signal.aborted &&
        isVisible.current &&
        turn.record.status === 'complete' &&
        browsingRevision.current === browsingAtSend
      ) {
        scrollToTurn(turn.record.id);
      }
      if (operation.current === controller) {
        operation.current = null;
        if (ownsView()) setBusy(false);
      }
    }
  }
  async function saveThought(turn: Turn) {
    if (!ownsTurn(turn) || savingRef.current) return;
    if (!turn.focus || turn.record.answer.length > 50000) {
      setActionError({
        id: turn.record.id,
        text: t(turn.focus ? 'aiThoughtTooLong' : 'aiFocusUnavailable'),
      });
      return;
    }
    savingRef.current = true;
    setSaving(turn.record.id);
    setActionError(null);
    try {
      if (!(await save(turn.record.answer, turn.focus))) throw new Error('note_not_saved');
      replaceTurn(turn.record.id, (item) => ({ ...item, record: { ...item.record, saved: true } }));
      try {
        await markAssistantTurnSaved(turn.lease.handle, turn.record.bookId, turn.record.id);
      } catch {
        if (ownsView()) setActionError({ id: turn.record.id, text: t('aiHistorySaveStateError') });
      }
    } catch {
      if (ownsView()) setActionError({ id: turn.record.id, text: t('noteSavedError') });
    } finally {
      savingRef.current = false;
      if (ownsView()) setSaving(null);
    }
  }
  async function shareTurn(turn: Turn) {
    if (!ownsTurn(turn) || sharingRef.current) return;
    sharingRef.current = true;
    const revision = accountRevision();
    const isCurrent = () => ownsTurn(turn) && isVisible.current && revision === accountRevision();
    setSharing(turn.record.id);
    setActionError(null);
    try {
      await shareAssistantAnswer(
        lease,
        {
          bookTitle: book.title,
          question: turn.record.question,
          answer: turn.record.answer,
          createdAt: turn.record.createdAt,
          scope: turn.record.scope,
          status: turn.record.status,
          sources: turn.sources,
          locale: preferences.locale,
        },
        isCurrent,
      );
    } catch {
      if (ownsView()) setActionError({ id: turn.record.id, text: t('aiExportError') });
    } finally {
      sharingRef.current = false;
      if (ownsView()) setSharing(null);
    }
  }
  return (
    <Sheet
      visible={visible}
      onShow={onShow}
      onDismiss={onDismiss}
      title={t('aiCompanion')}
      close={closeSheet}
      scrollRef={scrollView}
      onScrollBeginDrag={beganBrowsing}
      tall
    >
      {!!visibleTurns.length && (
        <Button
          secondary
          icon="arrow-down"
          onPress={() => scrollToTurn(visibleTurns[visibleTurns.length - 1].record.id)}
        >
          {t('aiLatestAnswer')}
        </Button>
      )}
      {!capabilities?.nativeAI && (
        <>
          <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('nativeAiSetup')}</Text>
          {account.session ? (
            <Button busy={connecting} onPress={() => void connect()}>
              {t('retry')}
            </Button>
          ) : (
            <Button
              icon="person-outline"
              onPress={() => {
                closeSheet();
                openAccount();
              }}
            >
              {t('accountConnect')}
            </Button>
          )}
          {capabilities && !capabilities.nativeAI && (
            <Text style={{ color: colors.muted }}>{t('nativeAiUnavailable')}</Text>
          )}
        </>
      )}
      {capabilities?.nativeAI && (
        <>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{capabilities.aiModel}</Text>
          <Text style={{ color: colors.ink, fontWeight: '600' }}>{t('aiScope')}</Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {(['chapter', 'read', 'book'] as const).map((item) => (
              <Chip
                key={item}
                active={scope === item}
                onPress={() => {
                  if (!busy) setScope(item);
                }}
              >
                {t(scopeKeys[item])}
              </Chip>
            ))}
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
            {t('aiScopeHint', { count: entries.length })}
          </Text>
          {!!selected && (
            <Text numberOfLines={4} style={{ color: colors.ink, lineHeight: 24, fontSize: 14 }}>
              {selected.text.slice(selected.start, selected.end)}
            </Text>
          )}
          {!!selectionError && (
            <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
              {t(selectionError)}
            </Text>
          )}
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
            {t('aiPrivacy')}
          </Text>
          <TextInput
            accessibilityLabel={t('aiQuestion')}
            value={question}
            onChangeText={setQuestion}
            multiline
            maxLength={3000}
            placeholder={t('aiQuestion')}
            placeholderTextColor={colors.muted}
            style={[styles.input, { color: colors.ink, borderColor: colors.border, minHeight: 78 }]}
          />
          {busy ? (
            <Button secondary onPress={() => operation.current?.abort()}>
              {t('aiStop')}
            </Button>
          ) : (
            <Button
              disabled={!question.trim() || !historyReady || !!selectionError}
              icon="arrow-up"
              onPress={() => void send()}
            >
              {t('aiSend')}
            </Button>
          )}
          {!visibleTurns.length && (
            <Button
              secondary
              disabled={!historyReady || busy || !!selectionError}
              onPress={() => void send(t('aiExplainPrompt'))}
            >
              {t('aiExplain')}
            </Button>
          )}
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 23 }}>
          {error}
        </Text>
      )}
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
        {t('aiHistoryLocal')}
      </Text>
      {!!partition && (
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
          {partition.origin} ·{' '}
          {account.session?.user.name || account.session?.user.email || t('aiGuest')}
        </Text>
      )}
      {((historyLoading && !!identity) || account.loading || account.busy) && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.muted }}>{t('aiHistoryLoading')}</Text>
        </View>
      )}
      {historyError && (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {t('aiHistoryLoadError')}
          </Text>
          <Button secondary onPress={() => void loadHistory()}>
            {t('retry')}
          </Button>
        </>
      )}
      {!!cursor && historyLoadedHere && (
        <Button secondary busy={historyLoading} onPress={() => void loadHistory(true)}>
          {t('aiHistoryOlder')}
        </Button>
      )}
      {visible &&
        visibleTurns.map((turn) => {
          const record = turn.record;
          const citations = citedSources(turn);
          return (
            <View
              key={record.id}
              onLayout={(event) => {
                turnOffsets.current.set(record.id, event.nativeEvent.layout.y);
                if (pendingScroll.current === record.id) scrollToTurn(record.id);
              }}
              style={{ gap: 14, paddingTop: 16, borderTopWidth: 0.5, borderColor: colors.border }}
            >
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
                {new Date(record.createdAt).toLocaleString(preferences.locale)} ·{' '}
                {t(scopeKeys[record.scope])}
                {record.model ? ` · ${record.model}` : ''}
              </Text>
              <Text style={{ color: colors.ink, fontWeight: '600', lineHeight: 24 }}>
                {record.question}
              </Text>
              {record.answer ? (
                <FormattedAnswer text={record.answer} />
              ) : turn.pending ? (
                <ActivityIndicator color={colors.accent} />
              ) : null}
              {!turn.pending && record.status !== 'complete' && (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {t(record.answer ? 'aiPartial' : 'aiNoAnswer')}
                </Text>
              )}
              {!!record.sources.length && (
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
                  {record.context
                    ? t(record.context.partial ? 'aiContextPartial' : 'aiContextComplete', {
                        included: record.sources.length,
                        total: record.context.totalParagraphs,
                      })
                    : t('aiContextSources', { included: record.sources.length })}
                </Text>
              )}
              {citations.length > 0 && (
                <Text style={{ color: colors.muted, fontSize: 12 }}>{t('aiSources')}</Text>
              )}
              {citations.map((source) => (
                <Pressable
                  accessibilityRole="button"
                  key={source.id}
                  disabled={openingCitation !== null}
                  accessibilityState={{ disabled: openingCitation !== null }}
                  onPress={() => void readCitation(source, `${record.id}:${source.id}`)}
                  style={{ padding: 12, backgroundColor: colors.soft, borderRadius: 10 }}
                >
                  <Text style={{ color: colors.accent, fontSize: 13 }}>
                    [{source.id}] {source.chapter}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}
                  >
                    {source.text}
                  </Text>
                  {openingCitation === `${record.id}:${source.id}` && (
                    <ActivityIndicator color={colors.accent} />
                  )}
                  {citationError === `${record.id}:${source.id}` && (
                    <Text
                      accessibilityRole="alert"
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.error, fontSize: 12, lineHeight: 20, marginTop: 8 }}
                    >
                      {t('aiCitationPositionError')}
                    </Text>
                  )}
                </Pressable>
              ))}
              {turn.saveError && (
                <>
                  <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
                    {t('aiHistorySaveError')}
                  </Text>
                  <Button secondary onPress={() => void persist(turn)}>
                    {t('aiHistoryRetrySave')}
                  </Button>
                </>
              )}
              {!turn.pending && record.status === 'complete' && (
                <>
                  {!turn.focus && (
                    <Text style={{ color: colors.muted, lineHeight: 22 }}>
                      {t('aiFocusUnavailable')}
                    </Text>
                  )}
                  {record.answer.length > 50000 && (
                    <Text style={{ color: colors.muted, lineHeight: 22 }}>
                      {t('aiThoughtTooLong')}
                    </Text>
                  )}
                  <Button
                    secondary
                    disabled={
                      record.saved ||
                      saving !== null ||
                      !turn.focus ||
                      !turn.persisted ||
                      record.answer.length > 50000
                    }
                    busy={saving === record.id}
                    onPress={() => void saveThought(turn)}
                  >
                    {t(record.saved ? 'saved' : 'aiSave')}
                  </Button>
                </>
              )}
              {!turn.pending && !!record.answer && (
                <Button
                  secondary
                  disabled={sharing !== null}
                  busy={sharing === record.id}
                  icon="share-outline"
                  onPress={() => void shareTurn(turn)}
                >
                  {t('aiExport')}
                </Button>
              )}
              {!turn.pending && record.status !== 'complete' && (
                <Button secondary disabled={busy} onPress={() => setQuestion(record.question)}>
                  {t('aiUseQuestion')}
                </Button>
              )}
              {actionError?.id === record.id && (
                <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
                  {actionError.text}
                </Text>
              )}
            </View>
          );
        })}
    </Sheet>
  );
}
