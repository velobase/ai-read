import { validateBook } from './reading-backup';
import { sha256 } from './book-media';
export type StoreBook = {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  language: string;
  category: string;
  sourceUrl: string;
  cover?: string;
  editionId: string;
  chapterCount: number;
  characterCount: number;
  byteLength: number;
  sha256: string;
  collectionIds: string[];
};
export type StoreCollection = {
  id: string;
  title: string;
  description: string;
  items: { bookId: string }[];
};
export type StoreCatalog = { books: StoreBook[]; collections: StoreCollection[] };
export async function downloadStoreBook(
  entry: StoreBook,
  response: Response,
  onProgress?: (fraction: number) => void,
) {
  if (!response.ok) throw new Error('Book download failed. Refresh the bookstore and try again.');
  const max = 50 * 1024 * 1024;
  if (entry.byteLength < 1 || entry.byteLength > max)
    throw new Error('Book exceeds the download limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Download response is empty');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > entry.byteLength || size > max) throw new Error('Unexpected download size');
      chunks.push(value);
      onProgress?.(size / entry.byteLength);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (size !== entry.byteLength || sha256(bytes) !== entry.sha256)
    throw new Error('The download is incomplete. Please try again.');
  const book = validateBook(JSON.parse(new TextDecoder().decode(bytes)));
  if (book.id !== entry.editionId) throw new Error('Unexpected book edition');
  return { ...book, importedAt: Date.now() };
}
