import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Book, Bookmark, Note, Position } from '@bypage/reading-core';
import { assertLibraryHandle, type LibraryHandle } from './library-scope';

export type LibrarySyncEntity = 'book' | 'position' | 'note' | 'bookmark';
export type LibraryShelfState = Record<string, unknown> & {
  status?: 'unread' | 'reading' | 'finished';
  pinned?: boolean;
  hidden?: boolean;
  group?: string;
  lastOpenedAt?: number;
};
export type LibraryBookMetadata = Pick<
  Book,
  'toc' | 'sourceFormat' | 'sourceLanguage' | 'references'
> & {
  mediaRevision?: string;
};
export type LibrarySyncData = {
  book: { content?: Book; metadata?: LibraryBookMetadata; shelfState: LibraryShelfState };
  position: Position;
  note: Note;
  bookmark: Bookmark;
};
export type LibrarySyncRecord = {
  entity: LibrarySyncEntity;
  bookId: string;
  id: string;
  version: number;
  deleted: boolean;
  mutationId?: string | null;
  data?: LibrarySyncData[LibrarySyncEntity];
};
export type LibrarySyncMutation = {
  mutationId: string;
  baseVersion: number;
  deleted: boolean;
  data?: LibrarySyncData[LibrarySyncEntity];
};
export type LibrarySyncEntry = Omit<LibrarySyncRecord, 'data' | 'mutationId'> & {
  key: string;
  shadow?: LibrarySyncData[LibrarySyncEntity];
  pending?: LibrarySyncMutation;
  rejectedMutationId?: string;
};
export const librarySyncKey = (entity: LibrarySyncEntity, bookId: string, id: string) =>
  JSON.stringify([entity, bookId, id]);
const listeners = new Map<string, Set<() => void>>();

export function subscribeLibraryMutations(handle: LibraryHandle, listener: () => void) {
  assertLibraryHandle(handle);
  let scoped = listeners.get(handle.key);
  if (!scoped) listeners.set(handle.key, (scoped = new Set()));
  scoped.add(listener);
  return () => {
    scoped.delete(listener);
    if (!scoped.size && listeners.get(handle.key) === scoped) listeners.delete(handle.key);
  };
}

/** Call only after the owning business transaction commits successfully. */
export function notifyLibraryMutations(handle: LibraryHandle) {
  if (handle.kind !== 'account') return;
  for (const listener of [...(listeners.get(handle.key) || [])]) {
    try {
      listener();
    } catch {
      /* A subscriber cannot undo a committed local write. */
    }
  }
}

/** Account databases only. No foreign key: tombstones must outlive deleted local books. */
export async function ensureLibrarySyncSchema(db: SQLiteDatabase) {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS library_sync_state (
    entity TEXT NOT NULL, book_id TEXT NOT NULL, id TEXT NOT NULL,
    body TEXT NOT NULL, updated_at REAL NOT NULL,
    PRIMARY KEY(entity, book_id, id)
  );`);
}

export async function readLibrarySyncEntry(
  tx: SQLiteDatabase,
  entity: LibrarySyncEntity,
  bookId: string,
  id: string,
): Promise<LibrarySyncEntry | undefined> {
  const row = await tx.getFirstAsync<{ body: string }>(
    'SELECT body FROM library_sync_state WHERE entity = ? AND book_id = ? AND id = ?',
    [entity, bookId, id],
  );
  return row ? (JSON.parse(row.body) as LibrarySyncEntry) : undefined;
}

/** The caller owns the transaction; ACK/apply must compare the captured mutation ID first. */
export async function writeLibrarySyncEntry(tx: SQLiteDatabase, entry: LibrarySyncEntry) {
  await tx.runAsync(
    `INSERT INTO library_sync_state(entity, book_id, id, body, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity, book_id, id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    [entry.entity, entry.bookId, entry.id, JSON.stringify(entry), Date.now()],
  );
}

function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameData(value, right[index]))
    );
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameData(a[key], b[key]))
  );
}

/** Stage alongside the local write, never after its transaction has committed. */
export async function stageSyncMutation(
  tx: SQLiteDatabase,
  handle: LibraryHandle,
  input: {
    entity: LibrarySyncEntity;
    bookId: string;
    id: string;
    deleted?: boolean;
    data?: LibrarySyncData[LibrarySyncEntity];
  },
) {
  assertLibraryHandle(handle);
  if (handle.kind !== 'account') return;
  const { entity, bookId, id } = input;
  const deleted = input.deleted === true;
  const data = deleted ? undefined : input.data;
  const old = await readLibrarySyncEntry(tx, entity, bookId, id);
  if (old?.pending && old.pending.deleted === deleted && sameData(old.pending.data, data)) return;
  if (old && !old.pending && old.deleted === deleted && sameData(old.shadow, data)) return;
  const entry: LibrarySyncEntry = old || {
    key: librarySyncKey(entity, bookId, id),
    entity,
    bookId,
    id,
    version: 0,
    deleted: false,
  };
  entry.pending = {
    mutationId: Crypto.randomUUID(),
    baseVersion: entry.pending?.baseVersion ?? entry.version,
    deleted,
    ...(data === undefined ? {} : { data }),
  };
  delete entry.rejectedMutationId;
  await writeLibrarySyncEntry(tx, entry);
}

/** Native edits only replace fields they own; Web shelf fields survive the same transaction. */
export async function stageBookSyncMutation(
  tx: SQLiteDatabase,
  handle: LibraryHandle,
  bookId: string,
  shelfPatch: LibraryShelfState = {},
) {
  if (handle.kind !== 'account') return;
  const row = await tx.getFirstAsync<{
    finished: number;
    last_opened: number;
    hasPosition: number;
    toc: string | null;
    sourceFormat: Book['sourceFormat'] | null;
    sourceLanguage: string | null;
    references: string | null;
    mediaRevision: string | null;
  }>(
    `SELECT finished, last_opened,
       EXISTS(SELECT 1 FROM positions WHERE book_id = books.id) AS hasPosition,
       json_extract(body, '$.toc') AS toc,
       json_extract(body, '$.sourceFormat') AS sourceFormat,
       json_extract(body, '$.sourceLanguage') AS sourceLanguage,
       json_extract(body, '$.references') AS "references",
       json_extract(body, '$.media.revision') AS mediaRevision
     FROM books WHERE id = ?`,
    [bookId],
  );
  if (!row) throw new Error('Book not found');
  const entry = await readLibrarySyncEntry(tx, 'book', bookId, bookId);
  const shadow = entry?.shadow as LibrarySyncData['book'] | undefined;
  const pending = entry?.pending?.data as LibrarySyncData['book'] | undefined;
  const mediaRevision = row.mediaRevision || undefined;
  // The server already owns immutable text after its first ACK. Routine reading
  // progress/group changes send only metadata and shelf state, including unknown
  // Web shelf fields. Never downgrade an unacknowledged upload or resurrection.
  const needsContent =
    !entry?.version ||
    entry.deleted ||
    entry.pending?.deleted ||
    !!pending?.content ||
    mediaRevision !== shadow?.metadata?.mediaRevision;
  let content: Book | undefined;
  if (needsContent) {
    const full = await tx.getFirstAsync<{ body: string }>('SELECT body FROM books WHERE id = ?', [
      bookId,
    ]);
    if (!full) throw new Error('Book not found');
    content = JSON.parse(full.body) as Book;
  }
  const membership = await tx.getFirstAsync<{ name: string }>(
    'SELECT c.name FROM book_collections m JOIN shelf_collections c ON c.id = m.collection_id WHERE m.book_id = ?',
    [bookId],
  );
  const shelfState: LibraryShelfState = {
    status: row.finished ? 'finished' : row.hasPosition ? 'reading' : 'unread',
    ...(row.last_opened ? { lastOpenedAt: row.last_opened } : {}),
    ...shadow?.shelfState,
    ...pending?.shelfState,
    group: membership?.name || '',
    ...shelfPatch,
  };
  const toc = row.toc ? (JSON.parse(row.toc) as Book['toc']) : undefined;
  const metadata: LibraryBookMetadata = {
    ...shadow?.metadata,
    ...pending?.metadata,
    ...(toc?.length ? { toc } : {}),
    ...(row.sourceFormat ? { sourceFormat: row.sourceFormat } : {}),
    ...(row.sourceLanguage !== null ? { sourceLanguage: row.sourceLanguage } : {}),
    ...(row.references ? { references: JSON.parse(row.references) as Book['references'] } : {}),
    ...(mediaRevision ? { mediaRevision } : {}),
  };
  await stageSyncMutation(tx, handle, {
    entity: 'book',
    bookId,
    id: bookId,
    data: { ...(content ? { content } : {}), metadata, shelfState },
  });
}
