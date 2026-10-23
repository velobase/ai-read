import { validateBook } from './reading-backup';
import { bookMetadata, sameData, type BookMetadata } from './sync-types';
import type { Book } from './types';
import { isBookSourceLanguage } from '../../packages/reading-core/src/reading-language';
import {
  supplementReferences,
  validateBookReferences,
} from '../../packages/reading-core/src/book-references';

/** Supplement navigation and apply an explicit language override without rebuilding chapters. */
export function supplementBookMetadata(book: Book, value: unknown): Book {
  if (value === undefined) return book;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-sync-data');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        !['toc', 'sourceFormat', 'sourceLanguage', 'mediaRevision', 'references'].includes(key),
    ) ||
    (input.sourceFormat !== undefined &&
      !['epub', 'txt', 'pdf'].includes(input.sourceFormat as string)) ||
    (input.sourceLanguage !== undefined && !isBookSourceLanguage(input.sourceLanguage)) ||
    (input.mediaRevision !== undefined &&
      (typeof input.mediaRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.mediaRevision)))
  )
    throw new Error('invalid-sync-data');
  // Never spread untrusted metadata onto the book: no chapter, title or content patch exists.
  const toc =
    input.toc === undefined || sameData(input.toc, book.toc)
      ? book.toc
      : validateBook({ ...book, media: undefined, references: undefined, toc: input.toc }).toc;
  const { toc: nextToc, sourceFormat } = bookMetadata(book, {
    toc,
    sourceFormat: input.sourceFormat as BookMetadata['sourceFormat'],
  });
  // `auto` is an explicit reset to the file's language; omission supports older clients.
  const sourceLanguage =
    input.sourceLanguage === undefined ? book.sourceLanguage : (input.sourceLanguage as string);
  const references =
    input.references === undefined || sameData(input.references, book.references)
      ? book.references
      : supplementReferences(
          book.references,
          validateBookReferences(input.references, book.chapters),
        );
  // A revision announces content to fetch; it is never an image sidecar itself.
  // Do not let metadata-only ACKs manufacture a Book.media or persist a fake revision.
  return sameData(book.toc, nextToc) &&
    book.sourceFormat === sourceFormat &&
    book.sourceLanguage === sourceLanguage &&
    book.references === references
    ? book
    : {
        ...book,
        ...(nextToc?.length ? { toc: nextToc } : {}),
        ...(sourceFormat ? { sourceFormat } : {}),
        ...(sourceLanguage !== undefined ? { sourceLanguage } : {}),
        ...(references ? { references } : {}),
      };
}
