import { sha256, utf8 } from './book-media';
import type { Book, Chapter } from './types';

/** Canonical source identity, separate from legacy Web chapter-v1 sourceHash. */
export const TRANSLATION_SOURCE_SCHEME = 'bypage-source-v1' as const;
export type TranslationSourceScheme = typeof TRANSLATION_SOURCE_SCHEME;

/** Field order and absent sourcePage are explicit; paragraph order remains significant. */
export function translationChapterFingerprint(chapter: Chapter): string {
  return sha256(
    utf8(
      JSON.stringify([
        'bypage-chapter-source-v1',
        chapter.id,
        chapter.title,
        chapter.sourcePage ?? null,
        chapter.paragraphs.map((paragraph) => [paragraph.id, paragraph.kind, paragraph.text]),
      ]),
    ),
  );
}

/** Import-language and immutable chapters participate; editable sidecars do not. */
export function translationBookFingerprint(book: Pick<Book, 'language' | 'chapters'>): string {
  return sha256(
    utf8(
      JSON.stringify([
        'bypage-book-source-v1',
        book.language,
        book.chapters.map(translationChapterFingerprint),
      ]),
    ),
  );
}
