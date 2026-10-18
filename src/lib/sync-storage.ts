import { catalog } from './catalog';
import {
  idb,
  localTransaction,
  notifyLocalData,
  notifySyncDirty,
  readLocal,
} from './local-database';
import { storageKey, storageUserId } from './storage-scope';
import {
  cleanPreferences,
  cleanShelf,
  sameData,
  syncKey,
  type ChatTurn,
  type Preferences,
  type SyncData,
  type SyncEntity,
  type SyncEntry,
  type SyncRecord,
} from './sync-types';
import type { Book, Message, Note, Position } from './types';
import type { BookState } from './library-state';
import type { ReadingBackup } from './reading-backup';
import { removeBookTranslations } from './translation-storage';

export function readJSON(key: string): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(key)) || '{}');
  } catch {
    return {};
  }
}
export function localPreferences(): Preferences {
  return cleanPreferences({
    settings: readJSON('ai-read-settings'),
    groups: readJSON('ai-read-library').groups,
  });
}
export async function stage(
  tx: IDBTransaction,
  entity: SyncEntity,
  bookId: string,
  id: string,
  data?: SyncData[SyncEntity],
  deleted = false,
) {
  if (!storageUserId()) return;
  const key = syncKey(entity, bookId, id);
  const store = tx.objectStore('sync');
  const old: SyncEntry | undefined = await idb(store.get(key));
  if (old?.pending && old.pending.deleted === deleted && sameData(old.pending.data, data)) return;
  if (!old?.pending && old && old.deleted === deleted && sameData(old.shadow, data)) return;
  const entry: SyncEntry = old || { key, entity, bookId, id, version: 0, deleted: false };
  entry.pending = {
    mutationId: crypto.randomUUID(),
    baseVersion: entry.pending?.baseVersion ?? entry.version,
    deleted,
    data,
  };
  delete entry.rejectedMutationId;
  await idb(store.put(entry, key));
}
export async function rejectSyncMutation(sent: SyncEntry) {
  await localTransaction(
    'readwrite',
    async (tx) => {
      const store = tx.objectStore('sync');
      const current: SyncEntry | undefined = await idb(store.get(sent.key));
      if (current?.pending && current.pending.mutationId === sent.pending?.mutationId) {
        current.rejectedMutationId = current.pending.mutationId;
        await idb(store.put(current, current.key));
      }
    },
    ['sync'],
  );
}
export async function retryRejectedSync() {
  await localTransaction(
    'readwrite',
    async (tx) => {
      const store = tx.objectStore('sync');
      const entries: SyncEntry[] = await idb(store.getAll());
      for (const entry of entries) {
        if (!entry.rejectedMutationId) continue;
        delete entry.rejectedMutationId;
        await idb(store.put(entry, entry.key));
      }
    },
    ['sync'],
  );
}
export async function ensureLocalBook(tx: IDBTransaction, bookId: string) {
  const books = tx.objectStore('books');
  let book: Book | undefined = await idb(books.get(bookId));
  if (!book) {
    const meta: SyncEntry | undefined = await idb(
      tx.objectStore('sync').get(syncKey('book', bookId, bookId)),
    );
    if (meta?.deleted) return false;
    book = catalog.find((b) => b.id === bookId);
    if (!book) return false;
    await idb(books.put(book, bookId));
    await stage(tx, 'book', bookId, bookId, {
      shelfState: cleanShelf(readJSON('ai-read-library').books?.[bookId]),
    });
  }
  return true;
}
export async function stageShelfState(ids: string[], states: Record<string, BookState>) {
  if (!storageUserId()) return;
  await localTransaction('readwrite', async (tx) => {
    for (const id of ids)
      if (await ensureLocalBook(tx, id))
        await stage(tx, 'book', id, id, { shelfState: cleanShelf(states[id]) });
  });
  notifySyncDirty();
}
export async function stagePreferences() {
  if (!storageUserId()) return;
  const data = localPreferences();
  await localTransaction('readwrite', (tx) => stage(tx, 'preferences', '', 'preferences', data));
  notifySyncDirty();
}
export const getSyncEntry = (entity: SyncEntity, bookId: string, id: string) =>
  readLocal<SyncEntry>('sync', syncKey(entity, bookId, id));
export const allSyncEntries = () =>
  localTransaction(
    'readonly',
    (tx) => idb(tx.objectStore('sync').getAll()) as Promise<SyncEntry[]>,
    ['sync'],
  );
export async function turnsToMessages(tx: IDBTransaction, bookId: string) {
  const turns: (ChatTurn & { bookId: string })[] = await idb(tx.objectStore('turns').getAll());
  const messages: Message[] = turns
    .filter((t) => t.bookId === bookId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(-30)
    .flatMap((t) => [
      { turnId: t.id, createdAt: t.createdAt, role: 'user' as const, content: t.question },
      {
        turnId: t.id,
        createdAt: t.createdAt,
        role: 'assistant' as const,
        content: t.answer,
        sources: t.sources,
        partial: t.partial,
      },
    ]);
  await idb(tx.objectStore('chats').put(messages, bookId));
}
export async function messagesToTurns(messages: Message[]): Promise<ChatTurn[]> {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i],
      answer = messages[i + 1];
    if (question.role !== 'user' || answer.role !== 'assistant' || !answer.content) continue;
    let id = question.turnId;
    if (!id) {
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          JSON.stringify([question.content, answer.content, answer.sources || []]),
        ),
      );
      id =
        'legacy-' +
        Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    turns.push({
      id,
      question: question.content,
      answer: answer.content,
      sources: answer.sources || [],
      partial: !!answer.partial,
      createdAt: question.createdAt ?? i,
    });
    i++;
  }
  return turns;
}
export async function keepRecovery(tx: IDBTransaction, bookId: string) {
  const book: Book | undefined = await idb(tx.objectStore('books').get(bookId));
  if (!book) return;
  const notes = (await idb(tx.objectStore('notes').get(bookId))) || [];
  const position = await idb(tx.objectStore('positions').get(bookId));
  const chats = (await idb(tx.objectStore('chats').get(bookId))) || [];
  const translations = (await idb(tx.objectStore('translations').get(bookId))) || {};
  const translationManifests = (await idb(tx.objectStore('translation-manifests').getAll())).filter(
    (m) => m.editions?.some((e: { bookId: string }) => e.bookId === bookId),
  );
  const chapterTranslations = (await idb(tx.objectStore('chapter-translations').getAll())).filter(
    (c) => c.bookId === bookId,
  );
  await idb(
    tx
      .objectStore('sync-recovery')
      .put(
        {
          book,
          notes,
          position,
          chats,
          translations,
          translationManifests,
          chapterTranslations,
          savedAt: Date.now(),
        },
        bookId,
      ),
  );
}
export async function removeLocalBook(tx: IDBTransaction, bookId: string) {
  await removeBookTranslations(tx, bookId);
  for (const store of ['books', 'notes', 'positions', 'chats', 'translations'])
    await idb(tx.objectStore(store).delete(bookId));
  const turns: (ChatTurn & { bookId: string })[] = await idb(tx.objectStore('turns').getAll());
  for (const turn of turns)
    if (turn.bookId === bookId)
      await idb(tx.objectStore('turns').delete(syncKey('chat', bookId, turn.id)));
  const entries: SyncEntry[] = await idb(tx.objectStore('sync').getAll());
  for (const entry of entries)
    if (entry.bookId === bookId && entry.entity !== 'book') {
      entry.deleted = true;
      entry.pending = undefined;
      await idb(tx.objectStore('sync').put(entry, entry.key));
    }
}
async function putRemote(tx: IDBTransaction, record: SyncRecord) {
  const { entity, bookId, id, deleted, data } = record;
  if (entity === 'book') {
    if (deleted) {
      await keepRecovery(tx, bookId);
      await removeLocalBook(tx, bookId);
    } else {
      const content = (data as SyncData['book']).content;
      if (content) await idb(tx.objectStore('books').put(content, bookId));
    }
  } else if (entity === 'note') {
    const store = tx.objectStore('notes');
    const notes: Note[] = (await idb(store.get(bookId))) || [];
    await idb(
      store.put([...notes.filter((n) => n.id !== id), ...(!deleted ? [data as Note] : [])], bookId),
    );
  } else if (entity === 'position') {
    if (deleted) await idb(tx.objectStore('positions').delete(bookId));
    else await idb(tx.objectStore('positions').put(data, bookId));
  } else if (entity === 'chat') {
    const store = tx.objectStore('turns');
    if (deleted) await idb(store.delete(syncKey(entity, bookId, id)));
    else await idb(store.put({ ...(data as ChatTurn), bookId }, syncKey(entity, bookId, id)));
    await turnsToMessages(tx, bookId);
  } else if (entity === 'translation') {
    const store = tx.objectStore('translations');
    const values = (await idb(store.get(bookId))) || {};
    if (deleted) delete values[id];
    else values[id] = (data as SyncData['translation']).text;
    await idb(store.put(values, bookId));
  }
}
function applyLocalStorage(record: SyncRecord) {
  if (record.entity === 'book') {
    const state = readJSON('ai-read-library');
    state.books ||= {};
    if (record.deleted) delete state.books[record.id];
    else state.books[record.id] = cleanShelf((record.data as SyncData['book']).shelfState);
    localStorage.setItem(storageKey('ai-read-library'), JSON.stringify(state));
  } else if (record.entity === 'preferences') {
    const data = cleanPreferences(record.data);
    localStorage.setItem(
      storageKey('ai-read-settings'),
      JSON.stringify({ ...readJSON('ai-read-settings'), ...data.settings }),
    );
    const state = readJSON('ai-read-library');
    state.groups = data.groups;
    localStorage.setItem(storageKey('ai-read-library'), JSON.stringify(state));
    window.dispatchEvent(new Event('ai-read-preferences-change'));
  }
}
function shadowOf(record: SyncRecord) {
  return record.entity === 'book'
    ? { shelfState: (record.data as SyncData['book'] | undefined)?.shelfState || {} }
    : record.data;
}
// Recheck pending edits inside the same transaction that applies the remote value.
export async function applyRemote(record: SyncRecord, sent?: SyncEntry, conflict = false) {
  let applied = false;
  await localTransaction('readwrite', async (tx) => {
    const key = syncKey(record.entity, record.bookId, record.id);
    const store = tx.objectStore('sync');
    const current: SyncEntry | undefined = await idb(store.get(key));
    if (current && record.version < current.version) return;
    if (current?.pending && !sent) {
      // A book deletion supersedes its children, but keep a recoverable local copy.
      if (!(record.entity === 'book' && record.deleted)) return;
    }
    const pending = current?.pending;
    let keepPending =
      pending && sent && pending.mutationId !== sent.pending?.mutationId && !conflict;
    if (conflict && pending) {
      if (
        record.entity === 'note' &&
        !pending.deleted &&
        pending.data &&
        (record.deleted || !sameData(pending.data, record.data))
      ) {
        const note = { ...(pending.data as Note), id: `conflict-${pending.mutationId}` };
        const notes: Note[] = (await idb(tx.objectStore('notes').get(record.bookId))) || [];
        if (!notes.some((n) => n.id === note.id))
          await idb(tx.objectStore('notes').put([...notes, note], record.bookId));
        await stage(tx, 'note', record.bookId, note.id, note);
      } else if (record.entity === 'position') await keepRecovery(tx, record.bookId);
      else if (
        !record.deleted &&
        !pending.deleted &&
        (record.entity === 'book' || record.entity === 'preferences')
      ) {
        const old =
          record.entity === 'book'
            ? (current?.shadow as SyncData['book'] | undefined)?.shelfState || {}
            : (current?.shadow as Preferences | undefined)?.settings || {};
        const incoming =
          record.entity === 'book'
            ? (pending.data as SyncData['book']).shelfState
            : (pending.data as Preferences).settings;
        const remote =
          record.entity === 'book'
            ? (record.data as SyncData['book']).shelfState
            : (record.data as Preferences).settings;
        const merged = { ...remote } as Record<string, unknown>;
        for (const [field, value] of Object.entries(incoming))
          if (
            !sameData(value, (old as Record<string, unknown>)[field]) &&
            sameData(
              (remote as Record<string, unknown>)[field],
              (old as Record<string, unknown>)[field],
            )
          )
            merged[field] = value;
        const next =
          record.entity === 'book'
            ? { shelfState: cleanShelf(merged) }
            : cleanPreferences({
                settings: merged,
                groups: [
                  ...new Set([
                    ...(record.data as Preferences).groups,
                    ...(pending.data as Preferences).groups,
                  ]),
                ],
              });
        if (!sameData(next, shadowOf(record))) {
          keepPending = true;
          pending.data = next;
          pending.baseVersion = record.version;
          pending.mutationId = crypto.randomUUID();
        }
      }
    }
    if (!keepPending) await putRemote(tx, record);
    const entry: SyncEntry = {
      key,
      entity: record.entity,
      bookId: record.bookId,
      id: record.id,
      version: record.version,
      deleted: record.deleted,
      shadow: shadowOf(record),
    };
    if (keepPending && pending) entry.pending = { ...pending, baseVersion: record.version };
    await idb(store.put(entry, key));
    applied = !keepPending;
    // Storage and metadata are committed together; these tiny legacy preferences
    // are mirrored before commit so a following local writer sees the new values.
    if (applied) applyLocalStorage(record);
    else if (conflict && pending && (record.entity === 'book' || record.entity === 'preferences')) {
      applyLocalStorage({ ...record, data: pending.data });
      applied = true;
    }
  });
  if (applied) notifyLocalData();
}
export async function recoveryBackup(): Promise<ReadingBackup> {
  const entries = await localTransaction(
    'readonly',
    (tx) => idb(tx.objectStore('sync-recovery').getAll()),
    ['sync-recovery'],
  );
  return {
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: Date.now(),
    books: entries.map((e) => e.book),
    notes: entries.flatMap((e) => e.notes),
    positions: Object.fromEntries(
      entries.filter((e) => e.position).map((e) => [e.book.id, e.position]),
    ),
  };
}
