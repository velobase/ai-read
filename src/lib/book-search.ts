import type { Book } from './types';
import {
  orderedSearchBooks,
  passageSearchBounds,
  searchSavedBookPassages,
} from './translation-search';

type PassageLocation = {
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  paragraphId: string;
  sourceStart: number;
  sourceEnd: number;
  excerpt: string;
  matchStart: number;
  matchEnd: number;
};
export type PassageMatch = PassageLocation &
  (
    | { source: 'original' }
    | {
        source: 'translation';
        language: string;
        translationKey: string;
        textHash: string;
        editionLabel?: string;
      }
  );
export type PassageSearch = { matches: PassageMatch[]; limited: boolean; scannedBooks: number };
export type PassageSearchOptions = {
  signal?: AbortSignal;
  limit?: number;
  /** Number of unique valid matches to skip; omitted or invalid values start at zero. */
  offset?: number;
  onProgress?: (scanned: number) => void;
  source?: 'original' | 'translation';
  /** Omit to search every locally saved translation language. */
  language?: string;
};

export { normalizeSearch, excerptMatch } from '../../packages/reading-core/src/search';
import { normalizeSearch, excerptMatch } from '../../packages/reading-core/src/search';

export async function searchBookPassages(
  books: readonly Book[],
  query: string,
  options: PassageSearchOptions = {},
): Promise<PassageSearch> {
  if (options.source === 'translation') return searchSavedBookPassages(books, query, options);
  const term = query.trim().slice(0, 160);
  const needle = normalizeSearch(term);
  const { limit, offset } = passageSearchBounds(options);
  const matches: PassageMatch[] = [];
  if (!needle) return { matches, limited: false, scannedBooks: 0 };
  let sliceStart = performance.now();
  let scannedBooks = 0;
  let skipped = 0;
  options.signal?.throwIfAborted();
  for (const book of orderedSearchBooks(books)) {
    const seen = new Set<string>();
    for (let chapterIndex = 0; chapterIndex < book.chapters.length; chapterIndex++) {
      const chapter = book.chapters[chapterIndex];
      for (const paragraph of chapter.paragraphs) {
        options.signal?.throwIfAborted();
        if (normalizeSearch(paragraph.text).includes(needle)) {
          const excerpt = excerptMatch(paragraph.text, term);
          if (excerpt && !seen.has(paragraph.id)) {
            seen.add(paragraph.id);
            if (skipped < offset) skipped++;
            else {
              // Only an additional valid, unique match proves another page exists.
              if (matches.length === limit) return { matches, limited: true, scannedBooks };
              matches.push({
                source: 'original',
                bookId: book.id,
                chapterIndex,
                chapterTitle: chapter.title,
                paragraphId: paragraph.id,
                ...excerpt,
              });
            }
          }
        }
        if (performance.now() - sliceStart > 8) {
          options.onProgress?.(scannedBooks);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          options.signal?.throwIfAborted();
          sliceStart = performance.now();
        }
      }
    }
    scannedBooks++;
    options.onProgress?.(scannedBooks);
  }
  options.signal?.throwIfAborted();
  return { matches, limited: false, scannedBooks };
}
