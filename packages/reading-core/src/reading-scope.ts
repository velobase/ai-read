import type { Book, BookTocEntry, Paragraph, Position } from './types';
import { inferPdfToc, isPdfBook } from './pdf-toc';

export type ReadingScope = 'chapter' | 'read' | 'book';
export type ReadingScopeParagraph = {
  paragraph: Paragraph;
  /** Physical page index for a PDF, spine chapter index for other formats. */
  chapterIndex: number;
  chapter: string;
  /** Actual reading order; paragraph IDs are opaque and are never sorted numerically. */
  ordinal: number;
};

type TocAnchor = { ordinal: number; depth: number; title: string };
export type ReadingChapterBoundary = Pick<TocAnchor, 'ordinal' | 'title'>;

/** Resolve only real paragraph boundaries. Invalid entries are never assigned to a page start. */
function tocAnchors(
  toc: BookTocEntry[],
  locations: ReadonlyMap<string, { ordinal: number; chapterId: string }>,
): { reliable: ReadingChapterBoundary[] | null; fences: number[] } {
  const resolved: TocAnchor[] = [];
  let valid = toc.length > 0 && toc.length <= 2000;
  for (const entry of toc) {
    const location = entry && locations.get(entry.paragraphId);
    if (!location || location.chapterId !== entry.chapterId) {
      valid = false;
      continue;
    }
    resolved.push({ ordinal: location.ordinal, depth: entry.depth, title: entry.title });
    if (
      typeof entry.title !== 'string' ||
      !entry.title.trim() ||
      !Number.isInteger(entry.depth) ||
      entry.depth < 0 ||
      entry.depth > 8
    )
      valid = false;
  }
  // Even an unusable directory can supply a conservative fence on this page.
  // These fences only narrow the physical-page fallback; they never expand it.
  const fences = [...new Set(resolved.map((entry) => entry.ordinal))].sort((a, b) => a - b);
  if (!valid || !resolved.length) return { reliable: null, fences };
  const depth = Math.min(...resolved.map((entry) => entry.depth));
  if (
    resolved[0].depth !== depth ||
    resolved.some(
      (entry, index) =>
        index > 0 &&
        (entry.ordinal < resolved[index - 1].ordinal ||
          entry.depth > resolved[index - 1].depth + 1),
    )
  )
    return { reliable: null, fences };
  // A parent and its first child may share an anchor. Equal starts are one
  // boundary, and nested headings do not shorten their enclosing chapter.
  const seen = new Set<number>();
  const reliable: ReadingChapterBoundary[] = [];
  for (const entry of resolved) {
    if (entry.depth !== depth || seen.has(entry.ordinal)) continue;
    seen.add(entry.ordinal);
    reliable.push({ ordinal: entry.ordinal, title: entry.title });
  }
  return { reliable, fences };
}

/** Shared PDF directory validation for evidence scopes and explicit chapter navigation. */
export function pdfChapterStructure(
  book: Book,
  paragraphs: readonly ReadingScopeParagraph[],
): { boundaries: ReadingChapterBoundary[] | null; fences: number[] } {
  const locations = new Map(
    paragraphs.map((entry) => [
      entry.paragraph.id,
      { ordinal: entry.ordinal, chapterId: book.chapters[entry.chapterIndex].id },
    ]),
  );
  const supplied = tocAnchors(book.toc || [], locations);
  const inferred = supplied.reliable ? null : tocAnchors(inferPdfToc(book), locations);
  return {
    boundaries: supplied.reliable || inferred?.reliable || null,
    fences: [...new Set([...supplied.fences, ...(inferred?.fences || [])])],
  };
}

/**
 * Evidence scope shared by retrieval and conversation-history filtering.
 * PDF chapter scope uses reliable top-level TOC intervals at paragraph precision.
 * Front matter and ambiguous navigation fall back to the current physical page,
 * clipped at known local boundaries. Other formats keep their spine chapters.
 */
export function readingScopeParagraphs(
  book: Book,
  position: Pick<Position, 'chapter' | 'paragraph' | 'farthest'>,
  scope: ReadingScope,
): ReadingScopeParagraph[] {
  let ordinal = 0;
  const all = book.chapters.flatMap((chapter, chapterIndex) =>
    chapter.paragraphs.map((paragraph) => ({
      paragraph,
      chapterIndex,
      chapter: chapter.title,
      ordinal: ordinal++,
    })),
  );
  if (scope === 'book') return all;
  if (!Number.isInteger(position.chapter) || !book.chapters[position.chapter]) return [];
  if (scope === 'read') {
    const farthest = Number.isInteger(position.farthest)
      ? Math.max(position.chapter, position.farthest)
      : position.chapter;
    return all.filter((entry) => entry.chapterIndex <= farthest);
  }
  const page = all.filter((entry) => entry.chapterIndex === position.chapter);
  if (!page.length || !isPdfBook(book)) return page;
  const { boundaries, fences } = pdfChapterStructure(book, all);
  const current = page.find((entry) => entry.paragraph.id === position.paragraph);
  if (current && boundaries?.length) {
    const next = boundaries.findIndex((entry) => entry.ordinal > current.ordinal);
    const previous = next < 0 ? boundaries.length - 1 : next - 1;
    if (previous >= 0)
      return all.slice(
        boundaries[previous].ordinal,
        next < 0 ? all.length : boundaries[next].ordinal,
      );
  }
  // Missing anchors do not authorize a larger logical chapter. The first real
  // paragraph is the conservative reference point for the physical-page fallback.
  const at = current?.ordinal ?? page[0].ordinal;
  let start = page[0].ordinal;
  let end = page[page.length - 1].ordinal + 1;
  for (const fence of fences) {
    if (fence <= at) start = Math.max(start, fence);
    else end = Math.min(end, fence);
  }
  return all.slice(start, end);
}
