import type { Book, Note, Position } from './types';
import { MAX_BOOK_TEXT, validNoteAnchor, validPosition, validSyncId } from './reading-validation';

export type ReadingBackup = {
  format: 'ai-read-books-and-notes';
  version: 1;
  exportedAt: number;
  books: Book[];
  notes: Note[];
  positions: Record<string, Position | undefined>;
};
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const safeId = (value: unknown) =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
const invalid = () => {
  throw new Error('备份格式不正确，未修改本地数据。');
};

export function validateBackup(raw: unknown): ReadingBackup {
  if (
    !object(raw) ||
    raw.format !== 'ai-read-books-and-notes' ||
    raw.version !== 1 ||
    !Array.isArray(raw.books) ||
    raw.books.length > 1000 ||
    !Array.isArray(raw.notes) ||
    raw.notes.length > 100000 ||
    !object(raw.positions)
  )
    return invalid();
  const ids = new Set<string>();
  const books = raw.books.map((b): Book => {
    if (
      !object(b) ||
      !safeId(b.id) ||
      !b.id ||
      ids.has(b.id as string) ||
      !str(b.title, 2000) ||
      !str(b.author, 2000) ||
      !str(b.language, 30) ||
      !number(b.importedAt) ||
      !Array.isArray(b.chapters) ||
      !b.chapters.length ||
      b.chapters.length > 10000
    )
      return invalid();
    ids.add(b.id as string);
    const paragraphIds = new Set<string>();
    let textLength = 0;
    const chapters = b.chapters.map((c) => {
      if (
        !object(c) ||
        !str(c.id, 200) ||
        !str(c.title, 4000) ||
        !Array.isArray(c.paragraphs) ||
        !c.paragraphs.length
      )
        return invalid();
      return {
        id: c.id as string,
        title: c.title as string,
        paragraphs: c.paragraphs.map((p) => {
          if (
            !object(p) ||
            !str(p.id, 200) ||
            !p.id ||
            paragraphIds.has(p.id as string) ||
            !str(p.text, 20000) ||
            !['text', 'heading', 'quote', 'code'].includes(p.kind as string)
          )
            return invalid();
          paragraphIds.add(p.id as string);
          textLength += (p.text as string).length;
          if (textLength > MAX_BOOK_TEXT) throw new Error('书籍正文过长，请选择较小的文件。');
          return {
            id: p.id as string,
            text: p.text as string,
            kind: p.kind as 'text' | 'heading' | 'quote' | 'code',
          };
        }),
      };
    });
    return {
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      language: b.language as string,
      importedAt: b.importedAt as number,
      chapters,
      sample: b.sample === true,
      description: str(b.description, 20000) ? (b.description as string) : undefined,
      subtitle: str(b.subtitle, 1000) ? (b.subtitle as string) : undefined,
      category: str(b.category, 200) ? (b.category as string) : undefined,
      cover:
        str(b.cover, 3 * 1024 * 1024) &&
        /^data:image\/(png|jpeg|webp);base64,/.test(b.cover as string)
          ? (b.cover as string)
          : undefined,
    };
  });
  const bookMap = new Map(books.map((b) => [b.id, b]));
  const paragraphsByBook = new Map(
    books.map((b) => [
      b.id,
      new Map(b.chapters.flatMap((c) => c.paragraphs.map((p) => [p.id, p] as const))),
    ]),
  );
  const noteIds = new Set<string>();
  const notes = raw.notes.map((n): Note => {
    const paragraph = object(n)
      ? paragraphsByBook.get(n.bookId as string)?.get(n.paragraphId as string)
      : undefined;
    const key = object(n) ? JSON.stringify([n.bookId, n.id]) : '';
    if (
      !object(n) ||
      !validSyncId(n.id) ||
      noteIds.has(key) ||
      !ids.has(n.bookId as string) ||
      !str(n.paragraphId, 200) ||
      !str(n.quote, 20000) ||
      !str(n.text, 50000) ||
      !number(n.createdAt) ||
      (n.createdAt as number) > 8640000000000000 ||
      !paragraph ||
      !validNoteAnchor(n.anchor, n.quote as string, paragraph.text)
    )
      return invalid();
    noteIds.add(key);
    return {
      id: n.id as string,
      bookId: n.bookId as string,
      paragraphId: n.paragraphId as string,
      quote: n.quote as string,
      ...(n.anchor ? { anchor: n.anchor as Note['anchor'] } : {}),
      text: n.text as string,
      createdAt: n.createdAt as number,
    };
  });
  const positions: Record<string, Position> = {};
  for (const [id, p] of Object.entries(raw.positions)) {
    const book = bookMap.get(id);
    if (!book || !object(p) || !validPosition(book, p)) return invalid();
    positions[id] = {
      chapter: p.chapter as number,
      farthest: p.farthest as number,
      paragraph: p.paragraph as string,
      ...(typeof p.offset === 'number' && Number.isFinite(p.offset)
        ? { offset: Math.max(0, Math.min(1, p.offset)) }
        : {}),
    };
  }
  return {
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: number(raw.exportedAt) ? (raw.exportedAt as number) : 0,
    books,
    notes,
    positions,
  };
}

export function validateBook(book: unknown): Book {
  return validateBackup({
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: Date.now(),
    books: [book],
    notes: [],
    positions: {},
  }).books[0];
}
