import type { Book } from './types';
import { sha256, utf8 } from './book-media';
import { validateBook } from './reading-backup';
import { effectiveBookLanguage } from './reading-language';

export const TRANSLATION_PIPELINE = 'chapter-v1';
export type TranslationProfile = { baseUrl: string; model: string; translationPrompt: string };
export type ChapterState = 'missing' | 'queued' | 'running' | 'ready' | 'error';
export type ChapterProgress = {
  index: number;
  sourceHash: string;
  state: ChapterState;
  completedChunks: number;
  totalChunks: number;
  error?: string;
};
export type TranslationEdition = {
  id: string;
  bookId: string;
  language: string;
  sourceHash: string;
  profile: TranslationProfile;
  state: 'idle' | 'active' | 'paused' | 'error';
  chapters: ChapterProgress[];
  createdAt: number;
  error?: string;
};
export type TranslationManifest = { selectedId: string | null; editions: TranslationEdition[] };
export type ChapterTranslation = {
  editionId: string;
  bookId: string;
  index: number;
  sourceHash: string;
  paragraphs: Record<string, string>;
};
/** Canonical source identity for saved chapter artifacts; this does not schedule translation. */
export function translationBookSource(book: Book): Book {
  return validateBook({
    id: book.id,
    title: book.title,
    author: book.author,
    language: effectiveBookLanguage(book),
    importedAt: book.importedAt,
    chapters: book.chapters,
  });
}
export async function contentHash(value: unknown) {
  return sha256(utf8(JSON.stringify(value)));
}
export async function translationSource(book: Book) {
  const source = translationBookSource(book);
  const chapters = await Promise.all(source.chapters.map((c) => contentHash(c)));
  return { chapters, hash: await contentHash([TRANSLATION_PIPELINE, source.language, chapters]) };
}

export const editionNoteKey = (language: string, paragraph: string, edition: string) =>
  `${language}:${paragraph}:edition-${edition}`;
