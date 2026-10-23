import { isPdfBook } from '../../../packages/reading-core/src/pdf-toc';
import type { Book } from '@/lib/types';
import { idb, localTransaction, readLocal } from '@/lib/local-database';
import { PDF_LIMITS } from '../../../packages/reading-core/src/pdf-document';

export type PdfOriginal = { file: Blob; savedAt: number };

/** A source must match the digest used to create paragraph identities. */
export async function preparePdfOriginal(book: Book, file: Blob): Promise<PdfOriginal> {
  if (!isPdfBook(book) || !/^[a-f0-9]{64}\./.test(book.id))
    throw new Error('PDF_SOURCE_UNSUPPORTED');
  if (!file.size || file.size > PDF_LIMITS.bytes) throw new Error('PDF_FILE_LIMIT');
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== book.id.split('.')[0]) throw new Error('PDF_SOURCE_MISMATCH');
  // Store neither file-system names nor passwords; encrypted PDFs remain encrypted.
  return { file: new Blob([bytes], { type: 'application/pdf' }), savedAt: Date.now() };
}

export const readPdfOriginal = (bookId: string) => readLocal<PdfOriginal>('pdf-originals', bookId);

export async function attachPdfOriginal(book: Book, file: Blob) {
  const source = await preparePdfOriginal(book, file);
  await localTransaction(
    'readwrite',
    async (tx) => {
      if (!(await idb(tx.objectStore('books').getKey(book.id))))
        throw new Error('PDF_SOURCE_BOOK_MISSING');
      await idb(tx.objectStore('pdf-originals').put(source, book.id));
    },
    ['books', 'pdf-originals'],
  );
  return source;
}
