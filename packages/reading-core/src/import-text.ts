import type { Book, Chapter } from './types';
import { validateBook } from './reading-backup';

export function bookFromText(
  text: string,
  meta: { id: string; title: string; author: string; section: (n: number) => string },
): Book {
  const blocks = text
    .replace(/^\uFEFF/, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const paragraphs = blocks.flatMap(
    (p) => p.match(/[\s\S]{1,2400}(?:\s|$)|[\s\S]{1,2400}/gu) || [],
  );
  const chapters: Chapter[] = [];
  for (let start = 0; start < paragraphs.length; start += 60) {
    const index = chapters.length;
    chapters.push({
      id: `chapter-${index}`,
      title: meta.section(index + 1),
      paragraphs: paragraphs
        .slice(start, start + 60)
        .map((text, n) => ({ id: `${index + 1}.${n + 1}`, text: text.trim(), kind: 'text' })),
    });
  }
  return validateBook({
    id: meta.id,
    title: meta.title,
    author: meta.author,
    language: 'auto',
    importedAt: Date.now(),
    chapters,
  });
}
