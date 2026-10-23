import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  effectiveBookLanguage,
  sameReadingLanguage,
  type Book,
  type Position,
  type TranslationEdition,
} from '@bypage/reading-core';
import { useLibrary } from '../library-context';
import { useApp } from '../context';
import { apiOrigin } from '../adapters/api';
import { useAccount } from '../adapters/account';
import { bookTranslationSession } from '../adapters/book-translation';
import {
  cachedBookTranslations,
  cachedBookTranslationDisplay,
  refreshBookTranslations,
  subscribeTranslationDisplay,
  translationDisplaySnapshot,
  type SavedTranslations,
} from '../adapters/translation-display';

const emptySaved: SavedTranslations = {};
const emptyTranslations: Record<string, string> = {};
type Status = 'idle' | 'loading' | 'offline' | 'error';
type Work = {
  scope: string;
  status: Status;
  failed: boolean;
  progress: { completed: number; total: number } | null;
};

/** Opening a book ensures one durable whole-book job. This hook observes it; it never owns it. */
export function useChapterTranslation(
  book: Book,
  initial: SavedTranslations = emptySaved,
  position: Pick<Position, 'chapter' | 'paragraph' | 'farthest'>,
  options: { language?: string; initialKeys?: SavedTranslations } = {},
) {
  const { preferences } = useApp();
  const lease = useLibrary();
  const account = useAccount();
  const language = options.language || preferences.language;
  const sameLanguage = sameReadingLanguage(effectiveBookLanguage(book), language);
  const scope = JSON.stringify([
    lease.handle.key,
    lease.epoch,
    book.id,
    language,
    account.revision,
  ]);
  const current = useRef({ scope, chapter: position.chapter });
  current.current = { scope, chapter: position.chapter };
  const initialOwner = useRef({ lease, bookId: book.id });
  useSyncExternalStore(
    subscribeTranslationDisplay,
    translationDisplaySnapshot,
    translationDisplaySnapshot,
  );
  const [load, setLoad] = useState({ scope, loading: true, error: false });
  const [work, setWork] = useState<Work>({
    scope,
    status: sameLanguage ? 'idle' : 'loading',
    progress: null,
    failed: false,
  });
  const retryRequest = useRef<(() => void) | null>(null);
  const updatePriority = useRef<(() => void) | null>(null);
  const saved =
    cachedBookTranslations(lease.handle, book.id) ||
    (initialOwner.current.lease === lease && initialOwner.current.bookId === book.id
      ? initial
      : emptySaved);
  const savedKeys =
    cachedBookTranslationDisplay(lease.handle, book.id)?.keys ||
    (initialOwner.current.lease === lease && initialOwner.current.bookId === book.id
      ? options.initialKeys || emptySaved
      : emptySaved);
  async function refresh() {
    if (!lease.isCurrent()) return null;
    try {
      const result = await refreshBookTranslations(lease.handle, book.id);
      if (lease.isCurrent() && current.current.scope === scope)
        setLoad({ scope, loading: false, error: false });
      return result;
    } catch (error) {
      console.error(
        'Saved translation display could not be loaded',
        { libraryKey: lease.handle.key, bookId: book.id },
        error,
      );
      if (lease.isCurrent() && current.current.scope === scope)
        setLoad({ scope, loading: false, error: true });
      return null;
    }
  }
  useEffect(() => {
    void refresh();
  }, [scope]);
  useEffect(() => {
    if (sameLanguage) {
      setWork({ scope, status: 'idle', progress: null, failed: false });
      return;
    }
    if (account.loading || account.busy) return;
    if (!account.session) {
      setWork({ scope, status: 'error', progress: null, failed: false });
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let action: 'ensure' | 'retry' | null = 'ensure';
    let lastChapter = -1;
    let edition: TranslationEdition | null = null;
    const owns = () => !disposed && lease.isCurrent() && current.current.scope === scope;
    const session = bookTranslationSession(lease, book, apiOrigin, language, {
      signal: controller.signal,
      isCurrent: owns,
    });
    function publish(status: Status) {
      if (owns())
        setWork({
          scope,
          status,
          progress: edition?.progress || null,
          failed: edition?.state === 'error',
        });
    }
    function schedule(delay: number) {
      if (timer) clearTimeout(timer);
      if (owns() && foreground) timer = setTimeout(() => void poll(), delay);
    }
    async function poll() {
      if (!owns() || !foreground || running) return;
      running = true;
      let delay: number | null = 2000;
      try {
        const chapter = current.current.chapter;
        const requested = action || (chapter !== lastChapter ? 'ensure' : null);
        // Reprioritizing only pending server work never aborts the worker's current paragraph.
        action = null;
        try {
          edition = requested ? await session.ensure(chapter, requested) : await session.read();
        } catch (error) {
          // An uncertain submission is safe to repeat; ensure is idempotent.
          action ||= requested;
          throw error;
        }
        if (!owns()) return;
        lastChapter = chapter;
        publish(
          edition?.state === 'ready' ? 'idle' : edition?.state === 'error' ? 'error' : 'loading',
        );
        if (edition) await session.download(edition, current.current.chapter);
        if (!owns()) return;
        await refresh();
        // Completion stops polling; foregrounding or changing chapters refreshes immediately.
        delay = edition?.state === 'ready' ? null : 2000;
      } catch (error) {
        if (!owns()) return;
        console.error(
          'Background book translation could not be synchronized',
          { bookId: book.id, language },
          error,
        );
        const status = (error as { status?: number }).status;
        const name = error instanceof Error ? error.name : '';
        publish(!status && (name === 'TypeError' || name === 'AbortError') ? 'offline' : 'error');
        delay = 15000;
      } finally {
        running = false;
        if (delay !== null) schedule(delay);
      }
    }
    retryRequest.current = () => {
      action = 'retry';
      publish('loading');
      schedule(0);
    };
    updatePriority.current = () => schedule(0);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) {
        void refresh();
        schedule(0);
      } else if (timer) clearTimeout(timer);
      // No cancellation: the worker continues even when the OS suspends this app.
    });
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
      retryRequest.current = null;
      updatePriority.current = null;
      controller.abort(); // detach GET/display writes only; POST and server job survive
    };
  }, [scope, sameLanguage, account.loading, account.busy, !!account.session, book, lease]);
  useEffect(() => {
    updatePriority.current?.();
  }, [position.chapter]);
  const loadError = load.scope === scope && load.error;
  const status = work.scope === scope ? work.status : sameLanguage ? 'idle' : 'loading';
  return {
    saved,
    savedKeys,
    translations: saved[language] || emptyTranslations,
    sameLanguage,
    loading: load.scope !== scope || load.loading,
    loadError,
    status,
    progress: work.scope === scope ? work.progress : null,
    canRetry: work.scope === scope && work.failed,
    refresh,
    retry: () => {
      void refresh();
      retryRequest.current?.();
    },
  };
}
