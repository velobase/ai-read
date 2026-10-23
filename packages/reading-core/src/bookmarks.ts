import type { Book, Bookmark, Position } from './types';
import { validPosition, validSyncId } from './reading-validation';

export const MAX_BOOKMARKS_PER_BOOK = 1000;
export const MAX_BACKUP_BOOKMARKS = 10000;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new Error('Invalid bookmark');
};

/** Validate against the immutable reading text, never a different cached edition. */
export function validateBookmark(book: Book, value: unknown): Bookmark {
  if (
    !object(value) ||
    !validSyncId(value.id) ||
    value.bookId !== book.id ||
    !object(value.position) ||
    !validPosition(book, value.position) ||
    typeof value.quote !== 'string' ||
    value.quote.length > 280 ||
    typeof value.label !== 'string' ||
    value.label.length > 120 ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    value.createdAt > 8640000000000000
  )
    return invalid();
  const p = value.position;
  const textSource = p.textSource || 'original';
  const textOffset = p.textOffset ?? 0;
  const paragraph = book.chapters[p.chapter].paragraphs.find((item) => item.id === p.paragraph)!;
  if (
    (p.offset !== undefined &&
      (typeof p.offset !== 'number' ||
        !Number.isFinite(p.offset) ||
        p.offset < 0 ||
        p.offset > 1)) ||
    (textSource === 'original'
      ? value.translationKey !== undefined || textOffset > paragraph.text.length
      : !validSyncId(value.translationKey))
  )
    return invalid();
  const position: Position = {
    chapter: p.chapter,
    paragraph: p.paragraph,
    farthest: p.farthest,
    ...(p.offset !== undefined ? { offset: p.offset } : {}),
    textSource,
    textOffset,
    ...(p.textQuote !== undefined ? { textQuote: p.textQuote } : {}),
  };
  return {
    id: value.id,
    bookId: book.id,
    position,
    quote: value.quote,
    label: value.label,
    ...(textSource === 'translation' ? { translationKey: value.translationKey as string } : {}),
    createdAt: value.createdAt,
  };
}

/** Book-scoped identity. Progress/fraction and user labels do not create a new location. */
export function bookmarkLocationKey(value: Pick<Bookmark, 'position' | 'translationKey'>): string {
  return JSON.stringify([
    value.position.paragraph,
    value.position.textSource || 'original',
    value.position.textOffset ?? 0,
    value.translationKey || '',
  ]);
}
