import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLibrary } from '../library-context';
import {
  effectiveBookLanguage,
  readingScopeParagraphs,
  sameReadingLanguage,
  type Book,
  type Position,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { apiOrigin } from '../adapters/api';
import {
  cachedBookTranslations,
  cachedBookTranslationDisplay,
  configureTranslationQueue,
  observeTranslationBook,
  pauseTranslationQueue,
  refreshBookTranslations,
  startTranslationQueue,
  subscribeTranslationQueue,
  translationBatch,
  translationQueueSnapshot,
  type SavedTranslations,
  type TranslationScope,
} from '../adapters/translation-queue';

const emptySaved: SavedTranslations = {};
const emptyTranslations: Record<string, string> = {};
/** UI subscription only: changing pages or unmounting does not cancel explicit foreground work. */
export function useChapterTranslation(
  book: Book,
  initial: SavedTranslations = emptySaved,
  position: Pick<Position, 'chapter' | 'paragraph' | 'farthest'> = {
    chapter: 0,
    paragraph: book.chapters[0].paragraphs[0].id,
    farthest: 0,
  },
  options: {
    enabled?: boolean;
    defaultScope?: TranslationScope;
    initialKeys?: SavedTranslations;
  } = {},
) {
  const { preferences } = useApp();
  const lease = useLibrary();
  const libraryScope = JSON.stringify([lease.handle.key, lease.epoch, book.id]);
  const currentScope = useRef(libraryScope);
  currentScope.current = libraryScope;
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const initialOwner = useRef({ lease, bookId: book.id });
  const language = preferences.language;
  const sourceLanguage = effectiveBookLanguage(book);
  const sameLanguage = sameReadingLanguage(sourceLanguage, language);
  const origin = apiOrigin;
  const snapshot = useSyncExternalStore(
    subscribeTranslationQueue,
    translationQueueSnapshot,
    translationQueueSnapshot,
  );
  const [scope, setScope] = useState<TranslationScope>(options.defaultScope || 'chapter');
  const [load, setLoad] = useState({ scope: libraryScope, loading: true, error: false });
  const saved =
    cachedBookTranslations(lease.handle, book.id) ||
    (initialOwner.current.lease === lease && initialOwner.current.bookId === book.id
      ? initial
      : emptySaved);
  const translations = saved[language] || emptyTranslations;
  const savedKeys =
    cachedBookTranslationDisplay(lease.handle, book.id)?.keys ||
    (initialOwner.current.lease === lease && initialOwner.current.bookId === book.id
      ? options.initialKeys || emptySaved
      : emptySaved);
  const enabled = options.enabled !== false;
  const entries = useMemo(() => {
    if (!enabled) return [];
    if (scope === 'paragraph') {
      const chapter = book.chapters[position.chapter];
      const index =
        chapter?.paragraphs.findIndex((paragraph) => paragraph.id === position.paragraph) ?? -1;
      if (!chapter || index < 0) return [];
      return [
        {
          paragraph: chapter.paragraphs[index],
          chapterIndex: position.chapter,
          chapter: chapter.title,
          ordinal:
            book.chapters
              .slice(0, position.chapter)
              .reduce((count, item) => count + item.paragraphs.length, 0) + index,
        },
      ];
    }
    return readingScopeParagraphs(book, position, scope);
  }, [book, position.chapter, position.paragraph, position.farthest, scope, enabled]);
  const plan = useMemo(() => translationBatch(entries, translations), [entries, translations]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadSequence.current++;
    };
  }, []);
  useEffect(() => {
    configureTranslationQueue(lease, { origin, language });
  }, [lease, origin, language]);
  useEffect(() => {
    if (lease.isCurrent()) observeTranslationBook(lease.handle, book);
  }, [lease, book, sourceLanguage]);
  async function refresh() {
    if (!lease.isCurrent()) return null;
    const ticket = ++loadSequence.current;
    const owns = () =>
      mounted.current &&
      lease.isCurrent() &&
      currentScope.current === libraryScope &&
      ticket === loadSequence.current;
    setLoad({ scope: libraryScope, loading: true, error: false });
    try {
      const refreshed = await refreshBookTranslations(lease.handle, book.id);
      if (owns()) setLoad({ scope: libraryScope, loading: false, error: false });
      return owns() ? refreshed : null;
    } catch {
      if (owns()) setLoad({ scope: libraryScope, loading: false, error: true });
      return null;
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      loadSequence.current++;
    };
  }, [lease, book.id]);
  const globalJob = snapshot.lease === lease && lease.isCurrent() ? snapshot.job : null;
  const job = globalJob?.bookId === book.id && globalJob.language === language ? globalJob : null;
  return {
    saved,
    savedKeys,
    translations,
    sameLanguage,
    scope,
    setScope,
    entries,
    job,
    globalJob,
    busy: !!globalJob?.busy,
    otherBusy: !!globalJob?.busy && globalJob !== job,
    loading: load.scope !== libraryScope || load.loading,
    loadError: load.scope === libraryScope && load.error,
    refresh,
    start: () => startTranslationQueue(lease, { book, language, origin, scope, entries }),
    stop: () => {
      if (lease.isCurrent()) pauseTranslationQueue(lease.handle);
    },
    ready: sameLanguage ? plan.total : plan.ready,
    total: plan.total,
    batchCount: sameLanguage ? 0 : plan.batch.length,
    pendingCount: sameLanguage ? 0 : plan.pending,
    characters: sameLanguage ? 0 : plan.characters,
  };
}
