import { isPdfBook, type Book } from '@bypage/reading-core';
import { openLibraryDatabase } from './database';
import { assertLibraryHandle, deviceLibrary, type LibraryHandle } from './library-scope';
import { getPdfOriginal, retainPdfOriginal, removePdfOriginal, type PdfOriginal } from './pdf';

export type RecoveryAttachmentStatus = 'copied' | 'present' | 'missing' | 'unavailable' | 'not-pdf';
export type RecoveryAttachmentGuard = { signal?: AbortSignal; isCurrent?: () => boolean };
export type PreparedRecoveryAttachments = {
  status: RecoveryAttachmentStatus;
  /** Call only when the device-book transaction did not commit. Safe to repeat. */
  rollback: () => Promise<void>;
};

function check(guard?: RecoveryAttachmentGuard) {
  if (guard?.signal?.aborted || guard?.isCurrent?.() === false)
    throw Object.assign(new Error('library_scope_changed'), { name: 'AbortError' });
}
const noRollback = async () => {};
const result = (status: RecoveryAttachmentStatus): PreparedRecoveryAttachments => ({
  status,
  rollback: noRollback,
});

/**
 * Only original PDF bytes need copying. EPUB media remains embedded in Book.media;
 * its asset/placement identities are unchanged and device render caches rebuild lazily.
 * The caller reserves a fresh device book ID in its recovery ledger before this call.
 */
export async function prepareRecoveryAttachments(
  sourceHandle: LibraryHandle,
  sourceBook: Pick<Book, 'id' | 'sourceFormat'>,
  targetBook: Pick<Book, 'id' | 'sourceFormat'>,
  guard?: RecoveryAttachmentGuard,
): Promise<PreparedRecoveryAttachments> {
  assertLibraryHandle(sourceHandle);
  if (sourceHandle.kind !== 'account') throw new Error('library_sync_account_required');
  check(guard);
  if (!isPdfBook(sourceBook)) return result('not-pdf');
  if (targetBook.id === sourceBook.id || !isPdfBook(targetBook))
    throw new Error('recovery_attachment_identity');
  const sourceIdentity = /^([a-fA-F0-9]{64})\.pdf(?:kit|js)-/.exec(sourceBook.id);
  const targetIdentity = /^([a-fA-F0-9]{64})\.pdf(?:kit|js)-/.exec(targetBook.id);
  // Older externally-created PDFs may have no verifiable original fingerprint.
  // Keep their readable text instead of inventing a hash or trusting an unrelated file.
  if (
    !sourceIdentity ||
    !targetIdentity ||
    sourceIdentity[1].toLowerCase() !== targetIdentity[1].toLowerCase()
  )
    return result('unavailable');

  let created = false;
  const rollback = async () => {
    if (!created) return;
    const db = await openLibraryDatabase(deviceLibrary);
    await db.withExclusiveTransactionAsync(async (tx) => {
      // Hold the write lock through removal: another recovery/import cannot commit
      // the same target between an absence check and deleting its attachment.
      const book = await tx.getFirstAsync('SELECT id FROM books WHERE id = ?', [targetBook.id]);
      if (book) return;
      await removePdfOriginal(deviceLibrary, targetBook.id);
      created = false;
    });
  };
  const retained = async (uri: string) => {
    check(guard);
    // Existing native retain verifies the source SHA-256 against the target ID.
    // Its created=false covers both a valid prior copy and a repaired association.
    const copy = await retainPdfOriginal(deviceLibrary, targetBook.id, uri);
    created = copy.created;
    check(guard);
    return { status: copy.created ? ('copied' as const) : ('present' as const), rollback };
  };

  try {
    let source: PdfOriginal | null = null;
    let sourceUnavailable = false;
    try {
      source = await getPdfOriginal(sourceHandle, sourceBook.id);
    } catch {
      sourceUnavailable = true;
    }
    check(guard);
    if (source) {
      try {
        return await retained(source.uri);
      } catch {
        check(guard);
        // A failed original can still have a verified copy from a prior attempt.
        sourceUnavailable = true;
      }
    }

    let existing: PdfOriginal | null;
    try {
      existing = await getPdfOriginal(deviceLibrary, targetBook.id);
    } catch {
      check(guard);
      return result('unavailable');
    }
    check(guard);
    if (existing) {
      try {
        // Do not equate file existence with a valid association. Retaining the
        // existing file checks its bytes too, and never marks it newly-created.
        return await retained(existing.uri);
      } catch {
        check(guard);
        return result('unavailable');
      }
    }
    return result(sourceUnavailable ? 'unavailable' : 'missing');
  } catch (error) {
    // Cancellation can arrive while native copying is in flight. Wait for that
    // operation, then compensate only our newly-created, uncommitted device file.
    try {
      await rollback();
    } catch {
      // The durable target reservation lets a retry verify/reuse an orphan copy.
      // Never delete a source file or a committed device book to force cleanup.
    }
    throw error;
  }
}
