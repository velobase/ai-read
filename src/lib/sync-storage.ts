import {
  MAX_BOOKMARKS_PER_BOOK,
  validateBookmark,
} from '../../packages/reading-core/src/bookmarks';
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
import type { Book, Bookmark, Message, Note, Position } from './types';
import type { BookState } from './library-state';
import type { ReadingBackup } from './reading-backup';
import { removeBookTranslations } from './translation-storage';
import { bookMetadata } from './sync-types';
import { supplementBookMetadata } from './book-metadata';
import { supplementBookMedia } from '../../packages/reading-core/src/book-media';
import {
  supplementBookReferences,
  supplementReferences,
} from '../../packages/reading-core/src/book-references';
import { sameBookContent } from '../../packages/reading-core/src/import-markup';
import { validateBook } from './reading-backup';
import { savedTranslationRange, savedTranslationSnapshot } from './saved-translation-storage';
import { assertLibraryScope, captureLibraryScope } from './library-state';

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
  if (entity === 'book' && !deleted) {
    const book: Book | undefined = await idb(tx.objectStore('books').get(bookId));
    const remoteMetadata = (old?.shadow as SyncData['book'] | undefined)?.metadata || {};
    const metadata = bookMetadata(remoteMetadata, book || {});
    // This field is user-editable; the local choice (including `auto`) wins when staging.
    if (book?.sourceLanguage !== undefined) metadata.sourceLanguage = book.sourceLanguage;
    const localRevision = book?.media?.revision;
    const alreadyCompared =
      old?.mediaChecked?.localRevision === localRevision &&
      old?.mediaChecked?.remoteRevision === remoteMetadata.mediaRevision;
    // Navigation stays additive. Media may advance after a compatible reimport;
    // try a changed sidecar once, without repeatedly proposing a smaller one.
    if (localRevision && !alreadyCompared) metadata.mediaRevision = localRevision;
    data = {
      ...(data as SyncData['book']),
      metadata,
    };
  }
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
  const bookmarks = (await idb(tx.objectStore('bookmarks').get(bookId))) || [];
  const position = await idb(tx.objectStore('positions').get(bookId));
  const chats = (await idb(tx.objectStore('chats').get(bookId))) || [];
  const translations = (await idb(tx.objectStore('translations').get(bookId))) || {};
  const manifestKeys = await idb(tx.objectStore('translation-manifests').getAllKeys());
  const manifests = await idb(tx.objectStore('translation-manifests').getAll());
  const manifestIndices = manifests.flatMap((m, index) => {
    let tuple: unknown;
    try {
      tuple = JSON.parse(String(manifestKeys[index]));
    } catch {}
    return (Array.isArray(tuple) && tuple[0] === bookId) ||
      m.editions?.some((e: { bookId: string }) => e.bookId === bookId)
      ? [index]
      : [];
  });
  const translationManifests = manifestIndices.map((index) => manifests[index]);
  const translationManifestKeys = manifestIndices.map((index) => manifestKeys[index]);
  const exact = await savedTranslationSnapshot(tx, bookId);
  const chapterTranslations = (await idb(tx.objectStore('chapter-translations').getAll())).filter(
    (c) => c.bookId === bookId,
  );
  await idb(
    tx.objectStore('sync-recovery').put(
      {
        book,
        notes,
        bookmarks,
        position,
        chats,
        translations,
        translationManifests,
        translationManifestKeys,
        translationVersions: exact.versions,
        translationSelections: exact.selections,
        chapterTranslations,
        savedAt: Date.now(),
      },
      bookId,
    ),
  );
}
export async function removeLocalBook(tx: IDBTransaction, bookId: string) {
  await removeBookTranslations(tx, bookId);
  for (const name of ['translation-versions', 'translation-selections'])
    await idb(tx.objectStore(name).delete(savedTranslationRange(bookId)));
  for (const store of [
    'books',
    'notes',
    'bookmarks',
    'positions',
    'chats',
    'translations',
    'pdf-originals',
  ])
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
      const incoming = data as SyncData['book'];
      const existing: Book | undefined = await idb(tx.objectStore('books').get(bookId));
      const content = incoming.content ? validateBook(incoming.content) : undefined;
      if (content && (content.id !== bookId || (existing && !sameBookContent(existing, content))))
        throw new Error('invalid-sync-data');
      const base =
        existing && content
          ? supplementBookReferences(supplementBookMedia(existing, content), content)
          : existing || content;
      if (base) {
        const next = supplementBookMetadata(
          base,
          incoming.metadata || (content && bookMetadata(content)),
        );
        if (next !== existing) await idb(tx.objectStore('books').put(next, bookId));
        return next;
      }
    }
  } else if (entity === 'note') {
    const store = tx.objectStore('notes');
    const notes: Note[] = (await idb(store.get(bookId))) || [];
    await idb(
      store.put([...notes.filter((n) => n.id !== id), ...(!deleted ? [data as Note] : [])], bookId),
    );
  } else if (entity === 'bookmark') {
    const store = tx.objectStore('bookmarks');
    const existing: Bookmark[] = (await idb(store.get(bookId))) || [];
    const next = existing.filter((item) => item.id !== id);
    if (!deleted) {
      const book: Book | undefined = await idb(tx.objectStore('books').get(bookId));
      if (!book) throw new Error('invalid-sync-data');
      const bookmark = validateBookmark(book, data);
      if (bookmark.id !== id || next.length >= MAX_BOOKMARKS_PER_BOOK)
        throw new Error('Invalid bookmark');
      next.push(bookmark);
    }
    await idb(store.put(next, bookId));
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
    else {
      const text = (data as SyncData['translation']).text;
      const exact = await idb(tx.objectStore('translation-versions').get([bookId, id]));
      if (exact && exact.text !== text) throw new Error('saved_translation_immutable_conflict');
      values[id] = text;
    }
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
    ? {
        shelfState: (record.data as SyncData['book'] | undefined)?.shelfState || {},
        metadata: bookMetadata(
          (record.data as SyncData['book'] | undefined)?.metadata || {},
          (record.data as SyncData['book'] | undefined)?.content || {},
        ),
      }
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
      pending &&
      sent &&
      pending.mutationId !== sent.pending?.mutationId &&
      (!conflict || (pending.deleted && !record.deleted));
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
      } else if (
        record.entity === 'bookmark' &&
        !pending.deleted &&
        pending.data &&
        (record.deleted || !sameData(pending.data, record.data))
      ) {
        const book = (await idb(tx.objectStore('books').get(record.bookId))) as Book | undefined;
        if (!book) throw new Error('invalid-sync-data');
        const bookmark = validateBookmark(book, {
          ...(pending.data as Bookmark),
          id: `conflict-${pending.mutationId}`,
        });
        const existing: Bookmark[] =
          (await idb(tx.objectStore('bookmarks').get(record.bookId))) || [];
        if (!existing.some((item) => item.id === bookmark.id)) {
          // Fail visibly at the limit: never discard either label to accept a conflict.
          const retained = record.deleted
            ? existing.filter((item) => item.id !== record.id)
            : existing;
          if (retained.length >= MAX_BOOKMARKS_PER_BOOK)
            throw new Error('每本书最多保存 1000 条书签。');
          await idb(tx.objectStore('bookmarks').put([...retained, bookmark], record.bookId));
        }
        await stage(tx, 'bookmark', record.bookId, bookmark.id, bookmark);
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
        const pendingMetadata = (pending.data as SyncData['book']).metadata || {};
        const metadata = bookMetadata(
          (record.data as SyncData['book']).metadata || {},
          pendingMetadata,
        );
        if (record.entity === 'book') {
          const baseLanguage = (current?.shadow as SyncData['book'] | undefined)?.metadata
            ?.sourceLanguage;
          // Missing fields from older clients are not resets. A reset is the
          // explicit value `auto`, which participates in the same three-way merge.
          const localLanguage = pendingMetadata.sourceLanguage ?? baseLanguage;
          const remoteLanguage =
            (record.data as SyncData['book']).metadata?.sourceLanguage ??
            (record.data as SyncData['book']).content?.sourceLanguage ??
            baseLanguage;
          const sourceLanguage =
            localLanguage !== baseLanguage && remoteLanguage === baseLanguage
              ? localLanguage
              : remoteLanguage;
          if (sourceLanguage !== undefined) metadata.sourceLanguage = sourceLanguage;
        }
        if (
          record.entity === 'book' &&
          pendingMetadata.mediaRevision &&
          pendingMetadata.mediaRevision !==
            (current?.shadow as SyncData['book'] | undefined)?.metadata?.mediaRevision
        )
          metadata.mediaRevision = pendingMetadata.mediaRevision;
        const next =
          record.entity === 'book'
            ? {
                shelfState: cleanShelf(merged),
                metadata,
              }
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
    const incomingBook =
      record.entity === 'book' ? (record.data as SyncData['book'] | undefined) : undefined;
    let nextBook: Book | undefined;
    if (!keepPending) nextBook = await putRemote(tx, record);
    else if (incomingBook && !record.deleted && pending && !pending.deleted) {
      const pendingMetadata = (pending.data as SyncData['book']).metadata || {};
      const metadata = bookMetadata(incomingBook.metadata || {}, pendingMetadata);
      // A normal ACK can arrive after a newer local edit. Preserve its language;
      // on 409 the pending field above already contains the three-way result.
      if (pendingMetadata.sourceLanguage !== undefined)
        metadata.sourceLanguage = pendingMetadata.sourceLanguage;
      nextBook = await putRemote(tx, {
        ...record,
        data: { ...incomingBook, metadata },
      });
    }
    const remoteRevision =
      incomingBook?.metadata?.mediaRevision || incomingBook?.content?.media?.revision;
    // A pull can discover a smaller cloud copy after an offline delete/recreate.
    // Offer the compatible fuller local sidecar once instead of merely recording
    // the difference and permanently suppressing its upload.
    const offerLocalMedia =
      incomingBook?.content &&
      nextBook?.media &&
      incomingBook.content.media?.revision !== nextBook.media.revision &&
      supplementBookMedia(incomingBook.content, nextBook).media?.revision ===
        nextBook.media.revision;
    const remoteReferences =
      incomingBook?.metadata?.references || incomingBook?.content?.references;
    // References are bounded metadata. Offer a compatible fuller local copy after
    // a pull or ACK, without uploading the book text/images or retrying conflicts.
    const offerLocalReferences =
      incomingBook &&
      nextBook?.references &&
      remoteReferences?.revision !== nextBook.references.revision &&
      supplementReferences(remoteReferences, nextBook.references) === nextBook.references;
    const mediaChecked = offerLocalMedia
      ? undefined
      : incomingBook?.content?.media && nextBook?.media && remoteRevision
        ? { localRevision: nextBook.media.revision, remoteRevision }
        : current?.mediaChecked;
    const entry: SyncEntry = {
      key,
      entity: record.entity,
      bookId: record.bookId,
      id: record.id,
      version: record.version,
      deleted: record.deleted,
      shadow: shadowOf(record),
      ...(record.entity === 'book' && !record.deleted && mediaChecked ? { mediaChecked } : {}),
    };
    if (keepPending && pending) entry.pending = { ...pending, baseVersion: record.version };
    else if ((offerLocalMedia || offerLocalReferences) && nextBook && incomingBook) {
      entry.pending = {
        mutationId: crypto.randomUUID(),
        baseVersion: record.version,
        deleted: false,
        data: {
          shelfState: cleanShelf(incomingBook.shelfState),
          metadata: {
            ...bookMetadata(incomingBook.metadata || {}, nextBook),
            ...(offerLocalMedia && nextBook.media
              ? { mediaRevision: nextBook.media.revision }
              : {}),
          },
        },
      };
    }
    await idb(store.put(entry, key));
    applied = !keepPending;
    // Storage and metadata are committed together; these tiny legacy preferences
    // are mirrored before commit so a following local writer sees the new values.
    if (applied) applyLocalStorage(record);
    else if (conflict && pending && (record.entity === 'book' || record.entity === 'preferences')) {
      applyLocalStorage({ ...record, deleted: pending.deleted, data: pending.data });
      applied = true;
    }
    // Book metadata may have changed while a merged/newer shelf mutation remains pending.
    if (nextBook) applied = true;
  });
  if (applied) notifyLocalData();
}
export async function recoveryBackup(): Promise<ReadingBackup> {
  const records = await localTransaction(
    'readonly',
    (tx) => idb(tx.objectStore('sync-recovery').getAll()),
    ['sync-recovery'],
  );
  // This store also contains small array-keyed reading-pack collection intents.
  // Only complete book snapshots are user-exportable synchronization recoveries.
  const entries = records.filter((entry) => entry?.book && Array.isArray(entry.notes));
  return {
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: Date.now(),
    books: entries.map((e) => e.book),
    notes: entries.flatMap((e) => e.notes),
    bookmarks: entries.flatMap((e) => e.bookmarks || []),
    positions: Object.fromEntries(
      entries.filter((e) => e.position).map((e) => [e.book.id, e.position]),
    ),
  };
}

/** Recovery exports keep independent exact versions and their original reference keys. */
export async function recoveryPortableLibrary() {
  const scope = captureLibraryScope();
  const records = await localTransaction(
    'readonly',
    (tx) => idb(tx.objectStore('sync-recovery').getAll()),
    ['sync-recovery'],
  );
  const entries = records.filter((entry) => entry?.book && Array.isArray(entry.notes));
  const backup: ReadingBackup = {
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: Date.now(),
    books: entries.map((e) => e.book),
    notes: entries.flatMap((e) => e.notes),
    bookmarks: entries.flatMap((e) => e.bookmarks || []),
    positions: Object.fromEntries(
      entries.filter((e) => e.position).map((e) => [e.book.id, e.position]),
    ),
  };
  const { portableLibraryFromSnapshot } = await import('./portable-library');
  const result = await portableLibraryFromSnapshot(backup, {
    manifestKeys: entries.flatMap((e) =>
      (e.translationManifests || []).map(
        (_: unknown, index: number) => e.translationManifestKeys?.[index],
      ),
    ),
    manifests: entries.flatMap((e) => e.translationManifests || []),
    chapters: entries.flatMap((e) => e.chapterTranslations || []),
    legacy: entries.map((e) => [e.book.id, e.translations || {}] as const),
    versions: entries.flatMap((e) => e.translationVersions || []),
    selections: entries.flatMap((e) => e.translationSelections || []),
  });
  assertLibraryScope(scope);
  return result;
}
