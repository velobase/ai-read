import type { Book, BookReferenceTarget, Position } from '@bypage/reading-core';
import type { PassageLink } from '../components/passage';

export type ReferenceOrigin = Pick<Position, 'paragraph' | 'textOffset' | 'textSource'>;
export type ReadingReference = { id: string; label: string; origin: ReferenceOrigin };

/** Offsets always belong to the original paragraph; translated text never borrows them. */
export function referencesByParagraph(book: Book): Map<string, PassageLink[]> {
  const paragraphs = new Map(
    book.chapters.flatMap((chapter) =>
      chapter.paragraphs.map((paragraph) => [paragraph.id, paragraph] as const),
    ),
  );
  const result = new Map<string, PassageLink[]>();
  for (const link of book.references?.links || []) {
    for (const range of link.source) {
      const paragraph = paragraphs.get(range.paragraphId);
      if (!paragraph) continue;
      const entries = result.get(paragraph.id) || [];
      entries.push({
        id: link.id,
        start: range.start,
        end: range.end,
        label: paragraph.text.slice(range.start, range.end),
      });
      result.set(paragraph.id, entries);
    }
  }
  return result;
}

export function referencePreview(book: Book, target: BookReferenceTarget) {
  if (target.content) return target.content;
  const chapter = book.chapters.find((chapter) => chapter.id === target.location.chapterId);
  const paragraphs = new Map(chapter?.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  return target.paragraphIds.flatMap((id) => {
    const paragraph = paragraphs.get(id);
    return paragraph ? [paragraph] : [];
  });
}
