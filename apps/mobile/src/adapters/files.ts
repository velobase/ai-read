import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { strFromU8 } from 'fflate';
import {
  bookFromText,
  parseEpub,
  validateBook,
  validatePortableLibrary,
  type Book,
  type PortableLibrary,
} from '@bypage/reading-core';
import { addBook, importLibrary, exportLibrary } from './database';
import { measured, diagnosticSnapshot } from './diagnostics';
import { createLibraryLease, deviceLibrary, type LibraryLease } from './library-scope';
import { accountRevision } from './account';
import {
  restoreLibraryRecoveryArchive,
  validateLibraryRecoveryArchive,
  type ValidatedLibraryRecoveryArchive,
  type RecoveryRestoreResult,
} from './library-recovery-restore';

const MAX_FILE = 30 * 1024 * 1024;
const MAX_BACKUP = 50 * 1024 * 1024;
export type PendingImport = { readonly library: LibraryLease } & (
  | { kind: 'book'; book: Book }
  | { kind: 'library'; pack: PortableLibrary }
  | { kind: 'recovery'; archive: ValidatedLibraryRecoveryArchive }
);
export type ImportLabels = {
  unknown: string;
  chapter: (n: number) => string;
};
export type PreparedPdfImport = {
  kind: 'pdf';
  readonly library: LibraryLease;
  uri: string;
  name: string;
};
export type PreparedImport = PendingImport | PreparedPdfImport;

/**
 * Parse a caller-owned local file without changing the library or removing its source.
 * PDF previews own a separate cache copy; PdfImportSheet releases it on completion.
 */
export async function prepareImport(
  lease: LibraryLease,
  source: { uri: string; name: string },
  labels: ImportLabels,
): Promise<PreparedImport> {
  lease.assertCurrent();
  const file = new File(source.uri);
  const limit = /\.json$/i.test(source.name) ? MAX_BACKUP : MAX_FILE;
  if (!file.exists || file.size > limit || !/\.(epub|txt|json|pdf)$/i.test(source.name))
    throw new Error('Unsupported file');
  if (/\.pdf$/i.test(source.name)) {
    const size = file.size;
    const preview = new File(Paths.cache, `bypage-prepare-${Crypto.randomUUID()}.pdf`);
    // Never replace an existing cache file, even if a generated name collides.
    if (preview.exists) throw new Error('PDF preview already exists');
    try {
      await file.copy(preview);
      lease.assertCurrent();
      if (!preview.exists || preview.size !== size || preview.size > MAX_FILE)
        throw new Error('Incomplete PDF preview');
      return { kind: 'pdf', library: lease, uri: preview.uri, name: source.name };
    } catch (error) {
      try {
        if (preview.exists) preview.delete();
      } catch {
        /* The OS can clear our temporary copy later. The caller still owns the source. */
      }
      throw error;
    }
  }
  if (/\.json$/i.test(source.name)) {
    const body = await file.text();
    lease.assertCurrent();
    const raw: unknown = JSON.parse(body);
    if (
      raw &&
      typeof raw === 'object' &&
      'format' in raw &&
      raw.format === 'bypage-library-recovery'
    )
      return { kind: 'recovery', library: lease, archive: validateLibraryRecoveryArchive(raw) };
    return { kind: 'library', library: lease, pack: validatePortableLibrary(raw) };
  }
  const bytes = await file.bytes();
  lease.assertCurrent();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  lease.assertCurrent();
  const id = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const book = /\.txt$/i.test(source.name)
    ? bookFromText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
        id,
        title: source.name.replace(/\.txt$/i, ''),
        author: labels.unknown,
        section: labels.chapter,
      })
    : await parseEpub(bytes, id, source.name, labels.chapter, labels.unknown);
  lease.assertCurrent();
  return { kind: 'book', library: lease, book };
}

/** Reading is staged before any library mutation, allowing an explicit import preview. */
export async function chooseImport(
  lease: LibraryLease,
  labels: ImportLabels,
): Promise<PreparedImport | null> {
  lease.assertCurrent();
  const selection = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'application/epub+zip',
      'text/plain',
      'application/json',
      'public.data',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (selection.canceled) {
    lease.assertCurrent();
    return null;
  }
  const asset = selection.assets[0];
  const file = new File(asset.uri);
  try {
    lease.assertCurrent();
    return await prepareImport(lease, { uri: file.uri, name: asset.name }, labels);
  } finally {
    // Only remove the picker-created cache copy; never the user's original document.
    if (file.uri.startsWith(Paths.cache.uri)) {
      try {
        file.delete();
      } catch {
        /* OS can clear cache. */
      }
    }
  }
}
export async function confirmImport(
  lease: LibraryLease,
  pending: PendingImport,
): Promise<{ count: number; recovery?: RecoveryRestoreResult }> {
  return measured('book.import', async () => {
    lease.assertCurrent();
    if (pending.library !== lease) throw new Error('library_scope_mismatch');
    if (pending.kind === 'recovery') {
      // The preview explicitly names the device destination. Its lifetime is still
      // fenced by the screen that initiated the import, including account changes.
      const revision = accountRevision();
      const destination = createLibraryLease(
        deviceLibrary,
        lease.epoch,
        lease.signal,
        () => lease.isCurrent() && revision === accountRevision(),
      );
      const recovery = await restoreLibraryRecoveryArchive(destination, pending.archive);
      destination.assertCurrent();
      return { count: 1, recovery };
    }
    if (pending.kind === 'book') {
      await addBook(lease.handle, pending.book);
      lease.assertCurrent();
      return { count: 1 };
    }
    const count = await importLibrary(lease.handle, pending.pack);
    lease.assertCurrent();
    return { count };
  });
}
async function shareJSON(value: unknown, name: string, lease?: LibraryLease) {
  lease?.assertCurrent();
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable');
  lease?.assertCurrent();
  const file = new File(Paths.cache, `${name}-${Crypto.randomUUID()}.json`);
  try {
    file.create();
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).byteLength > MAX_BACKUP) throw new Error('Export too large');
    file.write(body);
    lease?.assertCurrent();
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'LeafRead',
    });
    lease?.assertCurrent();
  } finally {
    if (file.exists) file.delete();
  }
}
export const shareLibrary = (lease: LibraryLease, bookId?: string) =>
  measured('backup.export', async () => {
    lease.assertCurrent();
    const pack = await exportLibrary(lease.handle, bookId);
    lease.assertCurrent();
    await shareJSON(pack, 'LeafRead-reading-pack', lease);
  });
export const shareDiagnostics = () => shareJSON(diagnosticSnapshot(), 'LeafRead-diagnostics');
