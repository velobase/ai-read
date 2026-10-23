import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  effectiveBookLanguage,
  sameReadingLanguage,
  savedTranslationKey,
  resolveSavedTranslationIdentity,
  type Book,
  type ReadingScopeParagraph,
} from '@bypage/reading-core';
import { accountRevision, accountSnapshot, subscribeAccount } from './account';
import { checkConnection, normalizeServerOrigin, translateReading } from './api';
import { getTranslationDisplay, saveTranslatedParagraph } from './database';
import {
  subscribeTranslationStore,
  translationStoreRevision,
  type TranslationDisplay,
} from './translation-store';
import type { LibraryHandle, LibraryLease } from './library-scope';
import {
  commitTranslationDraft,
  createTranslationDraftScope,
  loadTranslationDraft,
  saveTranslationDraft,
} from './translation-drafts';

export type SavedTranslations = Record<string, Record<string, string>>;
export type TranslationScope = 'paragraph' | 'chapter' | 'book';
export type TranslationJob = {
  id: number;
  libraryKey: string;
  epoch: number;
  bookId: string;
  title: string;
  language: string;
  sourceLanguage: string;
  scope: TranslationScope;
  firstParagraphId: string;
  lastParagraphId: string;
  busy: boolean;
  done: number;
  total: number;
  ready: number;
  scopeTotal: number;
  characters: number;
  status: 'running' | 'paused' | 'error' | 'complete';
  reason?:
    'user' | 'background' | 'account' | 'environment' | 'batch' | 'configuration' | 'timeout';
  current?: { paragraphId: string; ordinal: number; chapter: string };
  error?: string;
};
type Snapshot = { revision: number; job: TranslationJob | null; lease: LibraryLease | null };
type Run = {
  id: number;
  lease: LibraryLease;
  controller: AbortController;
  accountRevision: number;
  origin: string;
  language: string;
  bookId: string;
  sourceLanguage: string;
  reason?: TranslationJob['reason'];
};
let snapshot: Snapshot = { revision: 0, job: null, lease: null };
const listeners = new Set<() => void>();
const cache = new Map<string, { display: TranslationDisplay; revision: number }>();
const refreshing = new Map<string, Promise<SavedTranslations>>();
let cacheRevision = 0;
let sequence = 0;
let active: Run | null = null;
let environment: { lease: LibraryLease; origin: string; language: string } | null = null;
let observing = false;
const cancelled = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
function publish(job = snapshot.job, lease = snapshot.lease) {
  snapshot = { revision: snapshot.revision + 1, job, lease };
  for (const listener of listeners) listener();
}
const cacheKey = (handle: LibraryHandle, bookId: string) => JSON.stringify([handle.key, bookId]);
function putTranslations(handle: LibraryHandle, bookId: string, display: TranslationDisplay) {
  const key = cacheKey(handle, bookId);
  cache.delete(key);
  cache.set(key, { display, revision: ++cacheRevision });
  // Keep the running book and a small number of recently opened books in memory.
  for (const id of [...cache.keys()]) {
    if (cache.size <= 3) break;
    if (id !== (active && cacheKey(active.lease.handle, active.bookId)) && id !== key)
      cache.delete(id);
  }
  publish();
}
export const translationQueueSnapshot = () => snapshot;
export function subscribeTranslationQueue(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const cachedBookTranslations = (handle: LibraryHandle, bookId: string) =>
  cache.get(cacheKey(handle, bookId))?.display.texts;
export const cachedBookTranslationDisplay = (handle: LibraryHandle, bookId: string) =>
  cache.get(cacheKey(handle, bookId))?.display;
export function refreshBookTranslations(
  handle: LibraryHandle,
  bookId: string,
): Promise<SavedTranslations> {
  const key = cacheKey(handle, bookId);
  const existing = refreshing.get(key);
  if (existing) return existing;
  const request = (async () => {
    // A read started before a commit/selection must never publish its older pair.
    for (;;) {
      const before = translationStoreRevision(handle, bookId);
      const display = await getTranslationDisplay(handle, bookId);
      if (translationStoreRevision(handle, bookId) !== before) continue;
      putTranslations(handle, bookId, display);
      return display.texts;
    }
  })();
  refreshing.set(key, request);
  void request
    .finally(() => {
      if (refreshing.get(key) === request) refreshing.delete(key);
    })
    .catch(() => {});
  return request;
}
subscribeTranslationStore((handle, bookId) => {
  if (
    cache.has(cacheKey(handle, bookId)) ||
    (active?.lease.handle.key === handle.key && active.bookId === bookId)
  )
    void refreshBookTranslations(handle, bookId).catch(() => {});
});
function observeLifecycle() {
  if (observing) return;
  observing = true;
  subscribeAccount(() => {
    if (active && accountRevision() !== active.accountRevision) stop('account');
  });
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') stop('background');
  });
}
function stop(reason: TranslationJob['reason']) {
  if (!active) return;
  active.reason = reason;
  active.controller.abort();
  if (snapshot.job?.id === active.id) publish({ ...snapshot.job, reason });
  // Keep busy until the old request and any guarded SQLite transaction have settled.
}
export function configureTranslationQueue(
  lease: LibraryLease,
  next: { origin: string; language: string },
) {
  if (!lease.isCurrent()) return;
  observeLifecycle();
  let origin = '';
  try {
    origin = normalizeServerOrigin(next.origin);
  } catch {
    /* Invalid settings cannot start a run. */
  }
  environment = { lease, origin, language: next.language };
  if (
    active &&
    (active.lease !== lease || active.origin !== origin || active.language !== next.language)
  )
    stop('environment');
}
export function pauseTranslationQueue(handle: LibraryHandle, bookId?: string) {
  if (active?.lease.handle.key === handle.key && (!bookId || active.bookId === bookId))
    stop('user');
}
export function observeTranslationBook(handle: LibraryHandle, book: Book) {
  if (
    active?.lease.handle.key === handle.key &&
    active.bookId === book.id &&
    active.sourceLanguage !== effectiveBookLanguage(book)
  )
    stop('environment');
}
export function translationBatch(
  entries: readonly ReadingScopeParagraph[],
  texts: Record<string, string>,
) {
  const pending = entries.filter(({ paragraph }) => paragraph.text.trim() && !texts[paragraph.id]);
  const batch: ReadingScopeParagraph[] = [];
  let characters = 0;
  for (const entry of pending) {
    if (batch.length >= 60 || characters + entry.paragraph.text.length > 60000) break;
    batch.push(entry);
    characters += entry.paragraph.text.length;
  }
  return {
    batch,
    characters,
    pending: pending.length,
    ready: entries.length - pending.length,
    total: entries.length,
  };
}
function nextBoundary(text: string, offset: number) {
  let end = Math.min(text.length, offset + 6000);
  if (end < text.length) {
    const boundary = text.lastIndexOf(' ', end - 1);
    if (boundary > end - 800) end = boundary + 1;
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  }
  return end;
}

/** Explicit foreground work only. Mounting a reader or loading a draft never starts requests. */
export async function startTranslationQueue(
  lease: LibraryLease,
  input: {
    book: Book;
    origin: string;
    language: string;
    scope: TranslationScope;
    entries: readonly ReadingScopeParagraph[];
  },
) {
  if (!lease.isCurrent() || active) return;
  configureTranslationQueue(lease, input);
  const { book, language, scope } = input;
  const sourceLanguage = effectiveBookLanguage(book);
  if (sameReadingLanguage(sourceLanguage, language) || !input.entries.length) return;
  let origin = '';
  try {
    origin = normalizeServerOrigin(input.origin);
  } catch {
    /* Show a local setup error below. */
  }
  const entries = [...input.entries]; // Freeze the selected range before any await or reading navigation.
  const selectedIds = new Set(entries.map((entry) => entry.paragraph.id));
  const id = ++sequence;
  const run: Run = {
    id,
    lease,
    controller: new AbortController(),
    accountRevision: accountRevision(),
    origin,
    language,
    bookId: book.id,
    sourceLanguage,
  };
  active = run;
  const abortLease = () => {
    if (active === run) stop('environment');
  };
  lease.signal.addEventListener('abort', abortLease, { once: true });
  const current = () =>
    active === run &&
    lease.isCurrent() &&
    environment?.lease === lease &&
    accountRevision() === run.accountRevision &&
    environment?.origin === origin &&
    environment?.language === language;
  const assertCurrent = () => {
    if (!current() || run.controller.signal.aborted) throw cancelled();
  };
  const guard = { signal: run.controller.signal, isCurrent: current };
  const update = (patch: Partial<TranslationJob>) => {
    if (active === run && snapshot.job?.id === id) publish({ ...snapshot.job, ...patch });
  };
  publish(
    {
      id,
      libraryKey: lease.handle.key,
      epoch: lease.epoch,
      bookId: book.id,
      title: book.title,
      language,
      sourceLanguage,
      scope,
      firstParagraphId: entries[0].paragraph.id,
      lastParagraphId: entries[entries.length - 1].paragraph.id,
      busy: true,
      done: 0,
      total: 0,
      ready: 0,
      scopeTotal: entries.length,
      characters: 0,
      status: 'running',
    },
    lease,
  );
  let done = 0;
  try {
    assertCurrent();
    const account = accountSnapshot();
    if (!origin || account.origin !== origin || account.loading || account.busy)
      throw new Error('translation_connection_required');
    const saved = await refreshBookTranslations(lease.handle, book.id);
    assertCurrent();
    const plan = translationBatch(entries, saved[language] || {});
    update({ total: plan.batch.length, ready: plan.ready, characters: plan.characters });
    if (!plan.batch.length) {
      if (plan.pending) throw new Error('invalid_translation_range');
      update({ status: 'complete' });
      return;
    }
    // Reject unrepresentable/ambiguous exact keys before requesting any translation.
    // These IDs only validate the shape; the atomic writer allocates the saved key.
    for (const entry of plan.batch) {
      const key = savedTranslationKey(language, entry.paragraph.id, Crypto.randomUUID());
      const identity = resolveSavedTranslationIdentity(book, key);
      if (
        !identity ||
        identity.language !== language ||
        identity.paragraphId !== entry.paragraph.id
      )
        throw new Error('invalid_saved_translation');
    }
    const capabilities = await checkConnection(origin, run.controller.signal);
    assertCurrent();
    if (!capabilities.nativeTranslation) throw new Error('native_ai_unavailable');
    const contextKey = capabilities.translationContextKey;
    const draftScope = contextKey
      ? createTranslationDraftScope(book, origin, contextKey, language)
      : null;
    if (contextKey && !draftScope) throw cancelled();
    for (const entry of plan.batch) {
      assertCurrent();
      const paragraph = entry.paragraph;
      update({
        current: { paragraphId: paragraph.id, ordinal: entry.ordinal + 1, chapter: entry.chapter },
        done,
      });
      if (cachedBookTranslations(lease.handle, book.id)?.[language]?.[paragraph.id]) {
        done++;
        update({ done, ready: plan.ready + done });
        continue;
      }
      const chapter = book.chapters[entry.chapterIndex];
      const index = chapter.paragraphs.findIndex((item) => item.id === paragraph.id);
      const sources = chapter.paragraphs
        .slice(Math.max(0, index - 1), index + 2)
        .filter((item) => scope !== 'chapter' || selectedIds.has(item.id))
        .map((item) => ({
          id: item.id,
          chapter: chapter.title.slice(0, 200),
          text: item.text.slice(0, 4000),
        }));
      const draft = draftScope
        ? await loadTranslationDraft(lease.handle, book, paragraph.id, draftScope, guard)
        : null;
      let parts = draft ? [...draft.parts] : [];
      let offset = parts[parts.length - 1]?.end || 0;
      while (offset < paragraph.text.length) {
        assertCurrent();
        const end = nextBoundary(paragraph.text, offset);
        const timer = setTimeout(() => {
          if (!run.controller.signal.aborted) {
            run.reason = 'timeout';
            run.controller.abort();
          }
        }, 120000);
        let text: string;
        try {
          text = await translateReading(
            origin,
            {
              title: book.title,
              bookLanguage: sourceLanguage,
              language,
              target: paragraph.text.slice(offset, end),
              sources,
              ...(contextKey ? { translationContextKey: contextKey } : {}),
            },
            run.controller.signal,
          );
        } finally {
          clearTimeout(timer);
        }
        assertCurrent();
        const nextParts = [...parts, { start: offset, end, text }];
        if (
          nextParts.reduce((length, part) => length + part.text.length, 0) +
            (nextParts.length - 1) * 2 >
          100000
        )
          throw new Error('response_too_large');
        if (draftScope) {
          const stored = await saveTranslationDraft(
            lease.handle,
            book,
            paragraph.id,
            draftScope,
            nextParts,
            guard,
          );
          parts = stored.parts;
        } else parts = nextParts;
        offset = parts[parts.length - 1].end;
      }
      assertCurrent();
      if (draftScope)
        await commitTranslationDraft(lease.handle, book, paragraph.id, draftScope, guard);
      else
        await saveTranslatedParagraph(
          lease.handle,
          book,
          language,
          paragraph.id,
          parts.map((part) => part.text).join('\n\n'),
          guard,
        );
      // A complete local paragraph is retained even if pause arrives just after its commit.
      await refreshBookTranslations(lease.handle, book.id);
      assertCurrent();
      done++;
      update({ done, ready: plan.ready + done });
    }
    const remaining = translationBatch(
      entries,
      cachedBookTranslations(lease.handle, book.id)?.[language] || {},
    ).pending;
    update({
      status: remaining ? 'paused' : 'complete',
      ...(remaining ? { reason: 'batch' as const } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'translation_failed';
    const configurationChanged = message === 'native_translation_configuration_changed';
    update({
      status:
        run.controller.signal.aborted || !lease.isCurrent() || configurationChanged
          ? 'paused'
          : 'error',
      reason: configurationChanged ? 'configuration' : run.reason,
      ...(run.controller.signal.aborted ? {} : { error: message.slice(0, 500) }),
    });
  } finally {
    lease.signal.removeEventListener('abort', abortLease);
    update({ busy: false });
    if (active === run) active = null;
  }
}
