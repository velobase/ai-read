import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  effectiveBookLanguage,
  sameReadingLanguage,
  translationSource,
  type Book,
  type Position,
  type TranslationCommand,
  type TranslationManifest,
} from '@bypage/reading-core';
import { useLibrary } from '../library-context';
import { useApp } from '../context';
import { useAccount } from '../adapters/account';
import { getTranslationDisplay } from '../adapters/database';
import { subscribeTranslationStore, type TranslationDisplay } from '../adapters/translation-store';
import {
  emptyManifest,
  translationTaskContext,
  readTaskManifest,
  fetchTaskManifest,
  syncTaskTranslations,
} from '../adapters/translation-tasks';

type SavedTranslations = TranslationDisplay['texts'];
const empty: SavedTranslations = {};
/** One server job contract for Web and native. This hook only observes and downloads. */
export function useChapterTranslation(
  book: Book,
  initial: SavedTranslations = empty,
  position: Pick<Position, 'chapter' | 'paragraph' | 'farthest'> = {
    chapter: 0,
    paragraph: book.chapters[0].paragraphs[0].id,
    farthest: 0,
  },
  options: {
    auto?: boolean;
    defaultScope?: 'chapter' | 'book';
    initialKeys?: SavedTranslations;
  } = {},
) {
  const { preferences } = useApp(),
    lease = useLibrary(),
    account = useAccount();
  const language = preferences.language;
  const identity = JSON.stringify([
    lease.handle.key,
    lease.epoch,
    book.id,
    language,
    account.revision,
  ]);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const initialOwner = useRef({ lease, bookId: book.id });
  const [scope, setScope] = useState<'chapter' | 'book'>(options.defaultScope || 'chapter');
  const [data, setData] = useState<{
    identity: string;
    display: TranslationDisplay;
    manifest: TranslationManifest;
    loading: boolean;
    error: string;
  }>(() => ({
    identity,
    display: { texts: initial, keys: options.initialKeys || empty },
    manifest: emptyManifest,
    loading: true,
    error: '',
  }));
  const [busy, setBusy] = useState(false);
  const run = useRef<(command?: TranslationCommand) => Promise<SavedTranslations | null>>(
    async () => null,
  );
  const source = useMemo(() => translationSource(book), [book]);
  const [sourceHash, setSourceHash] = useState('');
  useEffect(() => {
    let live = true;
    void source
      .then((x) => {
        if (live) setSourceHash(x.hash);
      })
      .catch((error) => console.error('translation.source', error));
    return () => {
      live = false;
    };
  }, [source]);
  useEffect(() => {
    let disposed = false,
      prioritized = false,
      waitingCommands = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<SavedTranslations | null> | null = null;
    const controller = new AbortController();
    const current = () => !disposed && lease.isCurrent() && activeIdentity.current === identity;
    const publish = (patch: Partial<typeof data>) => {
      if (current())
        setData((old) => ({
          ...(old.identity === identity
            ? old
            : {
                identity,
                display: { texts: {}, keys: {} },
                manifest: emptyManifest,
                loading: true,
                error: '',
              }),
          ...patch,
          identity,
        }));
    };
    const local = async () => {
      const display = await getTranslationDisplay(lease.handle, book.id);
      publish({ display, loading: false });
      return display.texts;
    };
    const perform = async (command?: TranslationCommand): Promise<SavedTranslations | null> => {
      if (command) {
        setBusy(true);
        publish({ error: '' });
      }
      let delay = 30000;
      try {
        await local();
        if (!current() || AppState.currentState !== 'active') return null;
        if (!account.session) {
          if (command) throw new Error('native_session_required');
          publish({ manifest: emptyManifest, error: '' });
          return null;
        }
        const context = translationTaskContext(lease, controller.signal);
        const cached = await readTaskManifest(context, book.id, language);
        publish({ manifest: cached });
        let manifest = await fetchTaskManifest(context, book, language, command);
        const selected = manifest.editions.find((e) => e.id === manifest.selectedId);
        // Once explicitly started, follow the same current/next-chapter scheduling as Web.
        if (
          !command &&
          !waitingCommands &&
          options.auto &&
          selected &&
          !['paused', 'error'].includes(selected.state) &&
          selected.sourceHash === (await source).hash
        ) {
          const currentChapter = selected.chapters[position.chapter];
          const nextChapter = selected.chapters[position.chapter + 1];
          if (
            currentChapter?.state === 'missing' ||
            nextChapter?.state === 'missing' ||
            (!prioritized && currentChapter && ['queued', 'running'].includes(currentChapter.state))
          ) {
            manifest = await fetchTaskManifest(context, book, language, {
              action: 'prepare',
              editionId: selected.id,
              chapter: position.chapter,
              auto: true,
              prefetch: true,
            });
          }
          prioritized = true;
        }
        delay = manifest.editions.some((e) => e.state === 'active') ? 5000 : 30000;
        publish({ manifest, error: '' });
        const display = await syncTaskTranslations(
          context,
          book,
          language,
          manifest,
          position.chapter,
          async () => {
            await local();
          },
          () => waitingCommands > 0,
        );
        publish({ display, loading: false, error: '' });
        return display.texts;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return null;
        console.error('translation.tasks', error);
        publish({
          loading: false,
          error: error instanceof Error ? error.message : 'translationUnavailable',
        });
        return null;
      } finally {
        if (current()) {
          setBusy(waitingCommands > 0);
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void cycle(), delay);
        }
      }
    };
    // Commands wait for the current request and interrupt further chapter downloads.
    // A polling refresh must never silently discard a pause, retry or edition change.
    const cycle = async (command?: TranslationCommand): Promise<SavedTranslations | null> => {
      if (!current()) return null;
      if (!command && (inFlight || waitingCommands)) return inFlight;
      if (command) {
        waitingCommands++;
        setBusy(true);
        while (inFlight) await inFlight;
        waitingCommands--;
        if (!current()) return null;
      }
      const operation = perform(command);
      inFlight = operation;
      try {
        return await operation;
      } finally {
        if (inFlight === operation) inFlight = null;
      }
    };
    run.current = cycle;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void cycle();
    });
    const unsubscribe = subscribeTranslationStore((handle, bookId) => {
      if (handle === lease.handle && bookId === book.id && current())
        void local().catch((error) => {
          console.error('translation.local', error);
          publish({ error: 'translationLoadError', loading: false });
        });
    });
    setBusy(false);
    void cycle();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      listener.remove();
      unsubscribe();
    };
  }, [identity, lease, book, position.chapter, options.auto, source]);
  const owns = data.identity === identity;
  const display = owns
    ? data.display
    : initialOwner.current.lease === lease && initialOwner.current.bookId === book.id
      ? { texts: initial, keys: options.initialKeys || empty }
      : { texts: empty, keys: empty };
  const manifest = owns ? data.manifest : emptyManifest;
  const edition = manifest.editions.find((e) => e.id === manifest.selectedId);
  const work = manifest.editions[0] || edition;
  const selectedChapters = scope === 'book' ? book.chapters.map((_, i) => i) : [position.chapter];
  const currentChapters =
    work?.sourceHash === sourceHash
      ? work.chapters.filter((c) => selectedChapters.includes(c.index))
      : [];
  const sameLanguage = sameReadingLanguage(effectiveBookLanguage(book), language);
  const command = (command: TranslationCommand) => run.current(command);
  return {
    saved: display.texts,
    savedKeys: display.keys,
    translations: display.texts[language] || empty,
    manifest,
    edition,
    work,
    sourceHash,
    sameLanguage,
    scope,
    setScope,
    busy,
    loading: !owns || data.loading,
    error: owns ? data.error : '',
    ready: sameLanguage
      ? selectedChapters.length
      : currentChapters.filter((c) => c.state === 'ready').length,
    total: selectedChapters.length,
    cached: selectedChapters.filter((i) =>
      book.chapters[i].paragraphs.every((p) => !!display.texts[language]?.[p.id]),
    ).length,
    refresh: () => run.current(),
    start: () =>
      command({
        action: work?.state === 'paused' || work?.state === 'error' ? 'resume' : 'prepare',
        editionId: work?.id,
        chapter: position.chapter,
        scope,
        prefetch: scope !== 'book',
      }),
    stop: () => command({ action: 'pause', editionId: work?.id, chapter: position.chapter }),
    create: () =>
      command({
        action: 'new',
        requestId: Crypto.randomUUID(),
        chapter: position.chapter,
        scope: 'book',
      }),
    select: (editionId: string) =>
      command({ action: 'select', editionId, chapter: position.chapter }),
  };
}
