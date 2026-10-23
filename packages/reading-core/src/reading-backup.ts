import type { Book, Bookmark, Note, Position } from './types';
import { MAX_BOOK_TEXT, validNoteAnchor, validPosition, validSyncId } from './reading-validation';
import { MAX_BACKUP_MEDIA_BYTES, validateBookMedia, utf8 } from './book-media';
import { MAX_BACKUP_REFERENCES_BYTES, validateBookReferences } from './book-references';
import { isBookSourceLanguage } from './reading-language';
import { MAX_BACKUP_BOOKMARKS, MAX_BOOKMARKS_PER_BOOK, validateBookmark } from './bookmarks';

export type ReadingBackup = {
  format: 'ai-read-books-and-notes';
  version: 1;
  exportedAt: number;
  books: Book[];
  notes: Note[];
  bookmarks?: Bookmark[];
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
    (raw.bookmarks !== undefined &&
      (!Array.isArray(raw.bookmarks) || raw.bookmarks.length > MAX_BACKUP_BOOKMARKS)) ||
    !object(raw.positions)
  )
    return invalid();
  const ids = new Set<string>();
  let mediaBytes = 0;
  let referenceBytes = 0;
  const books = raw.books.map((b): Book => {
    if (
      !object(b) ||
      !safeId(b.id) ||
      !b.id ||
      ids.has(b.id as string) ||
      !str(b.title, 2000) ||
      !str(b.author, 2000) ||
      !str(b.language, 30) ||
      (b.sourceLanguage !== undefined && !isBookSourceLanguage(b.sourceLanguage)) ||
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
        ...(Number.isSafeInteger(c.sourcePage) &&
        (c.sourcePage as number) > 0 &&
        (c.sourcePage as number) <= 1000
          ? { sourcePage: c.sourcePage as number }
          : {}),
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
    let toc: Book['toc'];
    if (b.toc !== undefined) {
      if (!Array.isArray(b.toc) || b.toc.length > 2000) return invalid();
      const references = new Map(
        chapters.map((chapter) => [
          chapter.id,
          new Set(chapter.paragraphs.map((paragraph) => paragraph.id)),
        ]),
      );
      if (references.size !== chapters.length) return invalid();
      toc = b.toc.map((entry) => {
        if (
          !object(entry) ||
          !str(entry.title, 2000) ||
          !(entry.title as string).trim() ||
          !str(entry.chapterId, 200) ||
          !str(entry.paragraphId, 200) ||
          !references.get(entry.chapterId as string)?.has(entry.paragraphId as string) ||
          !Number.isInteger(entry.depth) ||
          (entry.depth as number) < 0 ||
          (entry.depth as number) > 8
        )
          return invalid();
        return {
          title: entry.title as string,
          chapterId: entry.chapterId as string,
          paragraphId: entry.paragraphId as string,
          depth: entry.depth as number,
        };
      });
    }
    const media =
      b.media === undefined
        ? undefined
        : validateBookMedia(b.media, chapters, MAX_BACKUP_MEDIA_BYTES - mediaBytes);
    if (media) mediaBytes += media.assets.reduce((total, asset) => total + asset.byteLength, 0);
    const references =
      b.references === undefined
        ? undefined
        : validateBookReferences(
            b.references,
            chapters,
            MAX_BACKUP_REFERENCES_BYTES - referenceBytes,
          );
    if (references) referenceBytes += utf8(JSON.stringify(references)).length;
    return {
      id: b.id as string,
      title: b.title as string,
      author: b.author as string,
      language: b.language as string,
      ...(b.sourceLanguage !== undefined ? { sourceLanguage: b.sourceLanguage as string } : {}),
      importedAt: b.importedAt as number,
      ...(['epub', 'txt', 'pdf'].includes(b.sourceFormat as string)
        ? { sourceFormat: b.sourceFormat as Book['sourceFormat'] }
        : {}),
      ...(Number.isSafeInteger(b.sourcePages) &&
      (b.sourcePages as number) > 0 &&
      (b.sourcePages as number) <= 1000
        ? { sourcePages: b.sourcePages as number }
        : {}),
      chapters,
      ...(toc ? { toc } : {}),
      ...(media ? { media } : {}),
      ...(references ? { references } : {}),
      ...(b.pageDirection === 'rtl' || b.pageDirection === 'ltr'
        ? { pageDirection: b.pageDirection }
        : {}),
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
      ...(Number.isSafeInteger(p.textOffset) && (p.textOffset as number) >= 0
        ? { textOffset: p.textOffset as number }
        : {}),
      ...(p.textSource === 'original' || p.textSource === 'translation'
        ? { textSource: p.textSource }
        : {}),
      ...(typeof p.textQuote === 'string' ? { textQuote: p.textQuote.slice(0, 64) } : {}),
    };
  }
  const bookmarkIds = new Map<string, Set<string>>();
  const bookmarks = (raw.bookmarks as unknown[] | undefined)?.map((value) => {
    const book = object(value) ? bookMap.get(value.bookId as string) : undefined;
    if (!book) return invalid();
    const bookmark = validateBookmark(book, value);
    const ids = bookmarkIds.get(book.id) || new Set<string>();
    if (ids.has(bookmark.id) || ids.size >= MAX_BOOKMARKS_PER_BOOK) return invalid();
    ids.add(bookmark.id);
    bookmarkIds.set(book.id, ids);
    return bookmark;
  });
  return {
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: number(raw.exportedAt) ? (raw.exportedAt as number) : 0,
    books,
    notes,
    ...(bookmarks !== undefined ? { bookmarks } : {}),
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
