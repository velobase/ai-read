import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  bookmarkLocationKey,
  readingProgress,
  sha256,
  utf8,
  validSyncId,
  type Book,
} from '@bypage/reading-core';
import { openLibraryDatabase } from './database';
import {
  ensureCollectionSchema,
  mergePortableCollections,
  notifyCollections,
} from './collections-storage';
import { deviceLibrary, type LibraryLease } from './library-scope';
import { readLibraryRecovery } from './library-sync-storage';
import {
  recoveryArchiveData,
  validateLibraryRecoveryArchive,
  type RecoveryCounts,
  type ValidatedLibraryRecoveryArchive,
} from './library-recovery-archive';
import { prepareRecoveryAttachments } from './recovery-attachments';
import { translationDraftScopeKey } from './translation-draft-archive';
import {
  ensureTranslationStore,
  ensureBookTranslationMigration,
  importTranslationVersions,
} from './translation-store';

export { validateLibraryRecoveryArchive } from './library-recovery-archive';
export type { RecoveryCounts, ValidatedLibraryRecoveryArchive } from './library-recovery-archive';
export type RecoveryRestoreGuard = { signal?: AbortSignal; isCurrent?: () => boolean };
export type RecoveryRestoreResult = RecoveryCounts & {
  bookId: string;
  title: string;
  alreadyRestored: boolean;
  pdfOriginal: 'copied' | 'present' | 'missing' | 'unavailable' | 'not-pdf';
};
type Marker = {
  restore_key: string;
  target_book_id: string;
  created_at: number;
  completed: number;
  result: string | null;
};
const restoring = new Set<string>();
const schemas = new WeakMap<SQLiteDatabase, Promise<void>>();
function check(lease: LibraryLease, guard?: RecoveryRestoreGuard) {
  lease.assertCurrent();
  if (guard?.signal?.aborted || guard?.isCurrent?.() === false)
    throw Object.assign(new Error('library_scope_changed'), { name: 'AbortError' });
}
async function ensureSchema(db: SQLiteDatabase) {
  let ready = schemas.get(db);
  if (!ready) {
    ready = db.execAsync(`CREATE TABLE IF NOT EXISTS library_recovery_restores (
      restore_key TEXT PRIMARY KEY, source_key TEXT NOT NULL, recovery_id TEXT NOT NULL,
      archive_digest TEXT NOT NULL, target_book_id TEXT NOT NULL UNIQUE,
      created_at REAL NOT NULL, completed INTEGER NOT NULL DEFAULT 0, result TEXT
    );`);
    schemas.set(db, ready);
    void ready.catch(() => {
      if (schemas.get(db) === ready) schemas.delete(db);
    });
  }
  await ready;
}
function freshBookId(source: Book): string {
  const pdf = /^([a-fA-F0-9]{64})\.(pdfkit|pdfjs)-/.exec(source.id);
  return pdf
    ? `${pdf[1]}.${pdf[2]}-recovery-${Crypto.randomUUID()}`
    : `recovery-${Crypto.randomUUID()}`;
}
async function reserve(
  db: SQLiteDatabase,
  archive: ValidatedLibraryRecoveryArchive,
  key: string,
  current: () => void,
): Promise<Marker> {
  let marker!: Marker;
  await db.withExclusiveTransactionAsync(async (tx) => {
    current();
    const existing = await tx.getFirstAsync<Marker>(
      'SELECT restore_key,target_book_id,created_at,completed,result FROM library_recovery_restores WHERE restore_key = ?',
      [key],
    );
    current();
    if (existing) {
      marker = existing;
      return;
    }
    const bookId = freshBookId(recoveryArchiveData(archive).book);
    if (await tx.getFirstAsync('SELECT id FROM books WHERE id = ?', [bookId]))
      throw new Error('library_recovery_conflict');
    marker = {
      restore_key: key,
      target_book_id: bookId,
      created_at: Date.now(),
      completed: 0,
      result: null,
    };
    await tx.runAsync(
      'INSERT INTO library_recovery_restores(restore_key,source_key,recovery_id,archive_digest,target_book_id,created_at) VALUES (?,?,?,?,?,?)',
      [key, archive.libraryKey, archive.id, archive.digest, bookId, marker.created_at],
    );
    current();
  });
  return marker;
}
async function restore(
  lease: LibraryLease,
  archive: ValidatedLibraryRecoveryArchive,
  guard: RecoveryRestoreGuard | undefined,
  source: LibraryLease | undefined,
): Promise<RecoveryRestoreResult> {
  const current = () => {
    check(lease, guard);
    if (source) check(source, guard);
  };
  current();
  const data = recoveryArchiveData(archive);
  const key = sha256(utf8(JSON.stringify([archive.libraryKey, archive.id, archive.digest])));
  if (restoring.has(key)) throw new Error('library_recovery_busy');
  restoring.add(key);
  try {
    const db = await openLibraryDatabase(deviceLibrary);
    current();
    await ensureSchema(db);
    await ensureCollectionSchema(db);
    await ensureTranslationStore(db);
    current();
    const marker = await reserve(db, archive, key, current);
    current();
    if (marker.completed) {
      // Deleting a restored copy is an intentional device action, not a request to recreate it.
      const exists = await db.getFirstAsync('SELECT id FROM books WHERE id = ?', [
        marker.target_book_id,
      ]);
      current();
      if (!exists) throw new Error('library_recovery_copy_removed');
      if (!marker.result) throw new Error('library_recovery_invalid');
      return { ...(JSON.parse(marker.result) as RecoveryRestoreResult), alreadyRestored: true };
    }
    const book: Book = {
      ...data.book,
      id: marker.target_book_id,
      importedAt: marker.created_at,
      ...(archive.hasPdf ? { sourceFormat: 'pdf' as const } : {}),
    };
    const attachments = source
      ? await prepareRecoveryAttachments(source.handle, data.book, book, {
          signal: guard?.signal || source.signal,
          isCurrent: () => {
            try {
              current();
              return true;
            } catch {
              return false;
            }
          },
        })
      : {
          status: archive.hasPdf ? ('missing' as const) : ('not-pdf' as const),
          rollback: async () => {},
        };
    let committed = false;
    try {
      current();
      const result: RecoveryRestoreResult = {
        bookId: book.id,
        title: book.title,
        alreadyRestored: false,
        pdfOriginal: attachments.status,
        ...archive.counts,
      };
      let operations = 0;
      const checkpoint = async () => {
        current();
        if (++operations % 32 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          current();
        }
      };
      await db.withExclusiveTransactionAsync(async (tx) => {
        current();
        const reserved = await tx.getFirstAsync<Marker>(
          'SELECT restore_key,target_book_id,created_at,completed,result FROM library_recovery_restores WHERE restore_key = ?',
          [key],
        );
        current();
        if (!reserved || reserved.target_book_id !== book.id || reserved.completed)
          throw new Error('library_recovery_conflict');
        if (await tx.getFirstAsync('SELECT id FROM books WHERE id = ?', [book.id]))
          throw new Error('library_recovery_conflict');
        await tx.runAsync(
          'INSERT INTO books(id,title,author,language,sample,chapters,body,imported_at,last_opened,finished,progress) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [
            book.id,
            book.title,
            book.author,
            book.language,
            book.sample ? 1 : 0,
            book.chapters.length,
            JSON.stringify(book),
            book.importedAt,
            data.lastOpened,
            data.finished ? 1 : 0,
            data.position ? readingProgress(book.chapters, data.position) : 0,
          ],
        );
        await checkpoint();
        if (data.position)
          await tx.runAsync('INSERT INTO positions(book_id,body) VALUES (?,?)', [
            book.id,
            JSON.stringify(data.position),
          ]);
        for (const original of data.notes) {
          const note = { ...original, bookId: book.id };
          await tx.runAsync('INSERT INTO notes(id,book_id,body,created_at) VALUES (?,?,?,?)', [
            note.id,
            book.id,
            JSON.stringify(note),
            note.createdAt,
          ]);
          await checkpoint();
        }
        for (const original of data.bookmarks) {
          const bookmark = { ...original, bookId: book.id };
          await tx.runAsync(
            'INSERT INTO bookmarks(id,book_id,location,body,created_at) VALUES (?,?,?,?,?)',
            [
              bookmark.id,
              book.id,
              bookmarkLocationKey(bookmark),
              JSON.stringify(bookmark),
              bookmark.createdAt,
            ],
          );
          await checkpoint();
        }
        for (const translation of data.translations) {
          await tx.runAsync('INSERT INTO translations(book_id,language,body) VALUES (?,?,?)', [
            book.id,
            translation.language,
            JSON.stringify(translation.paragraphs),
          ]);
          await checkpoint();
        }
        // The old language map is genuine legacy data, never a selected-version
        // projection. Preserve every exact key and only change its owning book ID.
        for (let index = 0; index < data.translationVersions.length; index += 32) {
          current();
          await importTranslationVersions(
            tx,
            book,
            data.translationVersions
              .slice(index, index + 32)
              .map((version) => ({ ...version, bookId: book.id })),
            [],
          );
          await checkpoint();
        }
        // Every selection can resolve any version, so all versions are inserted first.
        for (let index = 0; index < data.translationSelections.length; index += 32) {
          current();
          await importTranslationVersions(
            tx,
            book,
            [],
            data.translationSelections
              .slice(index, index + 32)
              .map((selection) => ({ ...selection, bookId: book.id })),
          );
          await checkpoint();
        }
        // Fresh restore: archival choices win; migration fills only absent legacy choices.
        await ensureBookTranslationMigration(tx, book);
        await checkpoint();
        for (const original of data.history) {
          const turn = { ...original, bookId: book.id };
          await tx.runAsync(
            'INSERT INTO assistant_history(id,book_id,body,created_at) VALUES (?,?,?,?)',
            [turn.id, book.id, JSON.stringify(turn), turn.createdAt],
          );
          await checkpoint();
        }
        for (const original of data.drafts) {
          const draft = { ...original, bookId: book.id };
          await tx.runAsync(
            'INSERT INTO translation_drafts(book_id,scope_key,paragraph_id,body,updated_at) VALUES (?,?,?,?,?)',
            [
              book.id,
              translationDraftScopeKey(draft.scope),
              draft.paragraphId,
              JSON.stringify(draft),
              draft.updatedAt,
            ],
          );
          await checkpoint();
        }
        await mergePortableCollections(
          tx,
          data.collections.map((group) => ({ name: group.name, bookIds: [book.id] })),
        );
        current();
        await tx.runAsync(
          'UPDATE library_recovery_restores SET completed = 1,result = ? WHERE restore_key = ?',
          [JSON.stringify(result), key],
        );
        current();
      });
      committed = true;
      notifyCollections(deviceLibrary);
      // Once committed, cancellation must not masquerade as an uncommitted restore.
      // The caller still fences its UI; a retry finds this exact completed marker.
      return result;
    } finally {
      if (!committed) await attachments.rollback();
    }
  } finally {
    restoring.delete(key);
  }
}

/** Explicit account recovery into an independent device copy. The source archive stays intact. */
export async function restoreLibraryRecovery(
  sourceLease: LibraryLease,
  recoveryId: string,
  guard?: RecoveryRestoreGuard,
): Promise<RecoveryRestoreResult> {
  check(sourceLease, guard);
  if (sourceLease.handle.kind !== 'account' || !validSyncId(recoveryId))
    throw new Error('library_recovery_invalid');
  const raw = await readLibraryRecovery(sourceLease.handle, recoveryId);
  check(sourceLease, guard);
  if (!raw) throw new Error('library_recovery_missing');
  const archive = validateLibraryRecoveryArchive(raw);
  check(sourceLease, guard);
  return restore(sourceLease, archive, guard, sourceLease);
}

/** Imported archives are data only: they never open the named account or access its files. */
export async function restoreLibraryRecoveryArchive(
  destinationLease: LibraryLease,
  archive: ValidatedLibraryRecoveryArchive,
  guard?: RecoveryRestoreGuard,
): Promise<RecoveryRestoreResult> {
  check(destinationLease, guard);
  if (destinationLease.handle.kind !== 'device')
    throw new Error('library_recovery_device_required');
  return restore(destinationLease, archive, guard, undefined);
}
