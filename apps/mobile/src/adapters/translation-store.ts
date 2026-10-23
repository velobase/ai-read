import type { SQLiteDatabase } from 'expo-sqlite';
import {
  assertSameSavedTranslationVersion,
  portableTranslationKey,
  sha256,
  TRANSLATION_SOURCE_SCHEME,
  translationChapterFingerprint,
  utf8,
  validateSavedTranslationSelection,
  validateSavedTranslationVersion,
  type Book,
  type PortableTranslation,
  type SavedTranslationSelection,
  type SavedTranslationVersion,
} from '@bypage/reading-core';
import type { LibraryHandle } from './library-scope';

export type TranslationDisplay = {
  texts: Record<string, Record<string, string>>;
  keys: Record<string, Record<string, string>>;
};
export type TranslationStoreGuard = { signal: AbortSignal; isCurrent: () => boolean };

/** Schema only. The caller owns the database/transaction and its immutable scope. */
export async function ensureTranslationStore(tx: SQLiteDatabase): Promise<void> {
  await tx.execAsync(`
    CREATE TABLE IF NOT EXISTS translation_versions (
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      key TEXT NOT NULL, language TEXT NOT NULL, paragraph_id TEXT NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(book_id, key)
    );
    CREATE INDEX IF NOT EXISTS translation_versions_by_paragraph
      ON translation_versions(book_id, language, paragraph_id);
    CREATE TABLE IF NOT EXISTS translation_selections (
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      language TEXT NOT NULL, paragraph_id TEXT NOT NULL, key TEXT NOT NULL,
      PRIMARY KEY(book_id, language, paragraph_id),
      FOREIGN KEY(book_id, key) REFERENCES translation_versions(book_id, key) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS translation_migrations (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE
    );`);
}

const revisions = new Map<string, number>();
const listeners = new Set<(handle: LibraryHandle, bookId: string) => void>();
const changeKey = (handle: LibraryHandle, bookId: string) => JSON.stringify([handle.key, bookId]);
export function translationStoreRevision(handle: LibraryHandle, bookId: string): number {
  return revisions.get(changeKey(handle, bookId)) || 0;
}
/** Call only after commit. A rolled-back write must never publish a new display. */
export function notifyTranslationStore(handle: LibraryHandle, bookId: string): void {
  const key = changeKey(handle, bookId);
  revisions.set(key, (revisions.get(key) || 0) + 1);
  for (const listener of listeners) listener(handle, bookId);
}
export function subscribeTranslationStore(
  listener: (handle: LibraryHandle, bookId: string) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const sources = new WeakMap<
  Book,
  {
    locations: Map<string, number>;
    fingerprints: Map<number, string>;
  }
>();
function source(book: Book, paragraphId: string) {
  let index = sources.get(book);
  if (!index) {
    const locations = new Map<string, number>();
    book.chapters.forEach((chapter, i) => {
      for (const paragraph of chapter.paragraphs) locations.set(paragraph.id, i);
    });
    index = { locations, fingerprints: new Map() };
    sources.set(book, index);
  }
  const chapterIndex = index.locations.get(paragraphId);
  if (chapterIndex === undefined) throw new Error('invalid_saved_translation');
  let fingerprint = index.fingerprints.get(chapterIndex);
  if (!fingerprint) {
    fingerprint = translationChapterFingerprint(book.chapters[chapterIndex]);
    index.fingerprints.set(chapterIndex, fingerprint);
  }
  return { chapterIndex, sourceFingerprint: fingerprint };
}
function version(book: Book, language: string, paragraphId: string, key: string, text: string) {
  return validateSavedTranslationVersion(book, {
    version: 1,
    bookId: book.id,
    key,
    language,
    paragraphId,
    kind: key.endsWith(':portable-v1') ? 'portable' : 'saved',
    ...source(book, paragraphId),
    sourceScheme: TRANSLATION_SOURCE_SCHEME,
    text,
    textHash: sha256(utf8(text)),
    createdAt: Date.now(),
  });
}

export async function readStoredTranslationVersion(
  tx: SQLiteDatabase,
  book: Book,
  key: string,
): Promise<SavedTranslationVersion | null> {
  const row = await tx.getFirstAsync<{ language: string; paragraph_id: string; body: string }>(
    'SELECT language, paragraph_id, body FROM translation_versions WHERE book_id = ? AND key = ?',
    [book.id, key],
  );
  if (!row) return null;
  const value = validateSavedTranslationVersion(book, JSON.parse(row.body));
  if (
    value.key !== key ||
    value.language !== row.language ||
    value.paragraphId !== row.paragraph_id
  )
    throw new Error('invalid_saved_translation');
  return value;
}

async function insertVersion(tx: SQLiteDatabase, book: Book, value: SavedTranslationVersion) {
  const existing = await readStoredTranslationVersion(tx, book, value.key);
  if (existing) {
    assertSameSavedTranslationVersion(existing, value);
    return existing;
  }
  await tx.runAsync(
    'INSERT INTO translation_versions(book_id, key, language, paragraph_id, body) VALUES (?, ?, ?, ?, ?)',
    [book.id, value.key, value.language, value.paragraphId, JSON.stringify(value)],
  );
  return value;
}

/** Additive import: immutable conflicts abort; existing display choices win. */
export async function importTranslationVersions(
  tx: SQLiteDatabase,
  book: Book,
  versions: readonly SavedTranslationVersion[],
  selections: readonly SavedTranslationSelection[],
): Promise<void> {
  for (const raw of versions)
    await insertVersion(tx, book, validateSavedTranslationVersion(book, raw));
  for (const raw of selections) {
    const target = await readStoredTranslationVersion(tx, book, raw.key);
    const selection = validateSavedTranslationSelection(
      book,
      raw,
      new Map(target ? [[target.key, target]] : []),
    );
    await tx.runAsync(
      'INSERT OR IGNORE INTO translation_selections(book_id, language, paragraph_id, key) VALUES (?, ?, ?, ?)',
      [book.id, selection.language, selection.paragraphId, selection.key],
    );
  }
}

async function migrateLegacyRows(tx: SQLiteDatabase, book: Book): Promise<void> {
  const rows = await tx.getAllAsync<{ language: string; body: string }>(
    'SELECT language, body FROM translations WHERE book_id = ?',
    [book.id],
  );
  for (const row of rows) {
    const paragraphs: unknown = JSON.parse(row.body);
    if (!paragraphs || typeof paragraphs !== 'object' || Array.isArray(paragraphs))
      throw new Error('saved_translation_migration_invalid');
    for (const [paragraphId, text] of Object.entries(paragraphs)) {
      if (typeof text !== 'string') throw new Error('saved_translation_migration_invalid');
      const value = version(
        book,
        row.language,
        paragraphId,
        portableTranslationKey(row.language, paragraphId),
        text,
      );
      await importTranslationVersions(
        tx,
        book,
        [value],
        [
          {
            bookId: book.id,
            language: row.language,
            paragraphId,
            key: value.key,
          },
        ],
      );
    }
  }
}

/** Lazy, atomic and lossless: the old table and annotation keys are never rewritten. */
export async function ensureBookTranslationMigration(
  tx: SQLiteDatabase,
  book: Book,
): Promise<void> {
  const done = await tx.getFirstAsync(
    'SELECT book_id FROM translation_migrations WHERE book_id = ?',
    [book.id],
  );
  if (done) return;
  try {
    await migrateLegacyRows(tx, book);
  } catch (error) {
    if (error instanceof Error && error.message === 'saved_translation_immutable_conflict')
      throw error;
    throw new Error('saved_translation_migration_invalid');
  }
  await tx.runAsync('INSERT INTO translation_migrations(book_id) VALUES (?)', [book.id]);
}

/** Only genuine legacy maps enter the old table; selected saved versions never do. */
export async function importLegacyTranslations(
  tx: SQLiteDatabase,
  book: Book,
  entries: readonly PortableTranslation[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.bookId !== book.id) throw new Error('invalid_saved_translation');
    const old = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM translations WHERE book_id = ? AND language = ?',
      [book.id, entry.language],
    );
    const merged = { ...entry.paragraphs, ...(old ? JSON.parse(old.body) : {}) };
    await tx.runAsync(
      'INSERT INTO translations(book_id, language, body) VALUES (?, ?, ?) ON CONFLICT(book_id, language) DO UPDATE SET body = excluded.body',
      [book.id, entry.language, JSON.stringify(merged)],
    );
  }
  if (entries.length) await migrateLegacyRows(tx, book);
}

export async function readSelectedTranslation(
  tx: SQLiteDatabase,
  book: Book,
  language: string,
  paragraphId: string,
): Promise<SavedTranslationVersion | null> {
  const row = await tx.getFirstAsync<{ key: string }>(
    'SELECT key FROM translation_selections WHERE book_id = ? AND language = ? AND paragraph_id = ?',
    [book.id, language, paragraphId],
  );
  if (!row) return null;
  const target = await readStoredTranslationVersion(tx, book, row.key);
  if (!target || target.language !== language || target.paragraphId !== paragraphId)
    throw new Error('invalid_saved_translation');
  return target;
}

export async function readTranslationDisplay(
  tx: SQLiteDatabase,
  book: Book,
): Promise<TranslationDisplay> {
  const rows = await tx.getAllAsync<{
    language: string;
    paragraph_id: string;
    key: string;
    body: string;
  }>(
    `SELECT s.language, s.paragraph_id, s.key, v.body FROM translation_selections s
     JOIN translation_versions v ON v.book_id = s.book_id AND v.key = s.key WHERE s.book_id = ?`,
    [book.id],
  );
  const texts: TranslationDisplay['texts'] = Object.create(null);
  const keys: TranslationDisplay['keys'] = Object.create(null);
  for (const row of rows) {
    const value = validateSavedTranslationVersion(book, JSON.parse(row.body));
    if (
      value.key !== row.key ||
      value.language !== row.language ||
      value.paragraphId !== row.paragraph_id
    )
      throw new Error('invalid_saved_translation');
    texts[value.language] ||= Object.create(null);
    keys[value.language] ||= Object.create(null);
    texts[value.language][value.paragraphId] = value.text;
    keys[value.language][value.paragraphId] = value.key;
  }
  return { texts, keys };
}
