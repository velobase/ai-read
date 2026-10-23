import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { assertLibraryHandle, type LibraryHandle } from './library-scope';
import {
  MAX_COLLECTIONS,
  normalizeCollectionName,
  type PortableCollection,
} from '@bypage/reading-core';

const schemas = new WeakMap<SQLiteDatabase, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();
const SQL_BATCH = 400;

/** Schema only: existing device books are never assigned during initialization. */
export async function ensureCollectionSchema(db: SQLiteDatabase): Promise<void> {
  let ready = schemas.get(db);
  if (!ready) {
    ready = db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`
        CREATE TABLE IF NOT EXISTS shelf_collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          name_key TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS book_collections (
          book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
          collection_id TEXT NOT NULL REFERENCES shelf_collections(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS book_collections_by_collection ON book_collections(collection_id);
      `);
    });
    schemas.set(db, ready);
    void ready.catch(() => {
      if (schemas.get(db) === ready) schemas.delete(db);
    });
  }
  await ready;
}

export function notifyCollections(handle: LibraryHandle) {
  assertLibraryHandle(handle);
  for (const listener of [...(listeners.get(handle.key) || [])]) {
    try {
      listener();
    } catch {
      // A failed view subscription must not turn a committed write into an error.
    }
  }
}

export function subscribeCollections(handle: LibraryHandle, listener: () => void): () => void {
  assertLibraryHandle(handle);
  let scoped = listeners.get(handle.key);
  if (!scoped) listeners.set(handle.key, (scoped = new Set()));
  scoped.add(listener);
  return () => {
    scoped.delete(listener);
    if (!scoped.size && listeners.get(handle.key) === scoped) listeners.delete(handle.key);
  };
}

/** Called within the same transaction that reads the exported books and notes. */
export async function readPortableCollections(
  tx: SQLiteDatabase,
  bookId?: string,
): Promise<PortableCollection[]> {
  const groups = await tx.getAllAsync<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM shelf_collections c
     ${bookId ? 'WHERE EXISTS (SELECT 1 FROM book_collections m JOIN books b ON b.id = m.book_id WHERE m.collection_id = c.id AND m.book_id = ?)' : ''}
     ORDER BY c.created_at, c.id`,
    bookId ? [bookId] : [],
  );
  const members = await tx.getAllAsync<{ book_id: string; collection_id: string }>(
    `SELECT m.book_id, m.collection_id FROM book_collections m JOIN books b ON b.id = m.book_id
     ${bookId ? 'WHERE m.book_id = ?' : ''} ORDER BY m.book_id`,
    bookId ? [bookId] : [],
  );
  const byId = new Map(
    groups.map((group) => [group.id, { name: group.name, bookIds: [] as string[] }]),
  );
  for (const member of members) byId.get(member.collection_id)?.bookIds.push(member.book_id);
  return [...byId.values()];
}

/** Merge validated pack groups after their books, using the caller's import transaction. */
export async function mergePortableCollections(
  tx: SQLiteDatabase,
  collections: PortableCollection[],
): Promise<boolean> {
  if (!collections.length) return false;
  const incoming = collections.map((group) => {
    const normalized = normalizeCollectionName(group.name);
    if (!normalized) throw new Error('collection_name');
    return { ...normalized, bookIds: group.bookIds };
  });
  const existing = await tx.getAllAsync<{ id: string; name_key: string }>(
    'SELECT id, name_key FROM shelf_collections',
  );
  const byName = new Map(existing.map((group) => [group.name_key, group.id]));
  const missing = new Set(
    incoming.filter((group) => !byName.has(group.key)).map((group) => group.key),
  );
  if (existing.length + missing.size > MAX_COLLECTIONS) throw new Error('collection_limit');
  let changed = false;
  for (const group of incoming) {
    let id = byName.get(group.key);
    if (!id) {
      id = Crypto.randomUUID();
      await tx.runAsync(
        'INSERT INTO shelf_collections(id, name, name_key, created_at) VALUES (?, ?, ?, ?)',
        [id, group.name, group.key, Date.now()],
      );
      byName.set(group.key, id);
      changed = true;
    }
    for (let offset = 0; offset < group.bookIds.length; offset += SQL_BATCH) {
      const batch = group.bookIds.slice(offset, offset + SQL_BATCH);
      const result = await tx.runAsync(
        `INSERT OR IGNORE INTO book_collections(book_id, collection_id)
         SELECT id, ? FROM books WHERE id IN (${batch.map(() => '?').join(',')})`,
        [id, ...batch],
      );
      // Existing membership is deliberately preserved even when the pack names another group.
      changed ||= result.changes > 0;
    }
  }
  return changed;
}
