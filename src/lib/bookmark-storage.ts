import {
  bookmarkLocationKey,
  MAX_BOOKMARKS_PER_BOOK,
  validateBookmark,
} from '../../packages/reading-core/src/bookmarks';
import {
  idb,
  localTransaction,
  notifyLocalData,
  notifySyncDirty,
  readLocal,
} from './local-database';
import { ensureLocalBook, stage } from './sync-storage';
import { sameData } from './sync-types';
import type { Book, Bookmark } from './types';

export const bookmarks = (bookId: string) =>
  readLocal<Bookmark[]>('bookmarks', bookId).then((value) => value || []);

export async function addBookmark(input: Bookmark): Promise<Bookmark[]> {
  let updated = false;
  const result = await localTransaction(
    'readwrite',
    async (tx) => {
      if (!(await ensureLocalBook(tx, input.bookId))) throw new Error('这本书已被删除。');
      const book = (await idb(tx.objectStore('books').get(input.bookId))) as Book;
      const bookmark = validateBookmark(book, input);
      const store = tx.objectStore('bookmarks');
      const existing: Bookmark[] = (await idb(store.get(book.id))) || [];
      const key = bookmarkLocationKey(bookmark);
      if (existing.some((item) => bookmarkLocationKey(item) === key)) return existing;
      if (existing.some((item) => item.id === bookmark.id)) throw new Error('Invalid bookmark');
      if (existing.length >= MAX_BOOKMARKS_PER_BOOK)
        throw new Error('每本书最多保存 1000 条书签。');
      const next = [bookmark, ...existing];
      await idb(store.put(next, book.id));
      await stage(tx, 'bookmark', book.id, bookmark.id, bookmark);
      updated = true;
      return next;
    },
    ['books', 'bookmarks', 'sync'],
  );
  if (updated) {
    notifyLocalData();
    notifySyncDirty();
  }
  return result;
}

export async function modifyBookmark(
  bookId: string,
  id: string,
  patch: Pick<Bookmark, 'label'> | null,
  original: Bookmark,
): Promise<void> {
  let updated = false;
  await localTransaction(
    'readwrite',
    async (tx) => {
      if (!(await ensureLocalBook(tx, bookId))) throw new Error('这本书已被删除。');
      const book = (await idb(tx.objectStore('books').get(bookId))) as Book;
      const store = tx.objectStore('bookmarks');
      const existing: Bookmark[] = (await idb(store.get(bookId))) || [];
      const current = existing.find((item) => item.id === id);
      // A second tab or sync may have changed the label since the sheet opened.
      if (!current && !patch) return;
      if (!current || !sameData(current, original))
        throw new Error('书签已更新，请查看最新内容后重试。');
      const next = patch
        ? validateBookmark(book, { ...current, label: patch.label.trim() })
        : undefined;
      if (sameData(current, next)) return;
      await idb(
        store.put(
          next
            ? existing.map((item) => (item.id === id ? next : item))
            : existing.filter((item) => item.id !== id),
          bookId,
        ),
      );
      await stage(tx, 'bookmark', bookId, id, next, !patch);
      updated = true;
    },
    ['books', 'bookmarks', 'sync'],
  );
  if (updated) {
    notifyLocalData();
    notifySyncDirty();
  }
}
