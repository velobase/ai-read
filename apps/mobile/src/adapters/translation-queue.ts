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
import { getTranslationDisplay } from './database';
import { hydrateSavedTranslationChapters } from './saved-editions';
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
export type ReadingTranslationStatus = 'idle' | 'loading' | 'offline' | 'error';
type Snapshot = {
  revision: number;
  lease: LibraryLease | null;
  bookId: string | null;
  language: string | null;
  status: ReadingTranslationStatus;
  loading: boolean;
  online: boolean;
  error: string | null;
  currentParagraphId?: string;
};
type Demand = {
  owner: symbol;
  lease: LibraryLease;
  book: Book;
  origin: string;
  language: string;
  sourceLanguage: string;
  entries: readonly ReadingScopeParagraph[];
  accountRevision: number;
  failures: number;
  retryAt: number;
  online: boolean;
  blocked: boolean;
  error: string | null;
  hydratedChapters: Set<number>;
};
type Run = {
  id: number;
  demand: Demand;
  controller: AbortController;
  accountRevision: number;
  paragraphId?: string;
  timedOut: boolean;
};
const idle = {
  lease: null,
  bookId: null,
  language: null,
  status: 'idle' as const,
  loading: false,
  online: true,
  error: null,
};
let snapshot: Snapshot = { revision: 0, ...idle };
const listeners = new Set<() => void>();
const cache = new Map<string, TranslationDisplay>();
const refreshing = new Map<string, Promise<SavedTranslations>>();
let sequence = 0;
let desired: Demand | null = null;
let active: Run | null = null;
let scheduled: ReturnType<typeof setTimeout> | null = null;
let observing = false;
let foreground = AppState.currentState === 'active';
const cancelled = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
function publish() {
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}
function publishDemand() {
  const demand = desired;
  if (!demand) snapshot = { ...snapshot, ...idle, currentParagraphId: undefined };
  else {
    const loading =
      !demand.blocked && foreground && (active?.demand === demand || demand.retryAt > 0);
    snapshot = {
      ...snapshot,
      lease: demand.lease,
      bookId: demand.book.id,
      language: demand.language,
      status: demand.blocked ? 'error' : !demand.online ? 'offline' : loading ? 'loading' : 'idle',
      loading,
      online: demand.online,
      error: demand.blocked ? demand.error : null,
      currentParagraphId: active?.demand === demand ? active.paragraphId : undefined,
    };
  }
  publish();
}
const cacheKey = (handle: LibraryHandle, bookId: string) => JSON.stringify([handle.key, bookId]);
function putTranslations(handle: LibraryHandle, bookId: string, display: TranslationDisplay) {
  const key = cacheKey(handle, bookId);
  cache.delete(key);
  cache.set(key, display);
  for (const id of [...cache.keys()]) {
    if (cache.size <= 3) break;
    if (id !== (desired && cacheKey(desired.lease.handle, desired.book.id)) && id !== key)
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
  cache.get(cacheKey(handle, bookId))?.texts;
export const cachedBookTranslationDisplay = (handle: LibraryHandle, bookId: string) =>
  cache.get(cacheKey(handle, bookId));
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
  const cleanup = () => {
    if (refreshing.get(key) === request) refreshing.delete(key);
  };
  void request.then(cleanup, cleanup);
  return request;
}
subscribeTranslationStore((handle, bookId) => {
  if (
    cache.has(cacheKey(handle, bookId)) ||
    (desired?.lease.handle.key === handle.key && desired.book.id === bookId)
  )
    void refreshBookTranslations(handle, bookId).catch((error) => {
      console.error(
        'Reading translation cache refresh failed',
        { libraryKey: handle.key, bookId },
        error,
      );
    });
});
function clearSchedule() {
  if (scheduled) clearTimeout(scheduled);
  scheduled = null;
}
function interrupt() {
  clearSchedule();
  active?.controller.abort();
  // The old request and guarded SQLite transaction must settle before another starts.
}
function observeLifecycle() {
  if (observing) return;
  observing = true;
  foreground = AppState.currentState === 'active';
  subscribeAccount(() => {
    const demand = desired;
    if (!demand) return;
    const account = accountSnapshot();
    if (demand.accountRevision !== account.revision) {
      interrupt();
      desired = {
        ...demand,
        accountRevision: account.revision,
        failures: 0,
        retryAt: 0,
        blocked: false,
        error: null,
        hydratedChapters: new Set(),
      };
    } else if (account.loading || account.busy) interrupt();
    publishDemand();
    schedule();
  });
  AppState.addEventListener('change', (state) => {
    foreground = state === 'active';
    if (!foreground) interrupt();
    publishDemand();
    if (foreground) schedule();
  });
}
function nextPending(demand: Demand) {
  const texts = cachedBookTranslations(demand.lease.handle, demand.book.id)?.[demand.language];
  return demand.entries.find(({ paragraph }) => paragraph.text.trim() && !texts?.[paragraph.id]);
}

/** The reader owns a small window. Leaving it or choosing original text releases all work. */
export function requestReadingTranslation(
  owner: symbol,
  input: {
    lease: LibraryLease;
    book: Book;
    origin: string;
    language: string;
    entries: readonly ReadingScopeParagraph[];
  } | null,
) {
  if (!input) {
    if (desired?.owner !== owner) return;
    desired = null;
    interrupt();
    publishDemand();
    return;
  }
  const { lease, book, language } = input;
  if (!lease.isCurrent()) return;
  const sourceLanguage = effectiveBookLanguage(book);
  if (!input.entries.length || sameReadingLanguage(sourceLanguage, language)) {
    requestReadingTranslation(owner, null);
    return;
  }
  observeLifecycle();
  let origin = '';
  try {
    origin = normalizeServerOrigin(input.origin);
  } catch (error) {
    console.error('Reading translation service origin is invalid', error);
  }
  const previous = desired;
  const sameSession =
    previous?.owner === owner &&
    previous.lease === lease &&
    previous.book === book &&
    previous.origin === origin &&
    previous.language === language &&
    previous.sourceLanguage === sourceLanguage &&
    previous.accountRevision === accountRevision();
  const sameWindow =
    sameSession &&
    previous.entries.length === input.entries.length &&
    previous.entries.every(
      (entry, index) => entry.paragraph.id === input.entries[index].paragraph.id,
    );
  if (sameWindow) return;
  // Advancing into the paragraph already being prefetched should not discard its stream.
  if (sameSession && active?.demand === previous && !active.controller.signal.aborted) {
    const next = { ...previous, entries: input.entries };
    if (active.paragraphId && nextPending(next)?.paragraph.id === active.paragraphId) {
      previous.entries = input.entries;
      return;
    }
  }
  interrupt();
  desired = {
    owner,
    lease,
    book,
    origin,
    language,
    sourceLanguage,
    entries: input.entries,
    accountRevision: accountRevision(),
    failures: 0,
    retryAt: 0,
    online: sameSession ? previous.online : true,
    blocked: false,
    error: null,
    hydratedChapters: sameSession ? previous.hydratedChapters : new Set(),
  };
  publishDemand();
  schedule();
}
export function retryReadingTranslation(owner: symbol) {
  if (desired?.owner !== owner || active?.demand === desired) return;
  clearSchedule();
  desired.failures = 0;
  desired.retryAt = 0;
  desired.blocked = false;
  desired.error = null;
  desired.hydratedChapters.clear();
  // Explicit retry checks the connection immediately, including while marked offline.
  desired.online = true;
  publishDemand();
  schedule();
}
/** Deleting a book revokes its reader demand before the database mutation begins. */
export function invalidateReadingTranslationBook(handle: LibraryHandle, bookId: string) {
  if (desired?.lease.handle.key === handle.key && desired.book.id === bookId)
    requestReadingTranslation(desired.owner, null);
}
function schedule() {
  const demand = desired;
  if (!demand || active || scheduled || !foreground || !demand.lease.isCurrent() || demand.blocked)
    return;
  const account = accountSnapshot();
  if (account.loading || account.busy) return;
  if (!nextPending(demand)) {
    publishDemand();
    return;
  }
  const delay = demand.online ? Math.max(0, demand.retryAt - Date.now()) : 15000;
  if (delay) {
    scheduled = setTimeout(() => {
      scheduled = null;
      if (desired === demand && foreground && demand.lease.isCurrent())
        void runWindow(demand, !demand.online);
    }, delay);
    return;
  }
  void runWindow(demand, false);
}
function nextBoundary(text: string, offset: number) {
  let end = Math.min(text.length, offset + 6000);
  if (end < text.length) {
    const boundary = text.lastIndexOf(' ', end - 1);
    if (boundary > Math.max(offset, end - 800)) end = boundary + 1;
    if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  }
  return end;
}
function networkFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'NetworkError' ||
    /network request failed|failed to fetch|fetch failed|network connection (?:was )?lost|not connected to (?:the )?internet|internet connection appears to be offline|unable to resolve host|could not connect to (?:the )?server|network is unreachable/i.test(
      error.message,
    )
  );
}

async function runWindow(demand: Demand, probe: boolean) {
  if (active || desired !== demand || !foreground || !demand.lease.isCurrent()) return;
  const { lease, book, origin, language, sourceLanguage } = demand;
  const run: Run = {
    id: ++sequence,
    demand,
    controller: new AbortController(),
    accountRevision: accountRevision(),
    timedOut: false,
  };
  active = run;
  demand.retryAt = 0;
  const abortLease = () => run.controller.abort();
  lease.signal.addEventListener('abort', abortLease, { once: true });
  const current = () =>
    active === run &&
    desired === demand &&
    foreground &&
    lease.isCurrent() &&
    accountRevision() === run.accountRevision;
  const assertCurrent = () => {
    if (!current() || run.controller.signal.aborted) throw cancelled();
  };
  const guard = { signal: run.controller.signal, isCurrent: current };
  publishDemand();
  try {
    assertCurrent();
    const account = accountSnapshot();
    if (!origin || account.origin !== origin || account.loading || account.busy)
      throw new Error('translation_connection_required');
    if (account.issue === 'expired') throw new Error('native_session_expired');
    await refreshBookTranslations(lease.handle, book.id);
    assertCurrent();
    if (!nextPending(demand)) return;
    const hydrateWindow = async () => {
      const texts = cachedBookTranslations(lease.handle, book.id)?.[language];
      const chapters = [
        ...new Set(
          demand.entries
            .filter(
              ({ paragraph, chapterIndex }) =>
                paragraph.text.trim() &&
                !texts?.[paragraph.id] &&
                !demand.hydratedChapters.has(chapterIndex),
            )
            .map(({ chapterIndex }) => chapterIndex),
        ),
      ];
      if (!chapters.length) return;
      await hydrateSavedTranslationChapters(lease, book, origin, language, chapters, guard);
      assertCurrent();
      for (const chapter of chapters) demand.hydratedChapters.add(chapter);
      await refreshBookTranslations(lease.handle, book.id);
      assertCurrent();
    };
    // Recover completed account artifacts before asking for new model output.
    // Offline probes remain cheap capability-only requests.
    if (!probe) {
      await hydrateWindow();
      if (!nextPending(demand)) return;
    }
    const capabilities = await checkConnection(origin, run.controller.signal);
    assertCurrent();
    demand.online = true;
    const contextKey = capabilities.translationContextKey;
    if (!capabilities.nativeTranslation || !contextKey) throw new Error('native_ai_unavailable');
    if (probe) {
      demand.error = null;
      return;
    }
    const draftScope = createTranslationDraftScope(book, origin, contextKey, language);
    if (!draftScope) throw new Error('invalid_translation_configuration');
    for (;;) {
      assertCurrent();
      await hydrateWindow();
      const entry = nextPending(demand);
      if (!entry) break;
      const paragraph = entry.paragraph;
      run.paragraphId = paragraph.id;
      publishDemand();
      const key = savedTranslationKey(language, paragraph.id, Crypto.randomUUID());
      const identity = resolveSavedTranslationIdentity(book, key);
      if (!identity || identity.language !== language || identity.paragraphId !== paragraph.id)
        throw new Error('invalid_saved_translation');
      const chapter = book.chapters[entry.chapterIndex];
      const index = chapter.paragraphs.findIndex((item) => item.id === paragraph.id);
      const sources = chapter.paragraphs.slice(Math.max(0, index - 1), index + 2).map((item) => ({
        id: item.id,
        chapter: chapter.title.slice(0, 200),
        text: item.text.slice(0, 4000),
      }));
      const draft = await loadTranslationDraft(lease.handle, book, paragraph.id, draftScope, guard);
      let parts = draft ? [...draft.parts] : [];
      let offset = parts.at(-1)?.end || 0;
      while (offset < paragraph.text.length) {
        assertCurrent();
        const end = nextBoundary(paragraph.text, offset);
        const timer = setTimeout(() => {
          if (!run.controller.signal.aborted) {
            run.timedOut = true;
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
              translationContextKey: contextKey,
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
        const stored = await saveTranslationDraft(
          lease.handle,
          book,
          paragraph.id,
          draftScope,
          nextParts,
          guard,
        );
        parts = stored.parts;
        offset = parts.at(-1)!.end;
      }
      assertCurrent();
      // The atomic writer keeps completed/imported translations that won a race.
      await commitTranslationDraft(lease.handle, book, paragraph.id, draftScope, guard);
      await refreshBookTranslations(lease.handle, book.id);
      assertCurrent();
      demand.error = null;
      // Re-read the live window: navigation may have changed which paragraph is next.
    }
  } catch (error) {
    const interrupted = !current() || (run.controller.signal.aborted && !run.timedOut);
    if (
      interrupted &&
      error instanceof Error &&
      (error.name === 'AbortError' || /^(auth_)?cancelled$/.test(error.message))
    )
      return;
    console.error(
      'Automatic reading translation failed',
      {
        requestId: run.id,
        libraryKey: lease.handle.key,
        bookId: book.id,
        paragraphId: run.paragraphId,
        language,
        sourceLanguage,
        origin,
        probe,
        timedOut: run.timedOut,
        interrupted,
      },
      error,
    );
    if (interrupted) return;
    const offline = networkFailure(error);
    const message = run.timedOut
      ? 'translation_timeout'
      : error instanceof Error
        ? error.message
        : String(error);
    demand.online = !offline;
    demand.error = message;
    // Connection probes do not spend model retries. After connectivity returns,
    // at most two automatic retries may send another model request for this window.
    if (!probe || !offline) demand.failures++;
    const status =
      error instanceof Error && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 0;
    const transient =
      offline ||
      run.timedOut ||
      status === 429 ||
      (status >= 500 && status < 600) ||
      (error instanceof Error &&
        (error.name === 'AbortError' || /^HTTP (429|5\d\d)$/.test(error.message)));
    demand.blocked = !transient || demand.failures > 2;
    if (!demand.blocked && !offline)
      demand.retryAt = Date.now() + (demand.failures === 1 ? 1000 : 3000);
  } finally {
    lease.signal.removeEventListener('abort', abortLease);
    if (active === run) active = null;
    publishDemand();
    schedule();
  }
}
