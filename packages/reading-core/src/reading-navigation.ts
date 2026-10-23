import type { Book, Position } from './types';
import { isPdfBook } from './pdf-toc';
import { pdfChapterStructure, readingScopeParagraphs } from './reading-scope';

export type ReadingChapterTarget = {
  title: string;
  chapterIndex: number;
  paragraphId: string;
  kind: 'chapter' | 'page';
  sourcePage?: number;
};
export type ReadingChapterNavigation = {
  current?: ReadingChapterTarget;
  previous?: ReadingChapterTarget;
  next?: ReadingChapterTarget;
};

type NavigationPoint = { ordinal: number; target: ReadingChapterTarget };
type NavigationIndex = {
  chapters: Book['chapters'];
  toc: Book['toc'];
  sourceFormat: Book['sourceFormat'];
  id: string;
  physical: (ReadingChapterTarget | undefined)[];
  locations: Map<string, { chapterIndex: number; ordinal: number }>;
  logical: NavigationPoint[] | null;
};
// Books and their chapter text are immutable. Supplemented navigation replaces
// the Book/toc reference. Repeated scroll anchors only perform map/binary lookups.
const indexes = new WeakMap<Book, NavigationIndex>();

function navigationIndex(book: Book): NavigationIndex {
  const cached = indexes.get(book);
  if (
    cached?.chapters === book.chapters &&
    cached.toc === book.toc &&
    cached.sourceFormat === book.sourceFormat &&
    cached.id === book.id
  )
    return cached;
  const pdf = isPdfBook(book);
  const physical = book.chapters.map((chapter, chapterIndex): ReadingChapterTarget | undefined => {
    const paragraph = chapter.paragraphs[0];
    if (!paragraph) return undefined;
    return {
      title: chapter.title,
      chapterIndex,
      paragraphId: paragraph.id,
      kind: pdf ? 'page' : 'chapter',
      ...(Number.isSafeInteger(chapter.sourcePage) && chapter.sourcePage! > 0
        ? { sourcePage: chapter.sourcePage }
        : {}),
    };
  });
  const index: NavigationIndex = {
    chapters: book.chapters,
    toc: book.toc,
    sourceFormat: book.sourceFormat,
    id: book.id,
    physical,
    locations: new Map(),
    logical: null,
  };
  if (pdf) {
    const all = readingScopeParagraphs(book, { chapter: 0, paragraph: '', farthest: 0 }, 'book');
    for (const entry of all)
      index.locations.set(entry.paragraph.id, {
        chapterIndex: entry.chapterIndex,
        ordinal: entry.ordinal,
      });
    const { boundaries } = pdfChapterStructure(book, all);
    if (boundaries?.length) {
      const first = boundaries[0].ordinal;
      const frontMatter = physical.flatMap((target): NavigationPoint[] => {
        if (!target) return [];
        const ordinal = index.locations.get(target.paragraphId)?.ordinal;
        return ordinal !== undefined && ordinal < first ? [{ ordinal, target }] : [];
      });
      index.logical = [
        ...frontMatter,
        ...boundaries.map(({ ordinal, title }): NavigationPoint => {
          const entry = all[ordinal];
          const page = physical[entry.chapterIndex]!;
          return {
            ordinal,
            target: { ...page, title, paragraphId: entry.paragraph.id, kind: 'chapter' },
          };
        }),
      ];
    }
  }
  indexes.set(book, index);
  return index;
}

/**
 * Explicit chapter controls, independent of physical page-turn edges. PDF
 * logical targets use the same reliable top-level TOC intervals as AI scopes.
 * Front matter stays reachable page by page, even before a chapter on that page.
 */
export function readingChapterNavigation(
  book: Book,
  position: Pick<Position, 'chapter' | 'paragraph'>,
): ReadingChapterNavigation {
  if (!Number.isInteger(position.chapter) || !book.chapters[position.chapter]) return {};
  const index = navigationIndex(book);
  const location = index.locations.get(position.paragraph);
  // A stale/foreign paragraph cannot establish a logical chapter. Keep its
  // known physical page and adjacent pages, without guessing a larger interval.
  if (!index.logical || location?.chapterIndex !== position.chapter)
    return {
      current: index.physical[position.chapter],
      previous: index.physical[position.chapter - 1],
      next: index.physical[position.chapter + 1],
    };
  let low = 0;
  let high = index.logical.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.logical[middle].ordinal <= location.ordinal) low = middle + 1;
    else high = middle;
  }
  const current = low - 1;
  return {
    current: index.logical[current]?.target,
    previous: index.logical[current - 1]?.target,
    next: index.logical[current + 1]?.target,
  };
}
