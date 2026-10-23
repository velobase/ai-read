import { bookmarks, addBookmark, modifyBookmark } from './bookmark-storage';
import { MAX_BOOKMARKS_PER_BOOK } from '../../packages/reading-core/src/bookmarks';
import { sameBookContent } from '../../packages/reading-core/src/import-markup';
import { supplementBookMedia } from '../../packages/reading-core/src/book-media';
import { supplementBookReferences } from '../../packages/reading-core/src/book-references';
import { isBookSourceLanguage } from '../../packages/reading-core/src/reading-language';
import { resolveTranslationKey } from '../../packages/reading-core/src/translation-key';
import { preparePdfOriginal } from './pdf/original';
import {
  validatePortableLibrary,
  type PortableTranslation,
  type PortableCollection,
  type PortableLibrary,
} from './portable-library';
import { mergeSavedTranslationVersions } from './saved-translation-storage';
import {
  assertLibraryScope,
  captureLibraryScope,
  loadLibraryState,
  mergePortableCollections,
  resumePortableCollections,
  stagePortableCollections,
} from './library-state';
import { effectiveTranslationPrompt, MAX_TRANSLATION_PROMPT_LENGTH } from './translation-prompt';
import { translationFingerprint } from './translation-prompt';
import { catalog } from './catalog';
import type { Book, Bookmark, Message, Note, Position, Settings } from './types';
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
/** Update only the user's source-language choice, preserving imported text and anchors. */
export async function setBookSourceLanguage(bookId: string, sourceLanguage: string): Promise<Book> {
  if (!isBookSourceLanguage(sourceLanguage)) throw new Error('原文语言无效。');
  let updated = false;
  const book = await localTransaction(
    'readwrite',
    async (tx) => {
      if (!(await ensureLocalBook(tx, bookId))) throw new Error('没有找到这本书');
      const store = tx.objectStore('books');
      const current = (await idb(store.get(bookId))) as Book;
      if (current.sourceLanguage === sourceLanguage) return current;
      const next = { ...current, sourceLanguage };
      await idb(store.put(next, bookId));
      await stage(tx, 'book', bookId, bookId, {
        shelfState: cleanShelf(readJSON('ai-read-library').books?.[bookId]),
      });
      updated = true;
      return next;
    },
    ['books', 'sync'],
  );
  if (updated) {
    notifyLocalData();
    notifySyncDirty();
  }
  return book;
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
  setBookSourceLanguage,
  bookmarks,
  addBookmark,
  modifyBookmark,
  async librarySnapshot() {
    await resumePortableCollections();
    // One consistent read transaction instead of 1 + 2N separate transactions.
    return localTransaction(
      'readonly',
      async (tx) => {
        const [books, noteGroups, bookmarkGroups, positionKeys, positionValues] = await Promise.all(
          [
            idb(tx.objectStore('books').getAll()) as Promise<Book[]>,
            idb(tx.objectStore('notes').getAll()) as Promise<Note[][]>,
            idb(tx.objectStore('bookmarks').getAll()) as Promise<Bookmark[][]>,
            idb(tx.objectStore('positions').getAllKeys()),
            idb(tx.objectStore('positions').getAll()) as Promise<Position[]>,
          ],
        );
        return {
          books,
          notes: noteGroups.flat(),
          bookmarks: bookmarkGroups.flat(),
          positions: Object.fromEntries(
            positionKeys.map((key, index) => [String(key), positionValues[index]]),
          ) as Record<string, Position | undefined>,
        };
      },
      ['books', 'notes', 'bookmarks', 'positions'],
    );
  },
  books: () =>
    localTransaction('readonly', (tx) => idb(tx.objectStore('books').getAll()) as Promise<Book[]>, [
      'books',
    ]),
  async saveBook(book: Book, originalPdf?: Blob) {
    book = validateBook(book);
    const source = originalPdf ? await preparePdfOriginal(book, originalPdf) : undefined;
    await localTransaction('readwrite', async (tx) => {
      const old: Book | undefined = await idb(tx.objectStore('books').get(book.id));
      if (old && !sameBookContent(old, book)) throw new Error('同一书籍 ID 的正文不一致，未导入。');
      if (old)
        book = {
          ...supplementBookReferences(supplementBookMedia(old, book), book),
          cover: book.cover || old.cover,
          toc: old.toc?.length ? old.toc : book.toc,
          sourceFormat: old.sourceFormat || book.sourceFormat,
          sourceLanguage: old.sourceLanguage ?? book.sourceLanguage,
        };
      await idb(tx.objectStore('books').put(book, book.id));
      if (source) await idb(tx.objectStore('pdf-originals').put(source, book.id));
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
  async restoreReadingBackup(
    backup: ReadingBackup,
    translations: PortableTranslation[] = [],
    collections?: PortableCollection[],
  ) {
    return storage.restorePortableLibrary({
      format: 'bypage-portable-library',
      version: 1,
      backup,
      translations,
      ...(collections !== undefined ? { collections } : {}),
    });
  },
  async restorePortableLibrary(value: PortableLibrary) {
    const scope = captureLibraryScope();
    const pack = validatePortableLibrary(value);
    const backup = pack.backup;
    if (pack.collections?.length)
      mergePortableCollections(loadLibraryState(true), pack.collections);
    await localTransaction('readwrite', async (tx) => {
      assertLibraryScope(scope, tx);
      const existingBooks = new Set<string>();
      for (const book of backup.books) {
        const existing: Book | undefined = await idb(tx.objectStore('books').get(book.id));
        if (existing) existingBooks.add(book.id);
        if (existing && !sameBookContent(existing, book))
          throw new Error('同一书籍 ID 的正文不一致，未导入。');
        if (
          existing &&
          ((!existing.toc?.length && book.toc?.length) ||
            (!existing.sourceFormat && book.sourceFormat) ||
            (existing.sourceLanguage === undefined && book.sourceLanguage !== undefined) ||
            (book.references && book.references.revision !== existing.references?.revision) ||
            (book.media && book.media.revision !== existing.media?.revision))
        )
          await idb(
            tx.objectStore('books').put(
              {
                ...supplementBookReferences(supplementBookMedia(existing, book), book),
                toc: existing.toc?.length ? existing.toc : book.toc,
                sourceFormat: existing.sourceFormat || book.sourceFormat,
                sourceLanguage: existing.sourceLanguage ?? book.sourceLanguage,
              },
              book.id,
            ),
          );
        if (!existing) {
          await idb(tx.objectStore('books').put(book, book.id));
        }
        await stage(tx, 'book', book.id, book.id, {
          shelfState: cleanShelf(readJSON('ai-read-library').books?.[book.id]),
        });
        const notes: Note[] = (await idb(tx.objectStore('notes').get(book.id))) || [];
        const ids = new Set(notes.map((n) => n.id));
        for (const note of backup.notes.filter((n) => n.bookId === book.id && !ids.has(n.id))) {
          notes.push(note);
          await stage(tx, 'note', book.id, note.id, note);
        }
        await idb(tx.objectStore('notes').put(notes, book.id));
        const bookmarks: Bookmark[] = (await idb(tx.objectStore('bookmarks').get(book.id))) || [];
        const bookmarkIds = new Set(bookmarks.map((item) => item.id));
        const incoming = (backup.bookmarks || []).filter(
          (item) => item.bookId === book.id && !bookmarkIds.has(item.id),
        );
        if (bookmarks.length + incoming.length > MAX_BOOKMARKS_PER_BOOK)
          throw new Error('每本书最多保存 1000 条书签。');
        for (const item of incoming) {
          bookmarks.push(item);
          await stage(tx, 'bookmark', book.id, item.id, item);
        }
        await idb(tx.objectStore('bookmarks').put(bookmarks, book.id));
        const position = backup.positions[book.id];
        if (position && !(await idb(tx.objectStore('positions').get(book.id)))) {
          await idb(tx.objectStore('positions').put(position, book.id));
          await stage(tx, 'position', book.id, book.id, position);
        }
      }
      if (pack.version === 2)
        await mergeSavedTranslationVersions(
          tx,
          pack.translationVersions,
          pack.translationSelections,
          existingBooks,
          translationFingerprint(loadSettings()),
        );
      for (const entry of pack.translations) {
        const values: Record<string, string> =
          (await idb(tx.objectStore('translations').get(entry.bookId))) || {};
        for (const [paragraph, text] of Object.entries(entry.paragraphs)) {
          const key = `${entry.language}:${paragraph}:portable-v1`;
          const exact = await idb(tx.objectStore('translation-versions').get([entry.bookId, key]));
          if (exact && exact.text !== text) throw new Error('saved_translation_immutable_conflict');
          if (!values[key]) {
            values[key] = text;
            await stage(tx, 'translation', entry.bookId, key, { key, text });
          }
        }
        await idb(tx.objectStore('translations').put(values, entry.bookId));
      }
      assertLibraryScope(scope, tx);
      if (pack.collections?.length) await stagePortableCollections(tx, scope, pack.collections);
    });
    const result = await resumePortableCollections(scope);
    notifyLocalData();
    await changed();
    return result;
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
          const exact = await idb(tx.objectStore('translation-versions').get([id, key]));
          if (exact && exact.text !== text) throw new Error('saved_translation_immutable_conflict');
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
    for (const name of ['positions', 'notes', 'bookmarks', 'chats', 'translations'])
      for (const key of await idb(tx.objectStore(name).getAllKeys())) keys.add(String(key));
    return keys;
  });
  for (const sample of catalog)
    if (!known.has(sample.id) && assetKeys.has(sample.id)) {
      await storage.saveBook(sample);
      books.push(sample);
    }
  for (const book of books) {
    const paragraphIds = new Set(
      book.chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph) => paragraph.id)),
    );
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
      const bookmarks: Bookmark[] = (await idb(tx.objectStore('bookmarks').get(book.id))) || [];
      for (const item of bookmarks) await seed('bookmark', item.id, item);
      for (const turn of turns) {
        const key = syncKey('chat', book.id, turn.id);
        const meta: SyncEntry | undefined = await idb(tx.objectStore('sync').get(key));
        if (meta?.deleted || meta?.pending?.deleted) continue;
        if (!(await idb(tx.objectStore('turns').get(key))))
          await idb(tx.objectStore('turns').put({ ...turn, bookId: book.id }, key));
        await seed('chat', turn.id, turn);
      }
      const translations = (await idb(tx.objectStore('translations').get(book.id))) || {};
      for (const [key, text] of Object.entries(translations)) {
        const resolved = resolveTranslationKey(key, paragraphIds);
        if (typeof text === 'string' && resolved && resolved.version !== 'sample')
          await seed('translation', key, { key, text });
      }
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
