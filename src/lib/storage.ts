import { effectiveTranslationPrompt, MAX_TRANSLATION_PROMPT_LENGTH } from './translation-prompt';
import { catalog } from './catalog';
import type { Book, Message, Note, Position, Settings } from './types';
import { defaults } from './types';
import { validateBackup, validateBook, type ReadingBackup } from './reading-backup';
import { storageKey, storageUserId } from './storage-scope';
import {
  idb,
  localTransaction,
  notifyLocalData,
  notifySyncDirty,
  readLocal,
  reportSyncError,
} from './local-database';
import { cleanShelf, sameData, syncKey, type ChatTurn, type SyncEntry } from './sync-types';
import {
  ensureLocalBook,
  messagesToTurns,
  readJSON,
  removeLocalBook,
  stage,
  stagePreferences,
  turnsToMessages,
} from './sync-storage';

let sessionApiKey = '';
const lastPosition = new Map<string, Position>();
async function changed() {
  notifySyncDirty();
}
async function putNotes(
  tx: IDBTransaction,
  bookId: string,
  patch: (notes: Note[]) => Note[],
  changes: (old: Note[], next: Note[]) => Promise<void>,
) {
  if (!(await ensureLocalBook(tx, bookId))) throw new Error('这本书已被删除。');
  const store = tx.objectStore('notes');
  const old: Note[] = (await idb(store.get(bookId))) || [];
  const next = patch(old);
  await idb(store.put(next, bookId));
  await changes(old, next);
  return next;
}
export const storage = {
  books: () =>
    localTransaction('readonly', (tx) => idb(tx.objectStore('books').getAll()) as Promise<Book[]>, [
      'books',
    ]),
  async saveBook(book: Book) {
    book = validateBook(book);
    await localTransaction('readwrite', async (tx) => {
      const old = await idb(tx.objectStore('books').get(book.id));
      await idb(tx.objectStore('books').put(book, book.id));
      const meta: SyncEntry | undefined = await idb(
        tx.objectStore('sync').get(syncKey('book', book.id, book.id)),
      );
      if (!old || !meta)
        await stage(tx, 'book', book.id, book.id, {
          shelfState: cleanShelf(readJSON('ai-read-library').books?.[book.id]),
        });
    });
    await changed();
  },
  position: (id: string) => readLocal<Position>('positions', id),
  async readingPosition(id: string) {
    const value = await storage.position(id);
    if (value) lastPosition.set(id, value);
    return value;
  },
  async savePosition(id: string, value: Position) {
    if (sameData(lastPosition.get(id), value)) return;
    await localTransaction('readwrite', async (tx) => {
      if (!(await ensureLocalBook(tx, id))) return;
      const old = await idb(tx.objectStore('positions').get(id));
      if (sameData(old, value)) return;
      await idb(tx.objectStore('positions').put(value, id));
      await stage(tx, 'position', id, id, value);
    });
    lastPosition.set(id, value);
    await changed();
  },
  notes: (id: string) => readLocal<Note[]>('notes', id).then((v) => v || []),
  async addNote(note: Note) {
    const result = await localTransaction('readwrite', (tx) =>
      putNotes(
        tx,
        note.bookId,
        (notes) => [note, ...notes.filter((n) => n.id !== note.id)],
        async () => {
          await stage(tx, 'note', note.bookId, note.id, note);
        },
      ),
    );
    notifyLocalData();
    await changed();
    return result;
  },
  async modifyNote(
    bookId: string,
    noteId: string,
    patch: Pick<Note, 'text'> | null,
    original: Note,
  ) {
    await localTransaction('readwrite', async (tx) => {
      const existing: Note[] = (await idb(tx.objectStore('notes').get(bookId))) || [];
      const current = existing.find((n) => n.id === noteId);
      if (!patch && current && !sameData(current, original))
        throw new Error('这条笔记已更新，未删除。请查看最新内容后重试。');
      if (patch && (!current || !sameData(current, original))) {
        const copy = { ...original, ...patch, id: `conflict-${crypto.randomUUID()}` };
        await putNotes(
          tx,
          bookId,
          (notes) => [...notes, copy],
          async () => {
            await stage(tx, 'note', bookId, copy.id, copy);
          },
        );
        return;
      }
      await putNotes(
        tx,
        bookId,
        (notes) =>
          patch
            ? notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n))
            : notes.filter((n) => n.id !== noteId),
        async (old, next) => {
          const before = old.find((n) => n.id === noteId),
            after = next.find((n) => n.id === noteId);
          if (before && !sameData(before, after))
            await stage(tx, 'note', bookId, noteId, after, !patch);
        },
      );
    });
    notifyLocalData();
    await changed();
  },
  async restoreReadingBackup(backup: ReadingBackup) {
    backup = validateBackup(backup);
    await localTransaction('readwrite', async (tx) => {
      for (const book of backup.books) {
        if (!(await idb(tx.objectStore('books').get(book.id)))) {
          await idb(tx.objectStore('books').put(book, book.id));
          await stage(tx, 'book', book.id, book.id, {
            shelfState: cleanShelf(readJSON('ai-read-library').books?.[book.id]),
          });
        }
        const notes: Note[] = (await idb(tx.objectStore('notes').get(book.id))) || [];
        const ids = new Set(notes.map((n) => n.id));
        for (const note of backup.notes.filter((n) => n.bookId === book.id && !ids.has(n.id))) {
          notes.push(note);
          await stage(tx, 'note', book.id, note.id, note);
        }
        await idb(tx.objectStore('notes').put(notes, book.id));
        const position = backup.positions[book.id];
        if (position && !(await idb(tx.objectStore('positions').get(book.id)))) {
          await idb(tx.objectStore('positions').put(position, book.id));
          await stage(tx, 'position', book.id, book.id, position);
        }
      }
    });
    notifyLocalData();
    await changed();
  },
  chat: (id: string) => readLocal<Message[]>('chats', id).then((v) => v || []),
  async saveChat(id: string, messages: Message[]) {
    const turns = await messagesToTurns(messages);
    if (!turns.length) return;
    await localTransaction('readwrite', async (tx) => {
      if (!(await ensureLocalBook(tx, id))) return;
      for (const turn of turns) {
        const key = syncKey('chat', id, turn.id);
        const old = await idb(tx.objectStore('turns').get(key));
        const meta: SyncEntry | undefined = await idb(tx.objectStore('sync').get(key));
        // Final turns are append-only. An old reader cannot resurrect a cleared turn.
        if (old || meta?.deleted || meta?.pending?.deleted) continue;
        await idb(tx.objectStore('turns').put({ ...turn, bookId: id }, key));
        await stage(tx, 'chat', id, turn.id, turn);
      }
      await turnsToMessages(tx, id);
    });
    await changed();
  },
  async clearChat(id: string) {
    await localTransaction('readwrite', async (tx) => {
      const turns: (ChatTurn & { bookId: string })[] = await idb(tx.objectStore('turns').getAll());
      for (const turn of turns.filter((t) => t.bookId === id)) {
        await idb(tx.objectStore('turns').delete(syncKey('chat', id, turn.id)));
        await stage(tx, 'chat', id, turn.id, undefined, true);
      }
      await idb(tx.objectStore('chats').put([], id));
    });
    notifyLocalData();
    await changed();
  },
  translations: (id: string) =>
    readLocal<Record<string, string>>('translations', id).then((v) => v || {}),
  async saveTranslations(id: string, value: Record<string, string>) {
    await localTransaction('readwrite', async (tx) => {
      if (!(await ensureLocalBook(tx, id))) return;
      const old: Record<string, string> = (await idb(tx.objectStore('translations').get(id))) || {};
      for (const [key, text] of Object.entries(value))
        if (text && !Object.hasOwn(old, key)) {
          old[key] = text;
          await stage(tx, 'translation', id, key, { key, text });
        }
      await idb(tx.objectStore('translations').put(old, id));
    });
    await changed();
  },
  async deleteBook(id: string) {
    await localTransaction('readwrite', async (tx) => {
      await removeLocalBook(tx, id);
      await stage(tx, 'book', id, id, undefined, true);
    });
    lastPosition.delete(id);
    notifyLocalData();
    await changed();
  },
};

// Seed each old record only once. Never infer deletion from missing local data.
export async function prepareLocalSync() {
  if (!storageUserId()) return;
  const books = await storage.books();
  const known = new Set(books.map((b) => b.id));
  const assetKeys = await localTransaction('readonly', async (tx) => {
    const keys = new Set<string>();
    for (const name of ['positions', 'notes', 'chats', 'translations'])
      for (const key of await idb(tx.objectStore(name).getAllKeys())) keys.add(String(key));
    return keys;
  });
  for (const sample of catalog)
    if (!known.has(sample.id) && assetKeys.has(sample.id)) {
      await storage.saveBook(sample);
      books.push(sample);
    }
  for (const book of books) {
    const turns = await messagesToTurns(await storage.chat(book.id));
    await localTransaction('readwrite', async (tx) => {
      const seed = async (entity: SyncEntry['entity'], id: string, data: any) => {
        if (!(await idb(tx.objectStore('sync').get(syncKey(entity, book.id, id)))))
          await stage(tx, entity, book.id, id, data);
      };
      // Reconcile legacy localStorage shelf writes after an interrupted tab.
      await stage(tx, 'book', book.id, book.id, {
        shelfState: cleanShelf(readJSON('ai-read-library').books?.[book.id]),
      });
      const position = await idb(tx.objectStore('positions').get(book.id));
      if (position) await seed('position', book.id, position);
      const notes: Note[] = (await idb(tx.objectStore('notes').get(book.id))) || [];
      for (const note of notes) await seed('note', note.id, note);
      for (const turn of turns) {
        const key = syncKey('chat', book.id, turn.id);
        const meta: SyncEntry | undefined = await idb(tx.objectStore('sync').get(key));
        if (meta?.deleted || meta?.pending?.deleted) continue;
        if (!(await idb(tx.objectStore('turns').get(key))))
          await idb(tx.objectStore('turns').put({ ...turn, bookId: book.id }, key));
        await seed('chat', turn.id, turn);
      }
      const translations = (await idb(tx.objectStore('translations').get(book.id))) || {};
      for (const [key, text] of Object.entries(translations))
        if (typeof text === 'string' && key.split(':').length === 3 && !key.endsWith(':sample'))
          await seed('translation', key, { key, text });
    });
  }
  if (
    localStorage.getItem(storageKey('ai-read-settings')) ||
    localStorage.getItem(storageKey('ai-read-library'))
  )
    await stagePreferences();
}
export function loadSettings(): Settings {
  const raw = readJSON('ai-read-settings');
  return {
    ...defaults,
    apiKey: sessionApiKey,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    translationPrompt: effectiveTranslationPrompt(
      typeof raw.translationPrompt === 'string'
        ? raw.translationPrompt.slice(0, MAX_TRANSLATION_PROMPT_LENGTH)
        : '',
    ),
    language: typeof raw.language === 'string' ? raw.language : defaults.language,
    fontSize: Math.min(26, Math.max(15, Number(raw.fontSize) || 19)),
    fontFamily: raw.fontFamily === 'serif' ? 'serif' : 'system',
    lineHeight: Math.min(2.4, Math.max(1.5, Number(raw.lineHeight) || defaults.lineHeight)),
    pageWidth: Math.min(840, Math.max(560, Number(raw.pageWidth) || defaults.pageWidth)),
    pageMargin: Math.min(36, Math.max(16, Number(raw.pageMargin) || defaults.pageMargin)),
    theme: raw.theme === 'night' ? 'night' : 'paper',
    scope: ['chapter', 'read', 'book'].includes(raw.scope) ? raw.scope : 'chapter',
    readingMode: ['original', 'bilingual', 'translation'].includes(raw.readingMode)
      ? raw.readingMode
      : defaults.readingMode,
    navigationMode: ['paged', 'scroll'].includes(raw.navigationMode)
      ? raw.navigationMode
      : defaults.navigationMode,
    pageEffect: ['curl', 'slide', 'none'].includes(raw.pageEffect) ? raw.pageEffect : 'curl',
    scrollFlow: raw.scrollFlow === 'chapter' ? 'chapter' : 'continuous',
  };
}
export function saveSettings(settings: Settings) {
  sessionApiKey = settings.apiKey;
  const { apiKey: _key, ...safe } = settings;
  localStorage.setItem(storageKey('ai-read-settings'), JSON.stringify(safe));
  void stagePreferences().catch(reportSyncError);
}
