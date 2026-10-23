import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLibrary } from '../library-context';
import {
  effectiveBookLanguage,
  sameReadingLanguage,
  type Book,
  type Position,
  type ReadingScopeParagraph,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { apiOrigin } from '../adapters/api';
import {
  cachedBookTranslations,
  cachedBookTranslationDisplay,
  refreshBookTranslations,
  requestReadingTranslation,
  retryReadingTranslation,
  subscribeTranslationQueue,
  translationQueueSnapshot,
  type SavedTranslations,
} from '../adapters/translation-queue';

const emptySaved: SavedTranslations = {};
const emptyTranslations: Record<string, string> = {};
/** Follow the reader's visible need; neither book detail nor original mode requests translations. */
export function useChapterTranslation(
  book: Book,
  initial: SavedTranslations = emptySaved,
  position: Pick<Position, 'chapter' | 'paragraph' | 'farthest'> = {
    chapter: 0,
    paragraph: book.chapters[0].paragraphs[0].id,
    farthest: 0,
  },
  options: {
    auto?: boolean;
    language?: string;
    initialKeys?: SavedTranslations;
  } = {},
) {
  const { preferences } = useApp();
  const lease = useLibrary();
  const owner = useRef(Symbol('reading-translation')).current;
  const libraryScope = JSON.stringify([lease.handle.key, lease.epoch, book.id]);
  const currentScope = useRef(libraryScope);
  currentScope.current = libraryScope;
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const initialOwner = useRef({ lease, bookId: book.id });
  const language = options.language || preferences.language;
  const sourceLanguage = effectiveBookLanguage(book);
  const sameLanguage = sameReadingLanguage(sourceLanguage, language);
  const snapshot = useSyncExternalStore(
    subscribeTranslationQueue,
    translationQueueSnapshot,
    translationQueueSnapshot,
  );
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
  const auto = options.auto === true && !sameLanguage;
  const entries = useMemo(() => {
    if (!auto) return [];
    const chapter = book.chapters[position.chapter];
    const paragraphIndex =
      chapter?.paragraphs.findIndex((item) => item.id === position.paragraph) ?? -1;
    if (paragraphIndex < 0) return [];
    const result: ReadingScopeParagraph[] = [];
    let ordinal = book.chapters
      .slice(0, position.chapter)
      .reduce((sum, item) => sum + item.paragraphs.length, 0);
    for (let chapterIndex = position.chapter; chapterIndex < book.chapters.length; chapterIndex++) {
      const current = book.chapters[chapterIndex];
      const start = chapterIndex === position.chapter ? paragraphIndex : 0;
      for (let index = start; index < current.paragraphs.length; index++) {
        const paragraph = current.paragraphs[index];
        if (!paragraph.text.trim()) continue;
        result.push({ paragraph, chapterIndex, chapter: current.title, ordinal: ordinal + index });
        if (result.length === 3) return result;
      }
      ordinal += current.paragraphs.length;
    }
    return result;
  }, [book, position.chapter, position.paragraph, auto]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadSequence.current++;
      requestReadingTranslation(owner, null);
    };
  }, [owner]);
  useEffect(() => {
    requestReadingTranslation(
      owner,
      auto
        ? {
            lease,
            book,
            origin: apiOrigin,
            language,
            entries,
          }
        : null,
    );
  }, [owner, lease, book, language, sourceLanguage, entries, auto]);
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
    } catch (error) {
      console.error(
        'Reading translation display could not be loaded',
        { libraryKey: lease.handle.key, bookId: book.id },
        error,
      );
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
  const work =
    auto &&
    snapshot.lease === lease &&
    snapshot.bookId === book.id &&
    snapshot.language === language &&
    lease.isCurrent()
      ? snapshot
      : null;
  const loadError = load.scope === libraryScope && load.error;
  return {
    saved,
    savedKeys,
    translations,
    sameLanguage,
    loading: load.scope !== libraryScope || load.loading || !!work?.loading,
    loadError,
    error: work?.error || null,
    online: work?.online ?? true,
    status: work?.status || (loadError ? ('error' as const) : ('idle' as const)),
    currentParagraphId: work?.currentParagraphId,
    refresh,
    retry: () => {
      if (loadError)
        void refresh().then((result) => {
          if (result) retryReadingTranslation(owner);
        });
      else retryReadingTranslation(owner);
    },
  };
}
