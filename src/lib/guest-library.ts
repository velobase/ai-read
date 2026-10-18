import type { Book, Note, Position } from './types';
import type { ReadingBackup } from './reading-backup';

// Read the original guest namespace without changing it or switching the active account.
export async function readGuestLibrary(): Promise<ReadingBackup> {
  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open('ai-read');
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法读取游客书库。'));
    request.onblocked = () => reject(new Error('游客书库暂被其他页面占用，请稍后重试。'));
  });
  const empty: ReadingBackup = {
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: Date.now(),
    books: [],
    notes: [],
    positions: {},
  };
  if (!database) return empty;
  try {
    return await new Promise<ReadingBackup>((resolve, reject) => {
      const tx = database.transaction(['books', 'notes', 'positions'], 'readonly');
      const books = tx.objectStore('books').getAll();
      const notes = tx.objectStore('notes').getAll();
      const positions = tx.objectStore('positions').getAll();
      const positionKeys = tx.objectStore('positions').getAllKeys();
      tx.oncomplete = () =>
        resolve({
          ...empty,
          books: books.result as Book[],
          notes: (notes.result as Note[][]).flat(),
          positions: Object.fromEntries(
            positionKeys.result.map((key, index) => [
              String(key),
              positions.result[index] as Position,
            ]),
          ),
        });
      tx.onabort = tx.onerror = () => reject(new Error('无法读取游客书库，请重试。'));
    });
  } finally {
    database.close();
  }
}
