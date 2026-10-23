import type { Book } from './types';
import { sha256, utf8 } from './book-media';
import { validateBook } from './reading-backup';
import { effectiveBookLanguage } from './reading-language';

export const TRANSLATION_PIPELINE = 'chapter-v1';
export type TranslationProfile = { baseUrl: string; model: string; translationPrompt: string };
export type Term = { source: string; target: string };
export type TranslationSegment = { id: string; paragraphId: string; text: string; kind: string };
export type TranslationChunk = { segments: TranslationSegment[]; context: string };
export type ChunkResult = { segments: { id: string; text: string }[]; terms: Term[] };
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
export type TranslationCommand = {
  action: 'prepare' | 'new' | 'pause' | 'resume' | 'select';
  chapter: number;
  scope?: 'chapter' | 'book';
  auto?: boolean;
  prefetch?: boolean;
  editionId?: string;
  requestId?: string;
};
/** Only reading text enters the translation job. Images, notes and library sync stay separate. */
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
