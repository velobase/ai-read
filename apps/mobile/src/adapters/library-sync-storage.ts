import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  MAX_BOOKMARKS_PER_BOOK,
  MAX_COLLECTIONS,
  bookmarkLocationKey,
  isBookSourceLanguage,
  normalizeCollectionName,
  readingProgress,
  sameBookContent,
  supplementBookMedia,
  supplementBookReferences,
  supplementReferences,
  validateBook,
  validateBookReferences,
  validateBookmark,
  validatePortableLibrary,
  validNoteAnchor,
  validPosition,
  validSyncId,
  type Book,
  type Note,
  type PortableLibrary,
  type Position,
} from '@bypage/reading-core';
import { openLibraryDatabase } from './database';
import { ensureTranslationStore } from './translation-store';
import { notifyCollections } from './collections-storage';
import { assertLibraryHandle, type LibraryHandle } from './library-scope';
import {
  librarySyncKey,
  readLibrarySyncEntry,
  writeLibrarySyncEntry,
  type LibraryBookMetadata,
  type LibraryShelfState,
  type LibrarySyncData,
  type LibrarySyncEntity,
  type LibrarySyncEntry,
  type LibrarySyncRecord,
} from './library-sync-outbox';

export type LibrarySyncGuard = { signal?: AbortSignal; isCurrent?: () => boolean };
type Row = Record<string, string | number | null>;
type BookRow = Row & { id: string; title: string; body: string; imported_at: number };
export type LibraryRecoverySnapshot = {
  format: 'bypage-library-recovery';
  version: 1 | 2;
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  reason: string;
  /** This is a local archive, not an instruction to upload or recreate a cloud book. */
  libraryKey: string;
  book: BookRow;
  rows: {
    positions: Row[];
    notes: Row[];
    bookmarks: Row[];
    translations: Row[];
    /** Optional on archives created before exact saved versions existed. */
    translation_versions?: Row[];
    translation_selections?: Row[];
    translation_drafts: Row[];
    assistant_history: Row[];
    book_collections: Row[];
    shelf_collections: Row[];
    library_sync_state: Row[];
  };
};
export type LibraryRecoverySummary = Pick<
  LibraryRecoverySnapshot,
  'id' | 'bookId' | 'title' | 'createdAt' | 'reason'
>;

const entities: LibrarySyncEntity[] = ['book', 'position', 'note', 'bookmark'];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function invalid(): never {
  throw new Error('library_sync_invalid_data');
}
function check(guard?: LibrarySyncGuard) {
  if (guard?.signal?.aborted || guard?.isCurrent?.() === false) {
    const error = new Error('library_scope_changed');
    error.name = 'AbortError';
    throw error;
  }
}
function account(handle: LibraryHandle) {
  assertLibraryHandle(handle);
  if (handle.kind !== 'account') throw new Error('library_sync_account_required');
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!object(left) || !object(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equal(item, right[index]))
    );
  }
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  return (
    keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length &&
    keys.every((key) => equal(left[key], right[key]))
  );
}
function frame(record: LibrarySyncRecord) {
  if (
    !object(record) ||
    !entities.includes(record.entity) ||
    !validSyncId(record.bookId) ||
    !validSyncId(record.id) ||
    !Number.isSafeInteger(record.version) ||
    record.version < 0 ||
    (record.version === 0 && !record.deleted) ||
    typeof record.deleted !== 'boolean' ||
    ((record.entity === 'book' || record.entity === 'position') && record.id !== record.bookId) ||
    (record.mutationId != null && !validSyncId(record.mutationId)) ||
    (!record.deleted && !object(record.data))
  )
    invalid();
}
function pageLimit(value: number | undefined, fallback = 100) {
  return Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, 200) : fallback;
}

async function ensureRecoverySchema(tx: SQLiteDatabase) {
  // Deliberately no FK: the recovery must survive the deletion it protects.
  await tx.execAsync(`CREATE TABLE IF NOT EXISTS library_sync_recovery (
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT NOT NULL,
    reason TEXT NOT NULL, created_at REAL NOT NULL, body TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS library_sync_recovery_by_time
     ON library_sync_recovery(created_at DESC, id DESC);`);
}

/** Caller owns the transaction. Capture before cascade or changing the pending mutation. */
export async function captureLocalBookRecovery(
  tx: SQLiteDatabase,
  bookId: string,
  reason: string,
): Promise<string | undefined> {
  if (!validSyncId(bookId) || !reason || reason.length > 100) invalid();
  const book = await tx.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ?', [bookId]);
  if (!book) return undefined;
  await ensureRecoverySchema(tx);
  const scope = await tx.getFirstAsync<{ value: string }>(
    "SELECT value FROM preferences WHERE key = 'library_scope'",
  );
  if (!scope?.value || !/^account-[a-f0-9]{64}$/.test(scope.value))
    throw new Error('library_sync_account_required');
  await ensureTranslationStore(tx);
  const rows = {} as LibraryRecoverySnapshot['rows'];
  // Explicit tables exclude credentials, device preferences, and unrelated books.
  for (const table of [
    'positions',
    'notes',
    'bookmarks',
    'translations',
    'translation_versions',
    'translation_selections',
    'translation_drafts',
    'assistant_history',
    'book_collections',
    'library_sync_state',
  ] as const)
    rows[table] = await tx.getAllAsync<Row>(`SELECT * FROM ${table} WHERE book_id = ?`, [bookId]);
  rows.shelf_collections = await tx.getAllAsync<Row>(
    'SELECT c.* FROM shelf_collections c JOIN book_collections m ON m.collection_id = c.id WHERE m.book_id = ?',
    [bookId],
  );
  const snapshot: LibraryRecoverySnapshot = {
    format: 'bypage-library-recovery',
    // Older apps reject this version rather than silently drop exact saved text.
    version: rows.translation_versions?.length || rows.translation_selections?.length ? 2 : 1,
    id: Crypto.randomUUID(),
    bookId,
    title: book.title,
    createdAt: Date.now(),
    reason,
    libraryKey: scope.value,
    book,
    rows,
  };
  await tx.runAsync(
    'INSERT INTO library_sync_recovery(id, book_id, title, reason, created_at, body) VALUES (?, ?, ?, ?, ?, ?)',
    [snapshot.id, bookId, snapshot.title, reason, snapshot.createdAt, JSON.stringify(snapshot)],
  );
  return snapshot.id;
}

export async function getLibrarySyncEntry(
  handle: LibraryHandle,
  entity: LibrarySyncEntity,
  bookId: string,
  id: string,
): Promise<LibrarySyncEntry | undefined> {
  account(handle);
  frame({ entity, bookId, id, version: 0, deleted: true });
  return readLibrarySyncEntry(await openLibraryDatabase(handle), entity, bookId, id);
}

/** Stable descriptor page; fetch a single entry to read its data before sending it. */
export async function listLibrarySyncEntries(
  handle: LibraryHandle,
  options: {
    pendingOnly?: boolean;
    includeRejected?: boolean;
    limit?: number;
    after?: string;
  } = {},
): Promise<LibrarySyncEntry[]> {
  account(handle);
  if (
    options.after !== undefined &&
    (typeof options.after !== 'string' || options.after.length > 700)
  )
    invalid();
  const db = await openLibraryDatabase(handle);
  const rows = await db.getAllAsync<{ body: string }>(
    `SELECT json_remove(body, '$.shadow', '$.pending.data') AS body FROM library_sync_state WHERE json_extract(body, '$.key') > ?
     ${options.pendingOnly ? "AND json_type(body, '$.pending') = 'object'" : ''}
     ${options.pendingOnly && !options.includeRejected ? "AND (json_extract(body, '$.rejectedMutationId') IS NULL OR json_extract(body, '$.rejectedMutationId') != json_extract(body, '$.pending.mutationId'))" : ''}
     ORDER BY json_extract(body, '$.key') LIMIT ?`,
    [options.after || '', pageLimit(options.limit)],
  );
  return rows.map((row) => JSON.parse(row.body) as LibrarySyncEntry);
}

export async function markLibrarySyncRejected(
  handle: LibraryHandle,
  sent: LibrarySyncEntry,
  guard?: LibrarySyncGuard,
) {
  account(handle);
  check(guard);
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    check(guard);
    const current = await readLibrarySyncEntry(tx, sent.entity, sent.bookId, sent.id);
    if (current?.pending && current.pending.mutationId === sent.pending?.mutationId) {
      current.rejectedMutationId = current.pending.mutationId;
      await writeLibrarySyncEntry(tx, current);
    }
    check(guard);
  });
}

/** Only an explicit user retry should call this; background passes keep rejected work local. */
export async function retryRejectedLibrarySyncEntries(
  handle: LibraryHandle,
  guard?: LibrarySyncGuard,
) {
  account(handle);
  check(guard);
  const db = await openLibraryDatabase(handle);
  let count = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    check(guard);
    const result = await tx.runAsync(
      `UPDATE library_sync_state SET body = json_remove(body, '$.rejectedMutationId'), updated_at = ?
       WHERE json_extract(body, '$.rejectedMutationId') IS NOT NULL`,
      [Date.now()],
    );
    count = result.changes;
    check(guard);
  });
  return count;
}

/** Counts are SQL aggregates, independent of the bounded pages used by the UI/engine. */
export async function getLibrarySyncCounts(handle: LibraryHandle) {
  account(handle);
  const db = await openLibraryDatabase(handle);
  await ensureRecoverySchema(db);
  const counts = await db.getFirstAsync<{ pending: number; blocked: number; recoveries: number }>(
    `SELECT
      COALESCE(SUM(CASE WHEN json_type(body, '$.pending') = 'object' THEN 1 ELSE 0 END),0) AS pending,
      COALESCE(SUM(CASE WHEN json_type(body, '$.pending') = 'object' AND json_extract(body, '$.rejectedMutationId') = json_extract(body, '$.pending.mutationId') THEN 1 ELSE 0 END),0) AS blocked,
      (SELECT COUNT(*) FROM library_sync_recovery) AS recoveries FROM library_sync_state`,
  );
  return counts || { pending: 0, blocked: 0, recoveries: 0 };
}

function metadata(book: Book, value: unknown): Book {
  if (value === undefined) return book;
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        !['toc', 'sourceFormat', 'sourceLanguage', 'mediaRevision', 'references'].includes(key),
    ) ||
    (value.sourceFormat !== undefined &&
      !['epub', 'txt', 'pdf'].includes(value.sourceFormat as string)) ||
    (value.sourceLanguage !== undefined && !isBookSourceLanguage(value.sourceLanguage)) ||
    (value.mediaRevision !== undefined &&
      (typeof value.mediaRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.mediaRevision)))
  )
    invalid();
  const toc =
    value.toc === undefined
      ? book.toc
      : validateBook({ ...book, media: undefined, references: undefined, toc: value.toc }).toc;
  const references =
    value.references === undefined
      ? book.references
      : supplementReferences(
          book.references,
          validateBookReferences(value.references, book.chapters),
        );
  return {
    ...book,
    ...(book.toc?.length ? {} : toc?.length ? { toc } : {}),
    ...(!book.sourceFormat && value.sourceFormat
      ? { sourceFormat: value.sourceFormat as Book['sourceFormat'] }
      : {}),
    ...(value.sourceLanguage !== undefined
      ? { sourceLanguage: value.sourceLanguage as string }
      : {}),
    ...(references ? { references } : {}),
  };
}
function shelf(value: unknown): LibraryShelfState {
  if (
    !object(value) ||
    (value.status !== undefined &&
      !['unread', 'reading', 'finished'].includes(value.status as string)) ||
    (value.group !== undefined && value.group !== '' && !normalizeCollectionName(value.group)) ||
    (value.lastOpenedAt !== undefined &&
      (typeof value.lastOpenedAt !== 'number' ||
        !Number.isFinite(value.lastOpenedAt) ||
        value.lastOpenedAt < 0)) ||
    (value.pinned !== undefined && typeof value.pinned !== 'boolean') ||
    (value.hidden !== undefined && typeof value.hidden !== 'boolean')
  )
    invalid();
  // Future Web fields remain in the shadow; native only projects the fields it displays.
  return { ...value };
}
function bookShadow(data: LibrarySyncData['book']): LibrarySyncData['book'] {
  const book = data.content;
  const derived: LibraryBookMetadata = book
    ? {
        ...(book.toc ? { toc: book.toc } : {}),
        ...(book.sourceFormat ? { sourceFormat: book.sourceFormat } : {}),
        ...(book.sourceLanguage !== undefined ? { sourceLanguage: book.sourceLanguage } : {}),
        ...(book.references ? { references: book.references } : {}),
        ...(book.media ? { mediaRevision: book.media.revision } : {}),
      }
    : {};
  return { shelfState: shelf(data.shelfState), metadata: { ...derived, ...data.metadata } };
}
async function applyGroup(tx: SQLiteDatabase, bookId: string, group: string | undefined) {
  if (group === undefined) return;
  if (!group) {
    await tx.runAsync('DELETE FROM book_collections WHERE book_id = ?', [bookId]);
    return;
  }
  const name = normalizeCollectionName(group);
  if (!name) invalid();
  let found = await tx.getFirstAsync<{ id: string }>(
    'SELECT id FROM shelf_collections WHERE name_key = ?',
    [name.key],
  );
  if (!found) {
    const count = await tx.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM shelf_collections',
    );
    if ((count?.count || 0) >= MAX_COLLECTIONS) throw new Error('collection_limit');
    found = { id: Crypto.randomUUID() };
    await tx.runAsync(
      'INSERT INTO shelf_collections(id,name,name_key,created_at) VALUES (?,?,?,?)',
      [found.id, name.name, name.key, Date.now()],
    );
  }
  await tx.runAsync(
    'INSERT INTO book_collections(book_id,collection_id) VALUES (?,?) ON CONFLICT(book_id) DO UPDATE SET collection_id=excluded.collection_id',
    [bookId, found.id],
  );
}
function cleanPosition(book: Book, value: unknown): Position {
  if (!validPosition(book, value)) invalid();
  const p = value;
  const paragraph = book.chapters[p.chapter].paragraphs.find((item) => item.id === p.paragraph)!;
  if ((p.textSource || 'original') === 'original' && (p.textOffset || 0) > paragraph.text.length)
    invalid();
  return {
    chapter: p.chapter,
    paragraph: p.paragraph,
    farthest: p.farthest,
    ...(typeof p.offset === 'number' && Number.isFinite(p.offset)
      ? { offset: Math.max(0, Math.min(1, p.offset)) }
      : {}),
    ...(p.textOffset !== undefined ? { textOffset: p.textOffset } : {}),
    ...(p.textSource !== undefined ? { textSource: p.textSource } : {}),
    ...(p.textQuote !== undefined ? { textQuote: p.textQuote } : {}),
  };
}
function cleanNote(book: Book, id: string, raw: unknown): Note {
  if (
    !object(raw) ||
    raw.id !== id ||
    raw.bookId !== book.id ||
    typeof raw.paragraphId !== 'string' ||
    typeof raw.quote !== 'string' ||
    raw.quote.length > 20000 ||
    typeof raw.text !== 'string' ||
    raw.text.length > 50000 ||
    typeof raw.createdAt !== 'number' ||
    !Number.isFinite(raw.createdAt) ||
    raw.createdAt < 0 ||
    raw.createdAt > 8640000000000000
  )
    invalid();
  const paragraph = book.chapters
    .flatMap((chapter) => chapter.paragraphs)
    .find((p) => p.id === raw.paragraphId);
  if (!paragraph || !validNoteAnchor(raw.anchor, raw.quote, paragraph.text)) invalid();
  const anchor = raw.anchor as Note['anchor'];
  return {
    id,
    bookId: book.id,
    paragraphId: raw.paragraphId as string,
    quote: raw.quote as string,
    text: raw.text as string,
    createdAt: raw.createdAt as number,
    ...(anchor
      ? {
          anchor: {
            source: anchor.source,
            start: anchor.start,
            end: anchor.end,
            ...(anchor.source === 'translation' ? { translationKey: anchor.translationKey } : {}),
          },
        }
      : {}),
  };
}
async function removeRemoteBook(tx: SQLiteDatabase, bookId: string) {
  await tx.runAsync('DELETE FROM books WHERE id = ?', [bookId]);
  // Preserve every pending child in recovery first. Never retry it against a deleted parent.
  const rows = await tx.getAllAsync<{ body: string }>(
    'SELECT body FROM library_sync_state WHERE book_id = ? AND entity != ?',
    [bookId, 'book'],
  );
  for (const row of rows) {
    const entry = JSON.parse(row.body) as LibrarySyncEntry;
    entry.deleted = true;
    delete entry.pending;
    delete entry.rejectedMutationId;
    delete entry.shadow;
    await writeLibrarySyncEntry(tx, entry);
  }
  // Deliberately never call removeBook/removePdfOriginal: attachments belong to recovery too.
}

async function putRemote(
  tx: SQLiteDatabase,
  record: LibrarySyncRecord,
): Promise<{ data?: LibrarySyncData[LibrarySyncEntity]; recoveryId?: string }> {
  const { entity, bookId, id } = record;
  if (record.deleted) {
    if (entity === 'book') {
      const recoveryId = await captureLocalBookRecovery(tx, bookId, 'remote-book-deleted');
      await removeRemoteBook(tx, bookId);
      return { recoveryId };
    }
    if (entity === 'position') {
      await tx.runAsync('DELETE FROM positions WHERE book_id = ?', [bookId]);
      await tx.runAsync('UPDATE books SET progress = 0 WHERE id = ?', [bookId]);
    } else
      await tx.runAsync(
        `DELETE FROM ${entity === 'note' ? 'notes' : 'bookmarks'} WHERE book_id = ? AND id = ?`,
        [bookId, id],
      );
    return {};
  }
  // Child anchors need reading text, never the potentially large image sidecar.
  const old = await tx.getFirstAsync<BookRow>(
    entity === 'book'
      ? 'SELECT * FROM books WHERE id = ?'
      : "SELECT id,title,imported_at,json_remove(body,'$.media','$.references','$.cover') AS body FROM books WHERE id = ?",
    [bookId],
  );
  if (entity === 'book') {
    const data = record.data as LibrarySyncData['book'];
    const state = shelf(data.shelfState);
    const existing = old ? validateBook(JSON.parse(old.body)) : undefined;
    const content = data.content === undefined ? undefined : validateBook(data.content);
    if (content && content.id !== bookId) invalid();
    if (!existing && !content) throw new Error('library_sync_content_required');
    let recoveryId: string | undefined;
    const compatible = !existing || !content || sameBookContent(existing, content);
    if (!compatible) {
      recoveryId = await captureLocalBookRecovery(tx, bookId, 'remote-book-content-conflict');
      await removeRemoteBook(tx, bookId);
      await tx.runAsync('DELETE FROM library_sync_state WHERE book_id = ? AND entity != ?', [
        bookId,
        'book',
      ]);
    }
    const base =
      compatible && existing
        ? content
          ? supplementBookReferences(supplementBookMedia(existing, content), content)
          : existing
        : content!;
    const next = metadata(base, data.metadata ?? bookShadow(data).metadata);
    await tx.runAsync(
      `INSERT INTO books(id,title,author,language,sample,chapters,body,imported_at,last_opened,finished)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
       title=excluded.title,author=excluded.author,language=excluded.language,sample=excluded.sample,
       chapters=excluded.chapters,body=excluded.body,last_opened=excluded.last_opened,finished=excluded.finished`,
      [
        bookId,
        next.title,
        next.author,
        next.language,
        next.sample ? 1 : 0,
        next.chapters.length,
        JSON.stringify(next),
        old?.imported_at ?? next.importedAt,
        state.lastOpenedAt ?? old?.last_opened ?? 0,
        state.status === 'finished' ? 1 : 0,
      ],
    );
    await applyGroup(tx, bookId, state.group ?? '');
    return { data: bookShadow(data), recoveryId };
  }
  if (!old) throw new Error('library_sync_parent_missing');
  const book = validateBook(JSON.parse(old.body));
  if (entity === 'position') {
    const position = cleanPosition(book, record.data);
    await tx.runAsync(
      'INSERT INTO positions(book_id,body) VALUES (?,?) ON CONFLICT(book_id) DO UPDATE SET body=excluded.body',
      [bookId, JSON.stringify(position)],
    );
    await tx.runAsync('UPDATE books SET progress = ? WHERE id = ?', [
      readingProgress(book.chapters, position),
      bookId,
    ]);
    return { data: position };
  }
  if (entity === 'note') {
    const note = cleanNote(book, id, record.data);
    await tx.runAsync(
      'INSERT INTO notes(id,book_id,body,created_at) VALUES (?,?,?,?) ON CONFLICT(book_id,id) DO UPDATE SET body=excluded.body,created_at=excluded.created_at',
      [id, bookId, JSON.stringify(note), note.createdAt],
    );
    return { data: note };
  }
  const bookmark = validateBookmark(book, record.data);
  if (bookmark.id !== id || bookmark.bookId !== bookId) invalid();
  const count = await tx.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM bookmarks WHERE book_id = ? AND id != ?',
    [bookId, id],
  );
  if ((count?.count || 0) >= MAX_BOOKMARKS_PER_BOOK) throw new Error('Invalid bookmark');
  await tx.runAsync(
    'INSERT INTO bookmarks(id,book_id,location,body,created_at) VALUES (?,?,?,?,?) ON CONFLICT(book_id,id) DO UPDATE SET location=excluded.location,body=excluded.body,created_at=excluded.created_at',
    [id, bookId, bookmarkLocationKey(bookmark), JSON.stringify(bookmark), bookmark.createdAt],
  );
  return { data: bookmark };
}

/** Late ACKs still undergo the same content validation even though local rows stay untouched. */
async function validatedShadow(
  tx: SQLiteDatabase,
  record: LibrarySyncRecord,
  sent?: LibrarySyncEntry,
) {
  if (record.deleted) return undefined;
  const row = await tx.getFirstAsync<{ body: string }>(
    record.entity === 'book'
      ? 'SELECT body FROM books WHERE id = ?'
      : "SELECT json_remove(body,'$.media','$.references','$.cover') AS body FROM books WHERE id = ?",
    [record.bookId],
  );
  let book = row ? validateBook(JSON.parse(row.body)) : undefined;
  if (record.entity === 'book') {
    const data = record.data as LibrarySyncData['book'];
    const content = data.content === undefined ? undefined : validateBook(data.content);
    if (content && content.id !== record.bookId) invalid();
    if (!content && !book) {
      // A local delete can race a successful metadata-only ACK. Validate against
      // its sent content or the pre-delete archive without recreating the book.
      const sentContent = (sent?.pending?.data as LibrarySyncData['book'] | undefined)?.content;
      if (sentContent) book = validateBook(sentContent);
      else {
        await ensureRecoverySchema(tx);
        const recovered = await tx.getFirstAsync<{ body: string }>(
          "SELECT json_extract(body, '$.book.body') AS body FROM library_sync_recovery WHERE book_id = ? ORDER BY created_at DESC,id DESC LIMIT 1",
          [record.bookId],
        );
        if (recovered) book = validateBook(JSON.parse(recovered.body));
      }
      if (book && book.id !== record.bookId) invalid();
    }
    if (!content && !book) throw new Error('library_sync_content_required');
    metadata(content || book!, data.metadata);
    return bookShadow(data);
  }
  if (!book) throw new Error('library_sync_parent_missing');
  if (record.entity === 'position') return cleanPosition(book, record.data);
  if (record.entity === 'note') return cleanNote(book, record.id, record.data);
  const bookmark = validateBookmark(book, record.data);
  if (bookmark.id !== record.id || bookmark.bookId !== record.bookId) invalid();
  return bookmark;
}

function mergeFields(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
) {
  const result = { ...remote };
  for (const [key, value] of Object.entries(local)) {
    if (!equal(value, base[key]) && equal(remote[key], base[key])) result[key] = value;
  }
  return result;
}

/** Rebase only the fields actually edited locally, preserving Web-only shelf state. */
async function rebaseBook(
  tx: SQLiteDatabase,
  current: LibrarySyncEntry,
  sent: LibrarySyncEntry,
  remote: LibrarySyncRecord,
  conflict: boolean,
) {
  const local = current.pending!.data as LibrarySyncData['book'];
  const incoming = remote.data as LibrarySyncData['book'];
  const base = (conflict ? current.shadow : sent.pending!.data) as
    LibrarySyncData['book'] | undefined;
  const row = await tx.getFirstAsync<{ body: string }>('SELECT body FROM books WHERE id = ?', [
    remote.bookId,
  ]);
  const localBook = local.content || (row ? validateBook(JSON.parse(row.body)) : undefined);
  const remoteBook = incoming.content ? validateBook(incoming.content) : undefined;
  if (!localBook) throw new Error('library_sync_content_required');
  // Same ID is not evidence of compatible text. Archive/apply the authoritative book instead.
  if (remoteBook && !sameBookContent(localBook, remoteBook)) return null;
  const shelfState = mergeFields(
    base?.shelfState || {},
    local.shelfState,
    incoming.shelfState,
  ) as LibraryShelfState;
  const baseMetadata = base?.metadata || (base?.content ? bookShadow(base).metadata : {}) || {};
  const localMetadata = local.metadata || bookShadow(local).metadata || {};
  const remoteMetadata = incoming.metadata || bookShadow(incoming).metadata || {};
  // Missing sourceLanguage is a legacy omission. Only the explicit `auto` value resets it.
  const localFields = {
    ...localMetadata,
    sourceLanguage: localMetadata.sourceLanguage ?? baseMetadata.sourceLanguage,
  };
  const remoteFields = {
    ...remoteMetadata,
    sourceLanguage: remoteMetadata.sourceLanguage ?? baseMetadata.sourceLanguage,
  };
  const mergedMetadata = mergeFields(
    baseMetadata,
    localFields,
    remoteFields,
  ) as LibraryBookMetadata;
  let content = remoteBook
    ? supplementBookReferences(supplementBookMedia(remoteBook, localBook), localBook)
    : localBook;
  mergedMetadata.references = supplementReferences(content.references, mergedMetadata.references);
  if (content.media) mergedMetadata.mediaRevision = content.media.revision;
  content = metadata(content, mergedMetadata);
  const needsContent = !!local.content || content.media?.revision !== remoteMetadata.mediaRevision;
  return {
    pendingData: { shelfState, metadata: mergedMetadata, ...(needsContent ? { content } : {}) },
    localData: { shelfState, metadata: mergedMetadata, content },
  };
}

export type ApplyLibraryRemoteOptions = {
  sent?: LibrarySyncEntry;
  conflict?: boolean;
  /** Required for a new/replaced book: null means the server confirmed no saved position. */
  initialPosition?: LibrarySyncRecord | null;
  guard?: LibrarySyncGuard;
};
export type ApplyLibraryRemoteResult = {
  applied: boolean;
  keptPending: boolean;
  recoveryId?: string;
};

/** No call in this path stages an outbox mutation. Remote state and ACK share one commit. */
export async function applyLibraryRemote(
  handle: LibraryHandle,
  record: LibrarySyncRecord,
  options: ApplyLibraryRemoteOptions = {},
): Promise<ApplyLibraryRemoteResult> {
  account(handle);
  frame(record);
  check(options.guard);
  const { sent, conflict = false } = options;
  if (
    sent &&
    (sent.entity !== record.entity ||
      sent.bookId !== record.bookId ||
      sent.id !== record.id ||
      !sent.pending)
  )
    invalid();
  if (
    sent &&
    !conflict &&
    record.mutationId !== sent.pending!.mutationId &&
    !(record.deleted && record.version === 0 && sent.pending!.deleted)
  )
    invalid();
  const db = await openLibraryDatabase(handle);
  const result: ApplyLibraryRemoteResult = { applied: false, keptPending: false };
  await db.withExclusiveTransactionAsync(async (tx) => {
    check(options.guard);
    if (record.entity !== 'book') {
      const parent = await readLibrarySyncEntry(tx, 'book', record.bookId, record.bookId);
      // A late child response cannot resurrect work after local parent deletion.
      if (parent?.pending?.deleted || parent?.deleted) return;
    }
    const current = await readLibrarySyncEntry(tx, record.entity, record.bookId, record.id);
    // Local parent deletion removes child state; an already-sent child cannot recreate it.
    if (sent && !current && record.entity !== 'book') return;
    const confirmedMissing = conflict && record.deleted && record.version === 0;
    if (current && current.version > record.version && !confirmedMissing) return;
    const parentDeletion = record.entity === 'book' && record.deleted;
    if (current?.pending && !sent && !parentDeletion) return;
    const pending = current?.pending;
    const ownAck =
      sent &&
      !conflict &&
      (record.mutationId === sent.pending!.mutationId ||
        (record.deleted && record.version === 0 && sent.pending!.deleted));
    // An explicit reimport after sending our delete is newer work, not an automatic restore.
    let late = !!(
      pending &&
      sent &&
      pending.mutationId !== sent.pending?.mutationId &&
      (!parentDeletion || ownAck)
    );
    if (conflict && pending && !parentDeletion)
      result.recoveryId = await captureLocalBookRecovery(
        tx,
        record.bookId,
        `conflict-${record.entity}`,
      );
    let rebasedBook: Awaited<ReturnType<typeof rebaseBook>> | undefined;
    if (late && record.entity === 'book' && !record.deleted && !pending!.deleted) {
      await validatedShadow(tx, record, sent);
      rebasedBook = await rebaseBook(tx, current!, sent!, record, conflict);
      if (!rebasedBook) late = false;
    }
    if (late) {
      // The newer edit was never sent. Keep its local value; only its base revision moves.
      const shadow = await validatedShadow(tx, record, sent);
      const rebased = { ...pending!, baseVersion: record.version };
      if (rebasedBook) {
        rebased.data = rebasedBook.pendingData;
        await putRemote(tx, { ...record, data: rebasedBook.localData });
      }
      if (!record.deleted && !rebased.deleted && record.entity === 'position') {
        const local = rebased.data as Position;
        const remote = shadow as Position;
        if (remote.farthest > local.farthest) {
          rebased.data = { ...local, farthest: remote.farthest };
          await putRemote(tx, { ...record, data: rebased.data });
        }
      }
      await writeLibrarySyncEntry(tx, {
        key: librarySyncKey(record.entity, record.bookId, record.id),
        entity: record.entity,
        bookId: record.bookId,
        id: record.id,
        version: record.version,
        deleted: record.deleted,
        shadow,
        pending: rebased,
      });
      result.applied = true;
      result.keptPending = true;
      check(options.guard);
      return;
    }
    if (record.entity === 'book' && !record.deleted) {
      const content = (record.data as LibrarySyncData['book']).content;
      const old = await tx.getFirstAsync<{ body?: string }>(
        content ? 'SELECT body FROM books WHERE id = ?' : 'SELECT id FROM books WHERE id = ?',
        [record.bookId],
      );
      const replaced =
        old &&
        content &&
        !sameBookContent(validateBook(JSON.parse(old.body!)), validateBook(content));
      if ((!old || replaced) && options.initialPosition === undefined)
        throw new Error('library_sync_position_required');
    }
    const applied = await putRemote(tx, record);
    result.recoveryId ||= applied.recoveryId;
    await writeLibrarySyncEntry(tx, {
      key: librarySyncKey(record.entity, record.bookId, record.id),
      entity: record.entity,
      bookId: record.bookId,
      id: record.id,
      version: record.version,
      deleted: record.deleted,
      ...(applied.data === undefined ? {} : { shadow: applied.data }),
    });
    if (record.entity === 'book' && !record.deleted && options.initialPosition !== undefined) {
      const position = options.initialPosition ?? {
        entity: 'position' as const,
        bookId: record.bookId,
        id: record.bookId,
        version: 0,
        deleted: true,
      };
      frame(position);
      if (position.entity !== 'position' || position.bookId !== record.bookId) invalid();
      const old = await readLibrarySyncEntry(tx, 'position', record.bookId, record.bookId);
      // An existing local position may have changed while the book was being fetched.
      if (!old?.pending && (!old || old.version <= position.version)) {
        const value = await putRemote(tx, position);
        await writeLibrarySyncEntry(tx, {
          key: librarySyncKey('position', record.bookId, record.bookId),
          entity: 'position',
          bookId: record.bookId,
          id: record.bookId,
          version: position.version,
          deleted: position.deleted,
          shadow: value.data,
        });
      }
    }
    result.applied = true;
    check(options.guard);
  });
  if (result.applied && record.entity === 'book') notifyCollections(handle);
  return result;
}

export async function listLibraryRecoveries(
  handle: LibraryHandle,
  options: { limit?: number; before?: { createdAt: number; id: string } } = {},
): Promise<LibraryRecoverySummary[]> {
  account(handle);
  const cursor = options.before;
  if (
    cursor &&
    (!Number.isFinite(cursor.createdAt) || cursor.createdAt < 0 || !validSyncId(cursor.id))
  )
    invalid();
  const db = await openLibraryDatabase(handle);
  await ensureRecoverySchema(db);
  return db.getAllAsync<LibraryRecoverySummary>(
    `SELECT id,book_id AS bookId,title,reason,created_at AS createdAt FROM library_sync_recovery
     ${cursor ? 'WHERE created_at < ? OR (created_at = ? AND id < ?)' : ''}
     ORDER BY created_at DESC,id DESC LIMIT ?`,
    [
      ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []),
      pageLimit(options.limit, 20),
    ],
  );
}
export async function readLibraryRecovery(
  handle: LibraryHandle,
  id: string,
): Promise<LibraryRecoverySnapshot | null> {
  account(handle);
  if (!validSyncId(id)) invalid();
  const db = await openLibraryDatabase(handle);
  await ensureRecoverySchema(db);
  const row = await db.getFirstAsync<{ body: string }>(
    'SELECT body FROM library_sync_recovery WHERE id = ?',
    [id],
  );
  if (!row) return null;
  const snapshot = JSON.parse(row.body) as LibraryRecoverySnapshot;
  if (
    snapshot.libraryKey !== handle.key ||
    snapshot.id !== id ||
    (snapshot.version !== 1 && snapshot.version !== 2) ||
    snapshot.format !== 'bypage-library-recovery'
  )
    invalid();
  return snapshot;
}
/** Complete archive includes local drafts/history/outbox. It is not a portable reading pack. */
export async function exportLibraryRecovery(
  handle: LibraryHandle,
  id: string,
): Promise<{ json: string; bookTitle: string }> {
  const snapshot = await readLibraryRecovery(handle, id);
  if (!snapshot) throw new Error('library_recovery_missing');
  return { json: JSON.stringify(snapshot, null, 2), bookTitle: snapshot.title };
}
/** Explicit UI choice only. Unsupported private rows remain safely in the full recovery. */
export function recoveryPortableLibrary(snapshot: LibraryRecoverySnapshot): PortableLibrary {
  const book = validateBook(JSON.parse(snapshot.book.body));
  const rowBodies = (rows: Row[]) => rows.map((row) => JSON.parse(String(row.body)));
  const exact = snapshot.version === 2;
  return validatePortableLibrary({
    format: 'bypage-portable-library',
    version: exact ? 2 : 1,
    ...(exact
      ? {
          translationVersions: rowBodies(snapshot.rows.translation_versions || []),
          translationSelections: (snapshot.rows.translation_selections || []).map((row) => ({
            bookId: row.book_id,
            language: row.language,
            paragraphId: row.paragraph_id,
            key: row.key,
          })),
        }
      : {}),
    backup: {
      format: 'ai-read-books-and-notes',
      version: 1,
      exportedAt: Date.now(),
      books: [book],
      notes: rowBodies(snapshot.rows.notes),
      bookmarks: rowBodies(snapshot.rows.bookmarks),
      positions: snapshot.rows.positions[0]
        ? { [book.id]: JSON.parse(String(snapshot.rows.positions[0].body)) }
        : {},
    },
    translations: snapshot.rows.translations.map((row) => ({
      bookId: book.id,
      language: row.language,
      paragraphs: JSON.parse(String(row.body)),
    })),
    collections: snapshot.rows.shelf_collections.map((row) => ({
      name: row.name,
      bookIds: [book.id],
    })),
  });
}
