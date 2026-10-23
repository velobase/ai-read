import type { Chapter, Position } from './types';

// Parsed book chapters are immutable. Cache cumulative offsets by that array's
// lifetime so sorting a shelf never rescans every paragraph for every comparison.
const indices = new WeakMap<
  Chapter[],
  { total: number; paragraphs: Map<string, { start: number; length: number }> }
>();
function indexFor(chapters: Chapter[]) {
  const existing = indices.get(chapters);
  if (existing) return existing;
  const index = { total: 0, paragraphs: new Map<string, { start: number; length: number }>() };
  for (const chapter of chapters)
    for (const paragraph of chapter.paragraphs) {
      index.paragraphs.set(paragraph.id, { start: index.total, length: paragraph.text.length });
      index.total += paragraph.text.length;
    }
  indices.set(chapters, index);
  return index;
}

/** Position within the original text, independent of layout and translations. */
export function readingProgress(
  chapters: Chapter[],
  position?: Pick<Position, 'paragraph' | 'offset'>,
) {
  if (!position) return 0;
  const index = indexFor(chapters);
  const paragraph = index.paragraphs.get(position.paragraph);
  const offset = Number.isFinite(position.offset) ? Math.max(0, Math.min(1, position.offset!)) : 0;
  return paragraph && index.total ? (paragraph.start + paragraph.length * offset) / index.total : 0;
}
