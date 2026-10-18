import type { Chapter, Position } from './types';

/** Position within the original text, independent of layout and translations. */
export function readingProgress(
  chapters: Chapter[],
  position?: Pick<Position, 'paragraph' | 'offset'>,
) {
  if (!position) return 0;
  let total = 0;
  let before = 0;
  let found = false;
  const offset = Math.max(0, Math.min(1, position.offset ?? 0));
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      const length = paragraph.text.length;
      total += length;
      if (paragraph.id === position.paragraph) {
        before += length * offset;
        found = true;
      } else if (!found) before += length;
    }
  }
  return found && total ? before / total : 0;
}
