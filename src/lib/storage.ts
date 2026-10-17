import type { Book, Message, Note, Position, Settings } from './types';
import { defaults } from './types';

let connection: Promise<IDBDatabase> | undefined;
function db() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-read', 1);
    request.onupgradeneeded = () => {
      for (const name of ['books', 'positions', 'notes', 'translations', 'chats', 'glossaries'])
        request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地书库，请允许浏览器存储数据。'));
    request.onblocked = () =>
      reject(new Error('本地书库被其他页面占用，请关闭其他 AI Read 页面后刷新。'));
  }));
}
async function transaction<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error('本地保存失败，请检查浏览器存储空间。'));
  });
}
const get = <T>(store: string, key: string) =>
  transaction<T | undefined>(store, 'readonly', (s) => s.get(key));
const put = (store: string, key: string, value: unknown) =>
  transaction(store, 'readwrite', (s) => s.put(value, key));
export const storage = {
  books: () => transaction<Book[]>('books', 'readonly', (s) => s.getAll()),
  saveBook: (book: Book) => put('books', book.id, book),
  position: (id: string) => get<Position>('positions', id),
  savePosition: (id: string, pos: Position) => put('positions', id, pos),
  notes: (id: string) => get<Note[]>('notes', id).then((x) => x ?? []),
  saveNotes: (id: string, notes: Note[]) => put('notes', id, notes),
  chat: (id: string) => get<Message[]>('chats', id).then((x) => x ?? []),
  saveChat: (id: string, messages: Message[]) => put('chats', id, messages.slice(-60)),
  glossary: (id: string) => get<string>('glossaries', id).then((x) => x ?? ''),
  saveGlossary: (id: string, value: string) => put('glossaries', id, value),
  translations: (id: string) =>
    get<Record<string, string>>('translations', id).then((x) => x ?? {}),
  saveTranslations: (id: string, value: Record<string, string>) => put('translations', id, value),
  async deleteBook(id: string) {
    const database = await db();
    return new Promise<void>((resolve, reject) => {
      const names = ['books', 'positions', 'notes', 'translations', 'chats', 'glossaries'];
      const tx = database.transaction(names, 'readwrite');
      names.forEach((name) => tx.objectStore(name).delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('删除失败，请重试。'));
    });
  },
};
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem('ai-read-settings') || '{}');
    return {
      ...defaults,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      language: typeof raw.language === 'string' ? raw.language : defaults.language,
      fontSize: Math.min(26, Math.max(15, Number(raw.fontSize) || 19)),
      theme: raw.theme === 'night' ? 'night' : 'paper',
      scope: ['chapter', 'read', 'book'].includes(raw.scope) ? raw.scope : 'chapter',
      readingMode: ['original', 'bilingual', 'translation'].includes(raw.readingMode)
        ? raw.readingMode
        : defaults.readingMode,
    };
  } catch {
    return defaults;
  }
}
export function saveSettings(settings: Settings) {
  const { apiKey: _key, ...safe } = settings;
  localStorage.setItem('ai-read-settings', JSON.stringify(safe));
}
