import { libraryDatabaseName } from './storage-scope';
export const localStores = [
  'books',
  'positions',
  'notes',
  'bookmarks',
  'translations',
  'translation-versions',
  'translation-selections',
  'chats',
  'glossaries',
  'sync',
  'turns',
  'sync-recovery',
  'translation-manifests',
  'chapter-translations',
  'translation-jobs',
  // Device-local originals are deliberately excluded from sync and reading backups.
  'pdf-originals',
];
let connection: Promise<IDBDatabase> | undefined;
export function localDatabase() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(libraryDatabaseName(), 6);
    request.onupgradeneeded = () => {
      for (const name of localStores)
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = undefined;
      reject(new Error('无法打开本地书库，请允许浏览器存储数据。'));
    };
    request.onblocked = () => {
      window.dispatchEvent(new Event('ai-read-storage-blocked'));
    };
  }));
}
export const idb = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('本地保存失败，请检查浏览器存储空间。'));
  });
export async function localTransaction<T>(
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
  stores = localStores,
): Promise<T> {
  const db = await localDatabase();
  const tx = db.transaction(stores, mode);
  const completed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error('本地保存失败，请检查浏览器存储空间。'));
  });
  // Register the rejection handler before running async IDB operations.
  void completed.catch(() => {});
  try {
    const result = await run(tx);
    await completed;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await completed.catch(() => {});
    throw error;
  }
}
export const readLocal = <T>(store: string, key: IDBValidKey) =>
  localTransaction(
    'readonly',
    (tx) => idb(tx.objectStore(store).get(key)) as Promise<T | undefined>,
    [store],
  );
export function notifyLocalData() {
  window.dispatchEvent(new Event('ai-read-library-change'));
  try {
    localStorage.setItem('ai-read-data-change', `${Date.now()}:${Math.random()}`);
  } catch {}
}
export function notifySyncDirty() {
  window.dispatchEvent(new Event('ai-read-sync-dirty'));
}
export function reportSyncError() {
  window.dispatchEvent(new Event('ai-read-sync-local-error'));
}
