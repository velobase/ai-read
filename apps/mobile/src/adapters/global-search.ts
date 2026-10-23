import { excerptMatch, normalizeSearch, type Chapter, type NoteAnchor } from '@bypage/reading-core';
import { openLibraryDatabase, type ShelfBook } from './database';
import type { LibraryHandle } from './library-scope';
import { searchSavedBookTranslations } from './saved-translation-search';

export const GLOBAL_SEARCH_PAGE_SIZE = 60;
export type SearchRoute = {
  query: string;
  source: 'original' | 'translation';
  language: string;
  bookId?: string;
  page: number;
};
export type LibrarySearchMatch = NonNullable<ReturnType<typeof excerptMatch>> & {
  bookId: string;
  title: string;
  chapter: string;
  paragraph: string;
  anchor: NoteAnchor;
  quote: string;
  language?: string;
};

const check = (signal: AbortSignal) => {
  if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
};
const validLanguage = (language: string) => /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language);

/** Opening a result changes lastOpened; it must not reorder a returning result page. */
export function searchBookOrder(books: ShelfBook[]): ShelfBook[] {
  return [...books].sort((a, b) => a.importedAt - b.importedAt || a.id.localeCompare(b.id));
}

export async function savedSearchLanguages(
  handle: LibraryHandle,
  bookId: string | undefined,
  signal: AbortSignal,
) {
  check(signal);
  const db = await openLibraryDatabase(handle);
  check(signal);
  const rows = await db.getAllAsync<{ language: string }>(
    `SELECT language FROM translations ${bookId ? 'WHERE book_id = ?' : ''}
     UNION SELECT language FROM translation_versions ${bookId ? 'WHERE book_id = ?' : ''}
     ORDER BY language`,
    bookId ? [bookId, bookId] : [],
  );
  check(signal);
  return rows.map((row) => row.language).filter(validLanguage);
}

/** One hit per original paragraph or unique saved text; only one page is retained. */
export async function searchLibraryPassages(
  handle: LibraryHandle,
  books: ShelfBook[],
  route: SearchRoute,
  signal: AbortSignal,
): Promise<{ matches: LibrarySearchMatch[]; hasMore: boolean; hasTranslations: boolean }> {
  check(signal);
  const matches: LibrarySearchMatch[] = [];
  if (!normalizeSearch(route.query.trim()))
    return { matches, hasMore: false, hasTranslations: false };
  if (route.source === 'translation' && !validLanguage(route.language))
    throw new Error('invalid_search_language');
  const page =
    Number.isSafeInteger(route.page) &&
    route.page > 0 &&
    Number.isSafeInteger(route.page * GLOBAL_SEARCH_PAGE_SIZE)
      ? route.page
      : 0;
  const skip = page * GLOBAL_SEARCH_PAGE_SIZE;
  const db = await openLibraryDatabase(handle);
  check(signal);
  let found = 0;
  let hasTranslations = false;
  let scanned = 0;
  let characters = 0;
  for (const meta of searchBookOrder(books)) {
    if (route.bookId && meta.id !== route.bookId) continue;
    check(signal);
    if (route.source === 'translation') {
      const saved = await searchSavedBookTranslations(
        handle,
        meta.id,
        route.language,
        route.query,
        {
          offset: Math.max(0, skip - found),
          limit: GLOBAL_SEARCH_PAGE_SIZE - matches.length,
          signal,
        },
      );
      check(signal);
      hasTranslations ||= saved.hasTranslations;
      found += saved.skipped + saved.matches.length;
      for (const match of saved.matches) {
        matches.push({
          ...match,
          bookId: meta.id,
          title: meta.title,
          chapter: match.chapterTitle,
          paragraph: match.paragraphId,
          anchor: {
            source: 'translation',
            start: match.sourceStart,
            end: match.sourceEnd,
            translationKey: match.translationKey,
          },
        });
      }
      if (saved.hasMore) return { matches, hasMore: true, hasTranslations };
      continue;
    }
    // Search needs text only. Do not transfer/decode all base64 illustrations or
    // revalidate the immutable book sidecars on every query or result page.
    const row = await db.getFirstAsync<{ chapters: string }>(
      "SELECT json_extract(body, '$.chapters') AS chapters FROM books WHERE id = ?",
      [meta.id],
    );
    check(signal);
    if (!row) continue;
    const chapters = JSON.parse(row.chapters) as Chapter[];
    for (const chapter of chapters) {
      for (const paragraph of chapter.paragraphs) {
        check(signal);
        const text = paragraph.text;
        if (typeof text === 'string' && text.length) {
          const match = excerptMatch(text, route.query);
          if (match) {
            if (found++ >= skip) {
              if (matches.length === GLOBAL_SEARCH_PAGE_SIZE)
                return { matches, hasMore: true, hasTranslations };
              matches.push({
                ...match,
                bookId: meta.id,
                title: meta.title,
                chapter: chapter.title,
                paragraph: paragraph.id,
                quote: text.slice(match.sourceStart, match.sourceEnd),
                anchor: {
                  source: 'original',
                  start: match.sourceStart,
                  end: match.sourceEnd,
                },
              });
            }
          }
          characters += text.length;
        }
        if (++scanned % 80 === 0 || characters >= 64000) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          check(signal);
          characters = 0;
        }
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check(signal);
  }
  return { matches, hasMore: false, hasTranslations };
}
