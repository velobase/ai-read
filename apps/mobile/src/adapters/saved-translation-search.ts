import {
  excerptMatch,
  normalizeSearch,
  validateBook,
  validateSavedTranslationVersion,
  type Book,
} from '@bypage/reading-core';
import { openLibraryDatabase } from './database';
import { assertLibraryHandle, type LibraryHandle } from './library-scope';
import { ensureBookTranslationMigration } from './translation-store';

export type SavedTranslationSearchMatch = NonNullable<ReturnType<typeof excerptMatch>> & {
  chapterIndex: number;
  chapterTitle: string;
  paragraphId: string;
  language: string;
  translationKey: string;
  textHash: string;
  quote: string;
};

/**
 * All saved versions, independently of the current display selection. The source
 * snapshot excludes illustrations; only one bounded SQL batch and one result
 * page retain translated text. Identical text is deduplicated across batches.
 */
export async function searchSavedBookTranslations(
  handle: LibraryHandle,
  bookId: string,
  language: string,
  query: string,
  options: { offset: number; limit: number; signal: AbortSignal },
): Promise<{
  matches: SavedTranslationSearchMatch[];
  hasMore: boolean;
  hasTranslations: boolean;
  skipped: number;
}> {
  const check = () => {
    assertLibraryHandle(handle);
    if (options.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  const matches: SavedTranslationSearchMatch[] = [];
  let skipped = 0;
  let hasTranslations = false;
  if (!normalizeSearch(query.trim())) return { matches, skipped, hasTranslations, hasMore: false };
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language) || language.length > 30)
    throw new Error('invalid_search_language');
  const offset = Number.isSafeInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
  // Zero is intentional: a full cross-book page only probes the next book for
  // one more hit, without retaining another result.
  const limit =
    Number.isSafeInteger(options.limit) && options.limit >= 0 ? Math.min(200, options.limit) : 60;
  const db = await openLibraryDatabase(handle);
  check();
  const book = await (async (): Promise<Book | null> => {
    let source: Book | null = null;
    await db.withExclusiveTransactionAsync(async (tx) => {
      check();
      const row = await tx.getFirstAsync<{ body: string }>(
        "SELECT json_remove(body, '$.media', '$.references', '$.toc', '$.cover') AS body FROM books WHERE id = ?",
        [bookId],
      );
      check();
      if (!row) return;
      source = validateBook(JSON.parse(row.body));
      if (source.id !== bookId) throw new Error('invalid_saved_translation');
      // Preserve legacy keys and choices using the same atomic migration as
      // exact reading. A cancellation here rolls back this transaction.
      await ensureBookTranslationMigration(tx, source);
      check();
    });
    return source;
  })();
  check();
  if (!book) return { matches, skipped, hasTranslations, hasMore: false };
  const seen = new Set<string>();
  let after: string | undefined;
  let characters = 0;
  for (;;) {
    check();
    const rows = await db.getAllAsync<{
      key: string;
      language: string;
      paragraph_id: string;
      body: string;
    }>(
      `SELECT key, language, paragraph_id, body FROM translation_versions
       WHERE book_id = ? AND language = ? ${after === undefined ? '' : 'AND key > ?'}
       ORDER BY key LIMIT 32`,
      after === undefined ? [bookId, language] : [bookId, language, after],
    );
    check();
    for (const row of rows) {
      check();
      const value = validateSavedTranslationVersion(book, JSON.parse(row.body));
      if (
        value.key !== row.key ||
        value.language !== row.language ||
        value.language !== language ||
        value.paragraphId !== row.paragraph_id
      )
        throw new Error('invalid_saved_translation');
      hasTranslations = true;
      const match = excerptMatch(value.text, query);
      if (match) {
        const identity = JSON.stringify([value.paragraphId, value.textHash]);
        if (!seen.has(identity)) {
          seen.add(identity);
          if (skipped < offset) skipped++;
          else {
            if (matches.length === limit)
              return { matches, skipped, hasTranslations, hasMore: true };
            matches.push({
              ...match,
              chapterIndex: value.chapterIndex,
              chapterTitle: book.chapters[value.chapterIndex].title,
              paragraphId: value.paragraphId,
              language,
              translationKey: value.key,
              textHash: value.textHash,
              quote: value.text.slice(match.sourceStart, match.sourceEnd),
            });
          }
        }
      }
      characters += value.text.length;
      if (characters >= 64000) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        check();
        characters = 0;
      }
    }
    if (rows.length < 32) return { matches, skipped, hasTranslations, hasMore: false };
    after = rows[rows.length - 1].key;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check();
    characters = 0;
  }
}
