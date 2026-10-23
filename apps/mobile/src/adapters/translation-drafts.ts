import type { SQLiteDatabase } from 'expo-sqlite';
import {
  effectiveBookLanguage,
  sameReadingLanguage,
  sha256,
  utf8,
  validSyncId,
  translationChapterFingerprint,
  type Book,
  type Paragraph,
} from '@bypage/reading-core';
import { accountSnapshot } from './account';
import { openLibraryDatabase } from './database';
import type { LibraryHandle } from './library-scope';
import { normalizeServerOrigin } from './server-origin';
import {
  ensureBookTranslationMigration,
  readSelectedTranslation,
  writeCompletedTranslation,
  notifyTranslationStore,
} from './translation-store';

export type TranslationDraftScope = {
  origin: string;
  accountId: string | null;
  contextKey: string;
  language: string;
  sourceLanguage: string;
};
export type TranslationDraftPart = { start: number; end: number; text: string };
export type TranslationDraft = {
  version: 1;
  bookId: string;
  paragraphId: string;
  scope: TranslationDraftScope;
  sourceHash: string;
  sourceLength: number;
  parts: TranslationDraftPart[];
  updatedAt: number;
};
export type TranslationDraftGuard = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

const MAX_TRANSLATION = 100000;
const MAX_CHUNK = 8000;
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const languageTag = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z-]{2,20}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new Error('invalid_translation_draft');
};
const cancelled = (): never => {
  throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
};

function cleanScope(book: Book, value: unknown): TranslationDraftScope {
  if (
    !object(value) ||
    typeof value.origin !== 'string' ||
    value.origin.length > 2048 ||
    (value.accountId !== null && !validSyncId(value.accountId)) ||
    !digest(value.contextKey) ||
    !languageTag(value.language) ||
    typeof value.sourceLanguage !== 'string' ||
    value.sourceLanguage.length > 200 ||
    value.sourceLanguage !== effectiveBookLanguage(book)
  )
    return invalid();
  let origin: string;
  try {
    origin = normalizeServerOrigin(value.origin);
  } catch {
    return invalid();
  }
  if (!origin || origin !== value.origin) return invalid();
  return {
    origin,
    accountId: value.accountId as string | null,
    contextKey: value.contextKey,
    language: value.language,
    sourceLanguage: value.sourceLanguage,
  };
}

/** A missing provider/prompt fingerprint never enables persistent draft reuse. */
export function createTranslationDraftScope(
  book: Book,
  rawOrigin: string,
  contextKey: string | undefined,
  language: string,
): TranslationDraftScope | null {
  if (!digest(contextKey) || !languageTag(language)) return null;
  let origin: string;
  try {
    origin = normalizeServerOrigin(rawOrigin);
  } catch {
    return null;
  }
  const account = accountSnapshot();
  if (!origin || account.origin !== origin || account.loading || account.busy) return null;
  return cleanScope(book, {
    origin,
    accountId: account.session?.user.id ?? null,
    contextKey,
    language,
    sourceLanguage: effectiveBookLanguage(book),
  });
}

function check(guard: TranslationDraftGuard, scope: TranslationDraftScope) {
  const account = accountSnapshot();
  if (
    guard.signal.aborted ||
    !guard.isCurrent() ||
    account.loading ||
    account.busy ||
    account.origin !== scope.origin ||
    (account.session?.user.id ?? null) !== scope.accountId ||
    sameReadingLanguage(scope.sourceLanguage, scope.language)
  )
    cancelled();
}

type Source = {
  paragraph: Paragraph;
  chapterIndex: number;
  path: string;
  hash: string;
};
const sourceIndexes = new WeakMap<Book, Map<string, Omit<Source, 'hash'> & { hash?: string }>>();
function sourceOf(book: Book, paragraphId: string): Source {
  let index = sourceIndexes.get(book);
  if (!index) {
    index = new Map();
    book.chapters.forEach((chapter, chapterIndex) => {
      chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
        index!.set(paragraph.id, {
          paragraph,
          chapterIndex,
          path: `$.chapters[${chapterIndex}].paragraphs[${paragraphIndex}]`,
        });
      });
    });
    sourceIndexes.set(book, index);
  }
  const source = index.get(paragraphId);
  if (!source?.paragraph.text.trim()) return invalid();
  source.hash ??= sha256(utf8(source.paragraph.text));
  return { ...source, hash: source.hash };
}

const scopeKey = (scope: TranslationDraftScope) =>
  sha256(
    utf8(
      JSON.stringify([
        scope.origin,
        scope.accountId,
        scope.contextKey,
        scope.language,
        scope.sourceLanguage,
      ]),
    ),
  );

/** Storage identity only; this does not authorize a request or resume a draft. */
export const translationDraftScopeKey = scopeKey;

/** A metadata change, deleted book or replaced source invalidates the pending write. */
async function checkStoredSource(
  db: SQLiteDatabase,
  book: Book,
  source: Source,
  scope: TranslationDraftScope,
  guard: TranslationDraftGuard,
) {
  check(guard, scope);
  const row = await db.getFirstAsync<{
    language: string;
    sourceLanguage: string | null;
    paragraphId: string | null;
    text: string | null;
  }>(
    "SELECT json_extract(body, '$.language') AS language, json_extract(body, '$.sourceLanguage') AS sourceLanguage, json_extract(body, ?) AS paragraphId, json_extract(body, ?) AS text FROM books WHERE id = ?",
    [`${source.path}.id`, `${source.path}.text`, book.id],
  );
  check(guard, scope);
  if (!row) throw new Error('Book not found');
  if (
    row.paragraphId !== source.paragraph.id ||
    row.text !== source.paragraph.text ||
    effectiveBookLanguage({
      language: row.language,
      sourceLanguage: row.sourceLanguage ?? undefined,
    }) !== scope.sourceLanguage
  )
    throw new Error('translation_draft_source_changed');
}

function cleanParts(value: unknown, source: Source): TranslationDraftPart[] {
  if (!Array.isArray(value) || value.length > MAX_TRANSLATION) return invalid();
  let end = 0;
  let characters = 0;
  return value.map((part, index) => {
    if (
      !object(part) ||
      !Number.isSafeInteger(part.start) ||
      !Number.isSafeInteger(part.end) ||
      part.start !== end ||
      (part.end as number) <= end ||
      (part.end as number) > source.paragraph.text.length ||
      (part.end as number) - end > MAX_CHUNK ||
      typeof part.text !== 'string' ||
      !part.text.trim()
    )
      return invalid();
    end = part.end as number;
    // Chunk boundaries must not split a Unicode surrogate pair.
    if (
      end < source.paragraph.text.length &&
      /[\uD800-\uDBFF]/.test(source.paragraph.text[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(source.paragraph.text[end])
    )
      return invalid();
    characters += part.text.length + (index ? 2 : 0);
    if (characters > MAX_TRANSLATION) throw new Error('translation_too_large');
    return { start: part.start as number, end, text: part.text };
  });
}

function readDraft(
  value: unknown,
  book: Book,
  source: Source,
  scope: TranslationDraftScope,
): TranslationDraft {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.bookId !== book.id ||
    value.paragraphId !== source.paragraph.id ||
    value.sourceHash !== source.hash ||
    value.sourceLength !== source.paragraph.text.length ||
    !Number.isSafeInteger(value.updatedAt) ||
    (value.updatedAt as number) < 0 ||
    scopeKey(cleanScope(book, value.scope)) !== scopeKey(scope)
  )
    return invalid();
  return {
    version: 1,
    bookId: book.id,
    paragraphId: source.paragraph.id,
    scope,
    sourceHash: source.hash,
    sourceLength: source.paragraph.text.length,
    parts: cleanParts(value.parts, source),
    updatedAt: value.updatedAt as number,
  };
}

/** Validate a recovery snapshot without consulting the current login or starting work. */
export function validateTranslationDraft(book: Book, value: unknown): TranslationDraft {
  if (!object(value) || typeof value.paragraphId !== 'string') return invalid();
  return readDraft(value, book, sourceOf(book, value.paragraphId), cleanScope(book, value.scope));
}

/** Drafts are deliberately separate from completed translations and portable exports. */
export async function loadTranslationDraft(
  handle: LibraryHandle,
  book: Book,
  paragraphId: string,
  inputScope: TranslationDraftScope,
  guard: TranslationDraftGuard,
): Promise<TranslationDraft | null> {
  const scope = cleanScope(book, inputScope);
  check(guard, scope);
  const source = sourceOf(book, paragraphId);
  const db = await openLibraryDatabase(handle);
  let result: TranslationDraft | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    await checkStoredSource(tx, book, source, scope, guard);
    const row = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM translation_drafts WHERE book_id = ? AND scope_key = ? AND paragraph_id = ?',
      [book.id, scopeKey(scope), paragraphId],
    );
    check(guard, scope);
    if (row) result = readDraft(JSON.parse(row.body), book, source, scope);
  });
  check(guard, scope);
  return result;
}

/** Only append a contiguous, completed model chunk; repeated identical writes are harmless. */
export async function saveTranslationDraft(
  handle: LibraryHandle,
  book: Book,
  paragraphId: string,
  inputScope: TranslationDraftScope,
  parts: TranslationDraftPart[],
  guard: TranslationDraftGuard,
): Promise<TranslationDraft> {
  const scope = cleanScope(book, inputScope);
  check(guard, scope);
  const source = sourceOf(book, paragraphId);
  let result: TranslationDraft = {
    version: 1,
    bookId: book.id,
    paragraphId,
    scope,
    sourceHash: source.hash,
    sourceLength: source.paragraph.text.length,
    parts: cleanParts(parts, source),
    updatedAt: Date.now(),
  };
  if (!result.parts.length) return invalid();
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await checkStoredSource(tx, book, source, scope, guard);
    const row = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM translation_drafts WHERE book_id = ? AND scope_key = ? AND paragraph_id = ?',
      [book.id, scopeKey(scope), paragraphId],
    );
    check(guard, scope);
    if (row) {
      const existing = readDraft(JSON.parse(row.body), book, source, scope);
      const common = Math.min(existing.parts.length, result.parts.length);
      for (let index = 0; index < common; index++) {
        const old = existing.parts[index],
          next = result.parts[index];
        if (old.start !== next.start || old.end !== next.end || old.text !== next.text)
          throw new Error('translation_draft_conflict');
      }
      // A late shorter prefix returns the durable longer result without deleting it.
      if (existing.parts.length >= result.parts.length) {
        result = existing;
        return;
      }
      result.updatedAt = Math.max(result.updatedAt, existing.updatedAt);
    }
    check(guard, scope);
    await tx.runAsync(
      'INSERT INTO translation_drafts(book_id, scope_key, paragraph_id, body, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(book_id, scope_key, paragraph_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
      [book.id, scopeKey(scope), paragraphId, JSON.stringify(result), result.updatedAt],
    );
    // Throwing inside the transaction rolls back a write cancelled during native IO.
    check(guard, scope);
  });
  check(guard, scope);
  return result;
}

/** Publish a whole paragraph and remove this draft in the same SQLite transaction. */
export async function commitTranslationDraft(
  handle: LibraryHandle,
  book: Book,
  paragraphId: string,
  inputScope: TranslationDraftScope,
  guard: TranslationDraftGuard,
): Promise<string> {
  const scope = cleanScope(book, inputScope);
  check(guard, scope);
  const source = sourceOf(book, paragraphId);
  const db = await openLibraryDatabase(handle);
  let result = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    await checkStoredSource(tx, book, source, scope, guard);
    // Exact versions prove the whole chapter, not only the draft's paragraph.
    const chapterRow = await tx.getFirstAsync<{ chapter: string }>(
      'SELECT json_extract(body, ?) AS chapter FROM books WHERE id = ?',
      [`$.chapters[${source.chapterIndex}]`, book.id],
    );
    if (
      !chapterRow ||
      translationChapterFingerprint(JSON.parse(chapterRow.chapter)) !==
        translationChapterFingerprint(book.chapters[source.chapterIndex])
    )
      throw new Error('translation_draft_source_changed');
    check(guard, scope);
    await ensureBookTranslationMigration(tx, book);
    const saved = await readSelectedTranslation(tx, book, scope.language, paragraphId);
    check(guard, scope);
    if (saved) {
      result = saved.text;
    } else {
      const draftRow = await tx.getFirstAsync<{ body: string }>(
        'SELECT body FROM translation_drafts WHERE book_id = ? AND scope_key = ? AND paragraph_id = ?',
        [book.id, scopeKey(scope), paragraphId],
      );
      check(guard, scope);
      if (!draftRow) throw new Error('translation_draft_missing');
      const draft = readDraft(JSON.parse(draftRow.body), book, source, scope);
      if (draft.parts.at(-1)?.end !== source.paragraph.text.length)
        throw new Error('translation_draft_incomplete');
      result = draft.parts.map((part) => part.text).join('\n\n');
      check(guard, scope);
      result = (await writeCompletedTranslation(tx, book, scope.language, paragraphId, result))
        .text;
      check(guard, scope);
    }
    check(guard, scope);
    await tx.runAsync(
      'DELETE FROM translation_drafts WHERE book_id = ? AND scope_key = ? AND paragraph_id = ?',
      [book.id, scopeKey(scope), paragraphId],
    );
    check(guard, scope);
  });
  notifyTranslationStore(handle, book.id);
  check(guard, scope);
  return result;
}
