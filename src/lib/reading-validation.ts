import type { Book, NoteAnchor, Position } from './types';

export const MAX_BOOK_TEXT = 20 * 1024 * 1024;
export const validSyncId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[\w.:-]{1,200}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

export function validPosition(book: Book, value: unknown): value is Position {
  if (!value || typeof value !== 'object') return false;
  const p = value as Position;
  return (
    Number.isInteger(p.chapter) &&
    p.chapter >= 0 &&
    p.chapter < book.chapters.length &&
    Number.isInteger(p.farthest) &&
    p.farthest >= p.chapter &&
    p.farthest < book.chapters.length &&
    book.chapters[p.chapter].paragraphs.some((paragraph) => paragraph.id === p.paragraph)
  );
}

export function validNoteAnchor(value: unknown, quote: unknown, original: string): boolean {
  if (value == null) return true; // Older notes have no location metadata.
  if (typeof value !== 'object' || Array.isArray(value) || typeof quote !== 'string') return false;
  const anchor = value as NoteAnchor;
  if (
    !Number.isSafeInteger(anchor.start) ||
    !Number.isSafeInteger(anchor.end) ||
    anchor.start < 0 ||
    anchor.end <= anchor.start ||
    anchor.end > 1024 * 1024 ||
    anchor.end - anchor.start !== quote.length
  )
    return false;
  if (anchor.source === 'original') return original.slice(anchor.start, anchor.end) === quote;
  return anchor.source === 'translation' && validSyncId(anchor.translationKey);
}
