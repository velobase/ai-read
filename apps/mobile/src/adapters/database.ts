import * as SQLite from 'expo-sqlite';
import { measured } from './diagnostics';
import {
  ensureLibrarySyncSchema,
  stageSyncMutation,
  stageBookSyncMutation,
  notifyLibraryMutations,
} from './library-sync-outbox';
import {
  assertLibraryHandle,
  deviceLibrary,
  type LibraryHandle,
  type LibraryLease,
} from './library-scope';
import {
  ensureTranslationStore,
  ensureBookTranslationMigration,
  importLegacyTranslations,
  importTranslationVersions,
  notifyTranslationStore,
  readTranslationDisplay,
  readStoredTranslationVersion,
  writeCompletedTranslation,
  type TranslationDisplay,
  type TranslationStoreGuard,
} from './translation-store';
import {
  ensureCollectionSchema,
  mergePortableCollections,
  notifyCollections,
  readPortableCollections,
} from './collections-storage';
import {
  sampleBook,
  sameBookContent,
  isBookSourceLanguage,
  effectiveBookLanguage,
  supplementBookMedia,
  supplementBookReferences,
  sampleTranslations,
  validateBook,
  validatePortableLibrary,
  readingProgress,
  normalizeSearch,
  validSyncId,
  validateBookmark,
  bookmarkLocationKey,
  MAX_BOOKMARKS_PER_BOOK,
  validateSavedTranslationVersion,
  type SavedTranslationVersion,
  type SavedTranslationSelection,
  type Book,
  type Bookmark,
  type Note,
  type Position,
  type PortableLibrary,
} from '@bypage/reading-core';

export type ShelfBook = Pick<
  Book,
  | 'id'
  | 'title'
  | 'author'
  | 'language'
  | 'sourceLanguage'
  | 'sample'
  | 'cover'
  | 'subtitle'
  | 'category'
  | 'description'
> & {
  chapters: number;
  importedAt: number;
  progress: number;
  lastOpened: number;
  hasPosition: boolean;
  finished: boolean;
  noteCount: number;
};
const connections = new Map<string, Promise<SQLite.SQLiteDatabase>>();

/** App preferences always address the device library, never an active account. */
function deviceDatabase(): Promise<SQLite.SQLiteDatabase> {
  return openLibraryDatabase(deviceLibrary);
}

/** Opens only this immutable handle. Creating an account handle does not call it. */
export function openLibraryDatabase(handle: LibraryHandle): Promise<SQLite.SQLiteDatabase> {
  assertLibraryHandle(handle);
  const existing = connections.get(handle.key);
  if (existing) return existing;
  const pending = initialize(handle);
  connections.set(handle.key, pending);
  void pending.catch(() => {
    // A late initialization failure must not discard another connection.
    if (connections.get(handle.key) === pending) connections.delete(handle.key);
  });
  return pending;
}

async function initialize(handle: LibraryHandle) {
  const db = await SQLite.openDatabaseAsync(handle.databaseName);
  try {
    await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, language TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, chapters INTEGER NOT NULL, body TEXT NOT NULL, imported_at INTEGER NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0, progress REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS positions (book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT NOT NULL, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(book_id, id));
    CREATE INDEX IF NOT EXISTS notes_by_time ON notes(created_at DESC);
    CREATE INDEX IF NOT EXISTS notes_by_page ON notes(created_at DESC, book_id DESC, id DESC);
    CREATE INDEX IF NOT EXISTS notes_by_book_time ON notes(book_id, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS bookmarks (id TEXT NOT NULL, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, location TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(book_id, id));
    CREATE INDEX IF NOT EXISTS bookmarks_by_book_time ON bookmarks(book_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS bookmarks_by_book_location ON bookmarks(book_id, location);
    CREATE TABLE IF NOT EXISTS assistant_history (id TEXT NOT NULL, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(book_id, id));
    CREATE INDEX IF NOT EXISTS assistant_history_by_book_time ON assistant_history(book_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS assistant_history_by_identity_time ON assistant_history(book_id, json_extract(body, '$.partition.origin'), json_extract(body, '$.partition.accountId'), created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS translations (book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, language TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(book_id, language));
    CREATE TABLE IF NOT EXISTS translation_drafts (book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, scope_key TEXT NOT NULL, paragraph_id TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(book_id, scope_key, paragraph_id));
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version = 1;`);
    await ensureTranslationStore(db);
    if (handle.kind === 'account') {
      await ensureLibrarySyncSchema(db);
      await ensureCollectionSchema(db);
      await db.withExclusiveTransactionAsync(async (tx) => {
        const scope = await tx.getFirstAsync<{ value: string }>(
          'SELECT value FROM preferences WHERE key = ?',
          ['library_scope'],
        );
        if (scope && scope.value !== handle.key) throw new Error('library_scope_mismatch');
        await tx.runAsync('INSERT OR IGNORE INTO preferences(key, value) VALUES (?, ?)', [
          'library_scope',
          handle.key,
        ]);
        await tx.runAsync('INSERT OR IGNORE INTO preferences(key, value) VALUES (?, ?)', [
          'initialized',
          'true',
        ]);
      });
    } else {
      const seeded = await db.getFirstAsync('SELECT key FROM preferences WHERE key = ?', [
        'initialized',
      ]);
      if (!seeded) {
        await db.withExclusiveTransactionAsync(async (tx) => {
          await insertBook(tx, sampleBook);
          await tx.runAsync(
            'INSERT OR IGNORE INTO translations(book_id, language, body) VALUES (?, ?, ?)',
            [
              sampleBook.id,
              'zh-CN',
              JSON.stringify(
                Object.fromEntries(
                  Object.entries(sampleTranslations).map(([key, text]) => [key.slice(6, -7), text]),
                ),
              ),
            ],
          );
          await tx.runAsync('INSERT OR IGNORE INTO preferences(key, value) VALUES (?, ?)', [
            'initialized',
            'true',
          ]);
        });
      }
    }
    return db;
  } catch (error) {
    // Initialization has not published this connection to any caller yet.
    await db.closeAsync().catch(() => {});
    throw error;
  }
}
async function insertBook(db: SQLite.SQLiteDatabase, book: Book): Promise<boolean> {
  const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM books WHERE id = ?', [
    book.id,
  ]);
  if (row) {
    const existing = validateBook(JSON.parse(row.body));
    if (!sameBookContent(existing, book)) throw new Error('Book content conflict');
    const supplemented = supplementBookReferences(supplementBookMedia(existing, book), book);
    // Supplement navigation without changing the chapter text/title used by saved
    // translation hashes, or any notes, progress and user-facing book metadata.
    if (
      supplemented !== existing ||
      (!existing.toc?.length && book.toc?.length) ||
      (!existing.sourceFormat && book.sourceFormat) ||
      (existing.sourceLanguage === undefined && book.sourceLanguage !== undefined) ||
      (!existing.cover && book.cover)
    ) {
      await db.runAsync('UPDATE books SET body = ? WHERE id = ?', [
        JSON.stringify({
          ...supplemented,
          toc: existing.toc?.length ? existing.toc : book.toc,
          sourceFormat: existing.sourceFormat || book.sourceFormat,
          sourceLanguage: existing.sourceLanguage ?? book.sourceLanguage,
          cover: existing.cover || book.cover,
        }),
        book.id,
      ]);
      return true;
    }
    return false;
  }
  await db.runAsync(
    'INSERT OR IGNORE INTO books(id, title, author, language, sample, chapters, body, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      book.id,
      book.title,
      book.author,
      book.language,
      book.sample ? 1 : 0,
      book.chapters.length,
      JSON.stringify(book),
      book.importedAt,
    ],
  );
  return true;
}
export async function listBooks(handle: LibraryHandle): Promise<ShelfBook[]> {
  const db = await openLibraryDatabase(handle);
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    author: string;
    language: string;
    sourceLanguage: string | null;
    sample: number;
    chapters: number;
    importedAt: number;
    progress: number;
    lastOpened: number;
    hasPosition: number;
    finished: number;
    noteCount: number;
  }>(
    `SELECT b.id, b.title, b.author, b.language, json_extract(b.body, '$.sourceLanguage') AS sourceLanguage, b.sample, b.chapters, b.imported_at AS importedAt, json_extract(b.body, '$.subtitle') AS subtitle, json_extract(b.body, '$.category') AS category, json_extract(b.body, '$.description') AS description, b.progress, b.last_opened AS lastOpened, EXISTS(SELECT 1 FROM positions p WHERE p.book_id = b.id) AS hasPosition, b.finished, (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS noteCount FROM books b ORDER BY b.last_opened DESC, b.imported_at DESC`,
  );
  return rows.map((row) => ({
    ...row,
    sourceLanguage: row.sourceLanguage ?? undefined,
    sample: !!row.sample,
    hasPosition: !!row.hasPosition,
    finished: !!row.finished,
  }));
}
/** Covers are fetched only for mounted tiles, keeping shelf metadata light. */
export async function getBookCover(handle: LibraryHandle, id: string): Promise<string | undefined> {
  const row = await (
    await openLibraryDatabase(handle)
  ).getFirstAsync<{ cover: string | null }>(
    "SELECT json_extract(body, '$.cover') AS cover FROM books WHERE id = ?",
    [id],
  );
  return row?.cover || undefined;
}
export async function getBook(handle: LibraryHandle, id: string): Promise<Book | null> {
  const row = await (
    await openLibraryDatabase(handle)
  ).getFirstAsync<{ body: string }>('SELECT body FROM books WHERE id = ?', [id]);
  return row ? validateBook(JSON.parse(row.body)) : null;
}
export async function addBook(handle: LibraryHandle, book: Book) {
  const clean = validateBook(book);
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await insertBook(tx, clean)) await stageBookSyncMutation(tx, handle, clean.id);
  });
  notifyLibraryMutations(handle);
}
/** The imported language stays unchanged, preserving existing translation identities. */
export async function setBookSourceLanguage(
  handle: LibraryHandle,
  id: string,
  sourceLanguage: string,
): Promise<Book> {
  if (!isBookSourceLanguage(sourceLanguage)) throw new Error('Invalid source language');
  const db = await openLibraryDatabase(handle);
  let updated: Book | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ body: string }>('SELECT body FROM books WHERE id = ?', [
      id,
    ]);
    if (!row) throw new Error('Book not found');
    // Import and getBook validate the stored book; this metadata edit must not
    // decode and hash every illustration again or normalize unrelated fields.
    updated = { ...(JSON.parse(row.body) as Book), sourceLanguage };
    await tx.runAsync('UPDATE books SET body = ? WHERE id = ?', [JSON.stringify(updated), id]);
    await stageBookSyncMutation(tx, handle, id);
  });
  notifyLibraryMutations(handle);
  return updated!;
}
export async function removeBook(handle: LibraryHandle, id: string) {
  const db = await openLibraryDatabase(handle);
  if (handle.kind === 'account') {
    const { captureLocalBookRecovery } = await import('./library-sync-storage');
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (!(await tx.getFirstAsync('SELECT id FROM books WHERE id = ?', [id]))) return;
      await captureLocalBookRecovery(tx, id, 'local-book-deleted');
      await stageSyncMutation(tx, handle, { entity: 'book', bookId: id, id, deleted: true });
      // Recovery already contains these pending children. The server book tombstone
      // cascades them; sending old children afterwards would try to revive the parent.
      await tx.runAsync("DELETE FROM library_sync_state WHERE book_id = ? AND entity != 'book'", [
        id,
      ]);
      await tx.runAsync('DELETE FROM books WHERE id = ?', [id]);
    });
    notifyLibraryMutations(handle);
  } else await db.runAsync('DELETE FROM books WHERE id = ?', [id]);
  notifyCollections(handle);
  if (handle.kind === 'device' && /^[a-f0-9]{64}\.pdf(?:kit|js)-/i.test(id)) {
    // Account originals remain available to recovery; device cleanup is unchanged.
    await measured('pdf.original.cleanup', async () => {
      const pdf = await import('./pdf');
      await pdf.removePdfOriginal(handle, id);
    }).catch(() => {});
  }
}
export async function markFinished(handle: LibraryHandle, id: string, finished: boolean) {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync('UPDATE books SET finished = ? WHERE id = ?', [
      finished ? 1 : 0,
      id,
    ]);
    if (result.changes && handle.kind === 'account') {
      const position = await tx.getFirstAsync('SELECT book_id FROM positions WHERE book_id = ?', [
        id,
      ]);
      await stageBookSyncMutation(tx, handle, id, {
        status: finished ? 'finished' : position ? 'reading' : 'unread',
      });
    }
  });
  notifyLibraryMutations(handle);
}
export async function getPosition(
  handle: LibraryHandle,
  id: string,
): Promise<Position | undefined> {
  const row = await (
    await openLibraryDatabase(handle)
  ).getFirstAsync<{ body: string }>('SELECT body FROM positions WHERE book_id = ?', [id]);
  return row ? JSON.parse(row.body) : undefined;
}
export async function savePosition(handle: LibraryHandle, book: Book, position: Position) {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO positions(book_id, body) VALUES (?, ?) ON CONFLICT(book_id) DO UPDATE SET body = excluded.body',
      [book.id, JSON.stringify(position)],
    );
    const now = Date.now();
    await tx.runAsync('UPDATE books SET progress = ?, last_opened = ? WHERE id = ?', [
      readingProgress(book.chapters, position),
      now,
      book.id,
    ]);
    if (handle.kind === 'account') {
      await stageSyncMutation(tx, handle, {
        entity: 'position',
        bookId: book.id,
        id: book.id,
        data: position,
      });
      const row = await tx.getFirstAsync<{ finished: number }>(
        'SELECT finished FROM books WHERE id = ?',
        [book.id],
      );
      await stageBookSyncMutation(tx, handle, book.id, {
        status: row?.finished ? 'finished' : 'reading',
        lastOpenedAt: now,
      });
    }
  });
  notifyLibraryMutations(handle);
}
export async function listNotes(
  handle: LibraryHandle,
  bookId?: string,
  limit = 200,
): Promise<Note[]> {
  const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100000, limit)) : 200;
  const rows = await (
    await openLibraryDatabase(handle)
  ).getAllAsync<{ body: string }>(
    `SELECT body FROM notes ${bookId ? 'WHERE book_id = ?' : ''} ORDER BY created_at DESC, book_id DESC, id DESC LIMIT ?`,
    bookId ? [bookId, count] : [count],
  );
  return rows.map((row) => JSON.parse(row.body));
}

export type NotePageCursor = { createdAt: number; bookId: string; id: string };
export type NotePage = { notes: Note[]; nextCursor?: NotePageCursor };

/** Read one page in stable order, scanning only bounded batches for a search query. */
export async function readNotesPage(
  handle: LibraryHandle,
  options: {
    bookId?: string;
    query?: string;
    after?: NotePageCursor;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<NotePage> {
  return measured('notes.page', async () => {
    const { bookId, signal } = options;
    const checkCancelled = () => {
      if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    };
    checkCancelled();
    if (bookId !== undefined && !validSyncId(bookId)) throw new Error('notes_scope_invalid');
    const after = options.after;
    if (
      after !== undefined &&
      (!after ||
        !Number.isFinite(after.createdAt) ||
        after.createdAt < 0 ||
        after.createdAt > 8640000000000000 ||
        !validSyncId(after.bookId) ||
        !validSyncId(after.id) ||
        (bookId !== undefined && after.bookId !== bookId))
    )
      throw new Error('notes_cursor_invalid');
    const limit =
      Number.isFinite(options.limit) && options.limit! > 0
        ? Math.min(200, Math.max(1, Math.floor(options.limit!)))
        : 60;
    const needle = normalizeSearch((options.query || '').trim());
    let cursor = after ? { ...after } : undefined;
    let lastReturned: NotePageCursor | undefined;
    const notes: Note[] = [];
    const db = await openLibraryDatabase(handle);
    checkCancelled();
    type Row = { id: string; book_id: string; created_at: number; body: string; title: string };
    while (true) {
      checkCancelled();
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      if (bookId !== undefined) {
        conditions.push('n.book_id = ?');
        params.push(bookId);
      }
      if (cursor) {
        conditions.push('(n.created_at, n.book_id, n.id) < (?, ?, ?)');
        params.push(cursor.createdAt, cursor.bookId, cursor.id);
      }
      const rows = await db.getAllAsync<Row>(
        `SELECT n.id, n.book_id, n.created_at, n.body, b.title
       FROM notes n JOIN books b ON b.id = n.book_id
       ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
       ORDER BY n.created_at DESC, n.book_id DESC, n.id DESC LIMIT 64`,
        params,
      );
      checkCancelled();
      let characters = 0;
      for (const row of rows) {
        checkCancelled();
        const note = JSON.parse(row.body) as Note;
        if (
          !note ||
          note.id !== row.id ||
          note.bookId !== row.book_id ||
          typeof note.quote !== 'string' ||
          typeof note.text !== 'string'
        )
          throw new Error('notes_data_invalid');
        if (
          !needle ||
          normalizeSearch(`${note.quote} ${note.text} ${row.title}`).includes(needle)
        ) {
          // Probe one more matching row, but return the last included row as the boundary.
          if (notes.length === limit) return { notes, nextCursor: lastReturned! };
          notes.push(note);
          lastReturned = { createdAt: row.created_at, bookId: row.book_id, id: row.id };
        }
        characters += row.body.length;
        if (characters >= 64000) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          checkCancelled();
          characters = 0;
        }
      }
      if (rows.length < 64) return { notes };
      const lastScanned = rows[rows.length - 1];
      cursor = {
        createdAt: lastScanned.created_at,
        bookId: lastScanned.book_id,
        id: lastScanned.id,
      };
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      checkCancelled();
    }
  });
}

/** Compatibility for callers that only need the first search page. */
export async function searchNotes(
  handle: LibraryHandle,
  bookId: string | undefined,
  query: string,
  signal: AbortSignal,
) {
  if (!normalizeSearch(query.trim())) return { notes: [] as Note[], limited: false };
  const page = await readNotesPage(handle, { bookId, query, signal, limit: 60 });
  return { notes: page.notes, limited: Boolean(page.nextCursor) };
}
export async function saveNote(handle: LibraryHandle, note: Note) {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO notes(id, book_id, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(book_id, id) DO UPDATE SET body = excluded.body',
      [note.id, note.bookId, JSON.stringify(note), note.createdAt],
    );
    await stageSyncMutation(tx, handle, {
      entity: 'note',
      bookId: note.bookId,
      id: note.id,
      data: note,
    });
  });
  notifyLibraryMutations(handle);
}
/** Edit an existing thought without replacing its saved excerpt or reviving a deleted note. */
export async function updateNoteText(
  handle: LibraryHandle,
  expected: Note,
  text: string,
): Promise<Note> {
  if (typeof text !== 'string' || text.trim().length > 50000) throw new Error('note_text_too_long');
  const thought = text.trim();
  const snapshot = {
    ...expected,
    ...(expected.anchor ? { anchor: { ...expected.anchor } } : {}),
  };
  const db = await openLibraryDatabase(handle);
  let saved: Note | undefined;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM notes WHERE book_id = ? AND id = ?',
      [snapshot.bookId, snapshot.id],
    );
    if (!row) throw new Error('note_missing');
    const current = JSON.parse(row.body) as Note;
    if (
      current.id !== snapshot.id ||
      current.bookId !== snapshot.bookId ||
      current.paragraphId !== snapshot.paragraphId ||
      current.quote !== snapshot.quote ||
      current.text !== snapshot.text ||
      current.createdAt !== snapshot.createdAt ||
      !!current.anchor !== !!snapshot.anchor ||
      current.anchor?.source !== snapshot.anchor?.source ||
      current.anchor?.start !== snapshot.anchor?.start ||
      current.anchor?.end !== snapshot.anchor?.end ||
      current.anchor?.translationKey !== snapshot.anchor?.translationKey
    )
      throw new Error('note_changed');
    // Keep every stored field, including any metadata unknown to this app version.
    const next: Note = { ...current, text: thought };
    const result = await tx.runAsync(
      'UPDATE notes SET body = ? WHERE book_id = ? AND id = ? AND body = ?',
      [JSON.stringify(next), snapshot.bookId, snapshot.id, row.body],
    );
    if (result.changes !== 1) throw new Error('note_changed');
    await stageSyncMutation(tx, handle, {
      entity: 'note',
      bookId: next.bookId,
      id: next.id,
      data: next,
    });
    saved = next;
  });
  notifyLibraryMutations(handle);
  return saved!;
}
export async function removeNote(handle: LibraryHandle, note: Note) {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync('DELETE FROM notes WHERE book_id = ? AND id = ?', [
      note.bookId,
      note.id,
    ]);
    if (result.changes)
      await stageSyncMutation(tx, handle, {
        entity: 'note',
        bookId: note.bookId,
        id: note.id,
        deleted: true,
      });
  });
  notifyLibraryMutations(handle);
}
export async function listBookmarks(handle: LibraryHandle, book: Book): Promise<Bookmark[]> {
  const rows = await (
    await openLibraryDatabase(handle)
  ).getAllAsync<{ body: string }>(
    'SELECT body FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC, id DESC',
    [book.id],
  );
  return rows.map((row) => validateBookmark(book, JSON.parse(row.body)));
}
/** New captures deduplicate locations; restore retains distinct IDs and their user labels. */
async function insertBookmark(
  db: SQLite.SQLiteDatabase,
  bookmark: Bookmark,
  handle: LibraryHandle,
  dedupeLocation = false,
): Promise<Bookmark> {
  const location = bookmarkLocationKey(bookmark);
  const existing = await db.getFirstAsync<{ body: string }>(
    `SELECT body FROM bookmarks WHERE book_id = ? AND (id = ? ${dedupeLocation ? 'OR location = ?' : ''}) ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1`,
    dedupeLocation
      ? [bookmark.bookId, bookmark.id, location, bookmark.id]
      : [bookmark.bookId, bookmark.id, bookmark.id],
  );
  if (existing) return JSON.parse(existing.body) as Bookmark;
  const count = await db.getFirstAsync<{ per_book: number }>(
    'SELECT COUNT(*) AS per_book FROM bookmarks WHERE book_id = ?',
    [bookmark.bookId],
  );
  if ((count?.per_book || 0) >= MAX_BOOKMARKS_PER_BOOK) throw new Error('bookmark_limit');
  await db.runAsync(
    'INSERT INTO bookmarks(id, book_id, location, body, created_at) VALUES (?, ?, ?, ?, ?)',
    [bookmark.id, bookmark.bookId, location, JSON.stringify(bookmark), bookmark.createdAt],
  );
  await stageSyncMutation(db, handle, {
    entity: 'bookmark',
    bookId: bookmark.bookId,
    id: bookmark.id,
    data: bookmark,
  });
  return bookmark;
}
export async function saveBookmark(
  handle: LibraryHandle,
  book: Book,
  value: Bookmark,
): Promise<Bookmark> {
  const bookmark = validateBookmark(book, value);
  const db = await openLibraryDatabase(handle);
  let saved = bookmark;
  await db.withExclusiveTransactionAsync(async (tx) => {
    saved = await insertBookmark(tx, bookmark, handle, true);
  });
  notifyLibraryMutations(handle);
  return saved;
}
export async function renameBookmark(
  handle: LibraryHandle,
  book: Book,
  id: string,
  label: string,
  expected?: Bookmark,
): Promise<void> {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM bookmarks WHERE book_id = ? AND id = ?',
      [book.id, id],
    );
    if (!row) throw new Error('bookmark_missing');
    if (
      expected &&
      JSON.stringify(validateBookmark(book, JSON.parse(row.body))) !==
        JSON.stringify(validateBookmark(book, expected))
    )
      throw new Error('bookmark_changed');
    const bookmark = validateBookmark(book, { ...JSON.parse(row.body), label });
    await tx.runAsync('UPDATE bookmarks SET body = ? WHERE book_id = ? AND id = ?', [
      JSON.stringify(bookmark),
      book.id,
      id,
    ]);
    await stageSyncMutation(tx, handle, {
      entity: 'bookmark',
      bookId: book.id,
      id,
      data: bookmark,
    });
  });
  notifyLibraryMutations(handle);
}
export async function removeBookmark(
  handle: LibraryHandle,
  book: Book,
  id: string,
  expected?: Bookmark,
): Promise<void> {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM bookmarks WHERE book_id = ? AND id = ?',
      [book.id, id],
    );
    if (!row) throw new Error('bookmark_missing');
    if (
      expected &&
      JSON.stringify(validateBookmark(book, JSON.parse(row.body))) !==
        JSON.stringify(validateBookmark(book, expected))
    )
      throw new Error('bookmark_changed');
    await tx.runAsync('DELETE FROM bookmarks WHERE book_id = ? AND id = ?', [book.id, id]);
    await stageSyncMutation(tx, handle, { entity: 'bookmark', bookId: book.id, id, deleted: true });
  });
  notifyLibraryMutations(handle);
}
/** Both dictionaries come from one committed selection/version snapshot. */
export async function getTranslationDisplay(
  handle: LibraryHandle,
  id: string,
): Promise<TranslationDisplay> {
  const db = await openLibraryDatabase(handle);
  let result: TranslationDisplay = { texts: {}, keys: {} };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const book = await storedTranslationBook(tx, id);
    if (!book) return;
    await ensureBookTranslationMigration(tx, book);
    result = await readTranslationDisplay(tx, book);
  });
  return result;
}
export async function getTranslations(
  handle: LibraryHandle,
  id: string,
): Promise<Record<string, Record<string, string>>> {
  return (await getTranslationDisplay(handle, id)).texts;
}
async function storedTranslationBook(tx: SQLite.SQLiteDatabase, id: string): Promise<Book | null> {
  const row = await tx.getFirstAsync<{ body: string }>(
    "SELECT json_remove(body, '$.media', '$.references', '$.toc', '$.cover') AS body FROM books WHERE id = ?",
    [id],
  );
  return row ? validateBook(JSON.parse(row.body)) : null;
}
/** Exact lookup is independent of the currently selected display version. */
export async function readExactTranslation(
  handle: LibraryHandle,
  bookId: string,
  key: string,
): Promise<SavedTranslationVersion | null> {
  return (await readExactTranslations(handle, bookId, [key]))[key] || null;
}
/** One source-proof snapshot for history/search, without repeatedly parsing a whole book. */
export async function readExactTranslations(
  handle: LibraryHandle,
  bookId: string,
  keys: readonly string[],
): Promise<Record<string, SavedTranslationVersion>> {
  if (keys.length > 1000) throw new Error('saved_translation_lookup_limit');
  const unique = [...new Set(keys.filter((key) => typeof key === 'string' && validSyncId(key)))];
  const result: Record<string, SavedTranslationVersion> = Object.create(null);
  if (!unique.length) return result;
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const book = await storedTranslationBook(tx, bookId);
    if (!book) return;
    await ensureBookTranslationMigration(tx, book);
    for (let offset = 0; offset < unique.length; offset += 400) {
      const batch = unique.slice(offset, offset + 400);
      const rows = await tx.getAllAsync<{
        key: string;
        language: string;
        paragraph_id: string;
        body: string;
      }>(
        `SELECT key, language, paragraph_id, body FROM translation_versions WHERE book_id = ? AND key IN (${batch.map(() => '?').join(',')})`,
        [bookId, ...batch],
      );
      for (const row of rows) {
        const version = validateSavedTranslationVersion(book, JSON.parse(row.body));
        if (
          version.key !== row.key ||
          version.language !== row.language ||
          version.paragraphId !== row.paragraph_id
        )
          throw new Error('invalid_saved_translation');
        result[version.key] = version;
      }
    }
  });
  return result;
}
export async function listParagraphTranslationVersions(
  handle: LibraryHandle,
  bookId: string,
  language: string,
  paragraphId: string,
): Promise<SavedTranslationVersion[]> {
  const db = await openLibraryDatabase(handle);
  let result: SavedTranslationVersion[] = [];
  await db.withExclusiveTransactionAsync(async (tx) => {
    const book = await storedTranslationBook(tx, bookId);
    if (!book) return;
    await ensureBookTranslationMigration(tx, book);
    const rows = await tx.getAllAsync<{ key: string; body: string }>(
      'SELECT key, body FROM translation_versions WHERE book_id = ? AND language = ? AND paragraph_id = ?',
      [bookId, language, paragraphId],
    );
    result = rows
      .map((row) => {
        const value = validateSavedTranslationVersion(book, JSON.parse(row.body));
        if (
          value.key !== row.key ||
          value.language !== language ||
          value.paragraphId !== paragraphId
        )
          throw new Error('invalid_saved_translation');
        return value;
      })
      .sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key));
  });
  return result;
}
export async function selectParagraphTranslationVersion(
  lease: LibraryLease,
  bookId: string,
  key: string,
  guard?: TranslationStoreGuard,
): Promise<SavedTranslationVersion> {
  const check = () => {
    lease.assertCurrent();
    if (guard && (guard.signal.aborted || !guard.isCurrent()))
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  const db = await openLibraryDatabase(lease.handle);
  let selected!: SavedTranslationVersion;
  await db.withExclusiveTransactionAsync(async (tx) => {
    check();
    const book = await storedTranslationBook(tx, bookId);
    if (!book) throw new Error('book_missing');
    await ensureBookTranslationMigration(tx, book);
    const target = await readStoredTranslationVersion(tx, book, key);
    if (!target) throw new Error('saved_translation_missing');
    check();
    await tx.runAsync(
      'INSERT INTO translation_selections(book_id, language, paragraph_id, key) VALUES (?, ?, ?, ?) ON CONFLICT(book_id, language, paragraph_id) DO UPDATE SET key = excluded.key',
      [bookId, target.language, target.paragraphId, target.key],
    );
    check();
    selected = target;
  });
  notifyTranslationStore(lease.handle, bookId);
  check();
  return selected;
}
/** Commit only a completed paragraph; an existing selected translation always wins. */
export async function saveTranslatedParagraph(
  handle: LibraryHandle,
  book: Book,
  language: string,
  paragraph: string,
  text: string,
  guard?: TranslationStoreGuard,
): Promise<string> {
  const check = () => {
    if (guard && (guard.signal.aborted || !guard.isCurrent()))
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  const db = await openLibraryDatabase(handle);
  let saved = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    check();
    const stored = await storedTranslationBook(tx, book.id);
    if (
      !stored ||
      !sameBookContent(stored, book) ||
      effectiveBookLanguage(stored) !== effectiveBookLanguage(book)
    )
      throw new Error('translation_source_changed');
    saved = (await writeCompletedTranslation(tx, stored, language, paragraph, text)).text;
    check();
  });
  notifyTranslationStore(handle, book.id);
  check();
  return saved;
}
export async function getPreference<T>(key: string, fallback: T): Promise<T> {
  const row = await (
    await deviceDatabase()
  ).getFirstAsync<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}
export async function setPreference(key: string, value: unknown) {
  await (
    await deviceDatabase()
  ).runAsync(
    'INSERT INTO preferences(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}
/** Additive import: existing books, notes and reading positions win conflicts. */
export async function importLibrary(handle: LibraryHandle, raw: unknown) {
  const pack = validatePortableLibrary(raw);
  const db = await openLibraryDatabase(handle);
  if (pack.collections?.length) await ensureCollectionSchema(db);
  let collectionsChanged = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const changedBooks = new Set<string>();
    const importedPositions = new Set<string>();
    const translationBooks = new Map<string, Book>();
    for (const book of pack.backup.books) {
      if (await insertBook(tx, book)) changedBooks.add(book.id);
      const stored = (await storedTranslationBook(tx, book.id))!;
      translationBooks.set(book.id, stored);
      // Preserve a pre-existing legacy display before considering imported choices.
      await ensureBookTranslationMigration(tx, stored);
      const position = pack.backup.positions[book.id];
      if (position) {
        const result = await tx.runAsync(
          'INSERT OR IGNORE INTO positions(book_id, body) VALUES (?, ?)',
          [book.id, JSON.stringify(position)],
        );
        if (result.changes) {
          await tx.runAsync('UPDATE books SET progress = ? WHERE id = ?', [
            readingProgress(book.chapters, position),
            book.id,
          ]);
          await stageSyncMutation(tx, handle, {
            entity: 'position',
            bookId: book.id,
            id: book.id,
            data: position,
          });
          changedBooks.add(book.id);
          importedPositions.add(book.id);
        }
      }
    }
    for (const note of pack.backup.notes) {
      const result = await tx.runAsync(
        'INSERT OR IGNORE INTO notes(id, book_id, body, created_at) VALUES (?, ?, ?, ?)',
        [note.id, note.bookId, JSON.stringify(note), note.createdAt],
      );
      if (result.changes)
        await stageSyncMutation(tx, handle, {
          entity: 'note',
          bookId: note.bookId,
          id: note.id,
          data: note,
        });
    }
    for (const bookmark of pack.backup.bookmarks || []) await insertBookmark(tx, bookmark, handle);
    const versionsByBook = new Map<string, SavedTranslationVersion[]>();
    const selectionsByBook = new Map<string, SavedTranslationSelection[]>();
    if (pack.version === 2) {
      for (const value of pack.translationVersions) {
        let versions = versionsByBook.get(value.bookId);
        if (!versions) versionsByBook.set(value.bookId, (versions = []));
        versions.push(value);
      }
      for (const value of pack.translationSelections) {
        let selections = selectionsByBook.get(value.bookId);
        if (!selections) selectionsByBook.set(value.bookId, (selections = []));
        selections.push(value);
      }
    }
    for (const [id, book] of translationBooks) {
      await importTranslationVersions(
        tx,
        book,
        versionsByBook.get(id) || [],
        selectionsByBook.get(id) || [],
      );
      await importLegacyTranslations(
        tx,
        book,
        pack.translations.filter((entry) => entry.bookId === id),
      );
    }
    if (pack.collections?.length) {
      // Existing membership wins imports. Stage only membership changes, after the merge.
      const before = new Map<string, string | undefined>();
      if (handle.kind === 'account')
        for (const id of new Set(pack.collections.flatMap((group) => group.bookIds))) {
          const row = await tx.getFirstAsync<{ name: string }>(
            'SELECT c.name FROM book_collections m JOIN shelf_collections c ON c.id = m.collection_id WHERE m.book_id = ?',
            [id],
          );
          before.set(id, row?.name);
        }
      collectionsChanged = await mergePortableCollections(tx, pack.collections);
      for (const [id, previous] of before) {
        const row = await tx.getFirstAsync<{ name: string }>(
          'SELECT c.name FROM book_collections m JOIN shelf_collections c ON c.id = m.collection_id WHERE m.book_id = ?',
          [id],
        );
        if (row?.name !== previous) {
          changedBooks.add(id);
        }
      }
    }
    for (const id of changedBooks) {
      const row =
        handle.kind === 'account' && importedPositions.has(id)
          ? await tx.getFirstAsync<{ finished: number }>(
              'SELECT finished FROM books WHERE id = ?',
              [id],
            )
          : undefined;
      await stageBookSyncMutation(
        tx,
        handle,
        id,
        row ? { status: row.finished ? 'finished' : 'reading' } : {},
      );
    }
  });
  notifyLibraryMutations(handle);
  for (const book of pack.backup.books) notifyTranslationStore(handle, book.id);
  if (collectionsChanged) notifyCollections(handle);
  return pack.backup.books.length;
}
export async function exportLibrary(
  handle: LibraryHandle,
  bookId?: string,
): Promise<PortableLibrary> {
  const db = await openLibraryDatabase(handle);
  await ensureCollectionSchema(db);
  let pack!: PortableLibrary;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const books = await tx.getAllAsync<{ body: string }>(
      `SELECT body FROM books ${bookId ? 'WHERE id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    const parsedBooks = books.map((row) => validateBook(JSON.parse(row.body)));
    for (const book of parsedBooks) await ensureBookTranslationMigration(tx, book);
    const notes = await tx.getAllAsync<{ body: string }>(
      `SELECT body FROM notes ${bookId ? 'WHERE book_id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    const positions = await tx.getAllAsync<{ book_id: string; body: string }>(
      `SELECT book_id, body FROM positions ${bookId ? 'WHERE book_id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    const bookmarks = await tx.getAllAsync<{ body: string }>(
      `SELECT body FROM bookmarks ${bookId ? 'WHERE book_id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    const translations = await tx.getAllAsync<{ book_id: string; language: string; body: string }>(
      `SELECT book_id, language, body FROM translations ${bookId ? 'WHERE book_id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    const versions = await tx.getAllAsync<{ body: string }>(
      `SELECT body FROM translation_versions ${bookId ? 'WHERE book_id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    const selections = await tx.getAllAsync<SavedTranslationSelection>(
      `SELECT book_id AS bookId, language, paragraph_id AS paragraphId, key FROM translation_selections ${bookId ? 'WHERE book_id = ?' : ''}`,
      bookId ? [bookId] : [],
    );
    pack = {
      format: 'bypage-portable-library',
      version: 2,
      backup: {
        format: 'ai-read-books-and-notes',
        version: 1,
        exportedAt: Date.now(),
        books: parsedBooks,
        notes: notes.map((row) => JSON.parse(row.body)),
        bookmarks: bookmarks.map((row) => JSON.parse(row.body)),
        positions: Object.fromEntries(positions.map((row) => [row.book_id, JSON.parse(row.body)])),
      },
      translations: translations.map((row) => ({
        bookId: row.book_id,
        language: row.language,
        paragraphs: JSON.parse(row.body),
      })),
      translationVersions: versions.map((row) => JSON.parse(row.body)),
      translationSelections: selections,
      collections: await readPortableCollections(tx, bookId),
    };
  });
  return validatePortableLibrary(pack);
}
