import * as Crypto from 'expo-crypto';
import { MAX_COLLECTIONS, normalizeCollectionName } from '@bypage/reading-core';
import { openLibraryDatabase } from './database';
import { stageBookSyncMutation, notifyLibraryMutations } from './library-sync-outbox';
import type { LibraryHandle } from './library-scope';
import { ensureCollectionSchema, notifyCollections } from './collections-storage';
export { subscribeCollections } from './collections-storage';

export type ShelfCollection = { id: string; name: string; bookCount: number };
export type CollectionSnapshot = {
  groups: ShelfCollection[];
  memberships: Record<string, string>;
};

const SQL_BATCH = 400;

/** Existing device books are never moved or assigned during initialization. */
async function collectionDatabase(handle: LibraryHandle) {
  const db = await openLibraryDatabase(handle);
  await ensureCollectionSchema(db);
  return db;
}

function collectionName(value: string) {
  const normalized = normalizeCollectionName(value);
  if (!normalized) throw new Error('collection_name');
  return normalized;
}

export async function listCollections(handle: LibraryHandle): Promise<CollectionSnapshot> {
  const db = await collectionDatabase(handle);
  let snapshot: CollectionSnapshot = { groups: [], memberships: {} };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const groups = await tx.getAllAsync<ShelfCollection>(
      `SELECT c.id, c.name, COUNT(m.book_id) AS bookCount
       FROM shelf_collections c LEFT JOIN book_collections m ON m.collection_id = c.id
       GROUP BY c.id, c.name, c.created_at ORDER BY c.created_at, c.id`,
    );
    const members = await tx.getAllAsync<{ book_id: string; collection_id: string }>(
      'SELECT book_id, collection_id FROM book_collections',
    );
    snapshot = {
      groups,
      memberships: Object.fromEntries(members.map((row) => [row.book_id, row.collection_id])),
    };
  });
  return snapshot;
}

export async function createCollection(
  handle: LibraryHandle,
  value: string,
): Promise<ShelfCollection> {
  const { name, key } = collectionName(value);
  const db = await collectionDatabase(handle);
  const group: ShelfCollection = { id: Crypto.randomUUID(), name, bookCount: 0 };
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (await tx.getFirstAsync('SELECT id FROM shelf_collections WHERE name_key = ?', [key]))
      throw new Error('collection_duplicate');
    const row = await tx.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM shelf_collections',
    );
    if ((row?.count || 0) >= MAX_COLLECTIONS) throw new Error('collection_limit');
    await tx.runAsync(
      'INSERT INTO shelf_collections(id, name, name_key, created_at) VALUES (?, ?, ?, ?)',
      [group.id, name, key, Date.now()],
    );
  });
  notifyCollections(handle);
  return group;
}

export async function renameCollection(
  handle: LibraryHandle,
  id: string,
  value: string,
): Promise<void> {
  const { name, key } = collectionName(value);
  const db = await collectionDatabase(handle);
  let changed = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const group = await tx.getFirstAsync<{ name: string }>(
      'SELECT name FROM shelf_collections WHERE id = ?',
      [id],
    );
    if (!group) throw new Error('collection_missing');
    if (
      await tx.getFirstAsync('SELECT id FROM shelf_collections WHERE name_key = ? AND id != ?', [
        key,
        id,
      ])
    )
      throw new Error('collection_duplicate');
    if (group.name === name) return;
    await tx.runAsync('UPDATE shelf_collections SET name = ?, name_key = ? WHERE id = ?', [
      name,
      key,
      id,
    ]);
    if (handle.kind === 'account') {
      const members = await tx.getAllAsync<{ book_id: string }>(
        'SELECT book_id FROM book_collections WHERE collection_id = ?',
        [id],
      );
      for (const member of members)
        await stageBookSyncMutation(tx, handle, member.book_id, { group: name });
    }
    changed = true;
  });
  if (changed) {
    notifyCollections(handle);
    notifyLibraryMutations(handle);
  }
}

/** Dissolving a group removes only its membership rows, never its books. */
export async function removeCollection(handle: LibraryHandle, id: string): Promise<void> {
  const db = await collectionDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const group = await tx.getFirstAsync('SELECT id FROM shelf_collections WHERE id = ?', [id]);
    if (!group) throw new Error('collection_missing');
    const members =
      handle.kind === 'account'
        ? await tx.getAllAsync<{ book_id: string }>(
            'SELECT book_id FROM book_collections WHERE collection_id = ?',
            [id],
          )
        : [];
    await tx.runAsync('DELETE FROM book_collections WHERE collection_id = ?', [id]);
    await tx.runAsync('DELETE FROM shelf_collections WHERE id = ?', [id]);
    for (const member of members)
      await stageBookSyncMutation(tx, handle, member.book_id, { group: '' });
  });
  notifyCollections(handle);
  notifyLibraryMutations(handle);
}

/** Returns the number of books whose membership actually changed. */
export async function moveBooksToCollection(
  handle: LibraryHandle,
  bookIds: string[],
  collectionId: string | null,
): Promise<number> {
  if (!Array.isArray(bookIds) || bookIds.some((id) => typeof id !== 'string' || !id))
    throw new Error('book_missing');
  const ids = [...new Set(bookIds)];
  const db = await collectionDatabase(handle);
  let changed = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const group =
      collectionId === null
        ? null
        : await tx.getFirstAsync<{ name: string }>(
            'SELECT name FROM shelf_collections WHERE id = ?',
            [collectionId],
          );
    if (collectionId !== null && !group) throw new Error('collection_missing');
    const changedIds: string[] = [];
    // Validate the complete selection before the first change; both validation
    // and writes share one transaction, including for selections over SQL_BATCH.
    for (let offset = 0; offset < ids.length; offset += SQL_BATCH) {
      const batch = ids.slice(offset, offset + SQL_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const row = await tx.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM books WHERE id IN (${placeholders})`,
        batch,
      );
      if (row?.count !== batch.length) throw new Error('book_missing');
    }
    for (let offset = 0; offset < ids.length; offset += SQL_BATCH) {
      const batch = ids.slice(offset, offset + SQL_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      if (handle.kind === 'account') {
        const members = await tx.getAllAsync<{ book_id: string; collection_id: string }>(
          `SELECT book_id, collection_id FROM book_collections WHERE book_id IN (${placeholders})`,
          batch,
        );
        const current = new Map(members.map((row) => [row.book_id, row.collection_id]));
        changedIds.push(...batch.filter((id) => (current.get(id) || null) !== collectionId));
      }
      const result =
        collectionId === null
          ? await tx.runAsync(
              `DELETE FROM book_collections WHERE book_id IN (${placeholders})`,
              batch,
            )
          : await tx.runAsync(
              `INSERT INTO book_collections(book_id, collection_id)
               SELECT id, ? FROM books WHERE id IN (${placeholders})
               ON CONFLICT(book_id) DO UPDATE SET collection_id = excluded.collection_id
               WHERE book_collections.collection_id != excluded.collection_id`,
              [collectionId, ...batch],
            );
      changed += result.changes;
    }
    for (const id of changedIds)
      await stageBookSyncMutation(tx, handle, id, { group: group?.name || '' });
  });
  if (changed) {
    notifyCollections(handle);
    notifyLibraryMutations(handle);
  }
  return changed;
}
