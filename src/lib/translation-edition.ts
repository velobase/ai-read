import {
  TRANSLATION_SOURCE_SCHEME,
  type TranslationSourceScheme,
} from '../../packages/reading-core/src';
import type { Book, Settings } from './types';

export const TRANSLATION_PIPELINE = 'chapter-v1';
export type TranslationProfile = Pick<Settings, 'baseUrl' | 'model' | 'translationPrompt'>;
export type ChapterState = 'missing' | 'queued' | 'running' | 'ready' | 'error';
// Optional for existing local caches; when present the pair is verified together.
export type TranslationSourceProof = {
  sourceScheme?: TranslationSourceScheme;
  sourceFingerprint?: string;
};
export function matchesTranslationSource(
  value: { sourceHash: string; sourceScheme?: string; sourceFingerprint?: string },
  legacy: string,
  canonical: string,
) {
  if (value.sourceScheme !== undefined || value.sourceFingerprint !== undefined)
    return (
      value.sourceScheme === TRANSLATION_SOURCE_SCHEME && value.sourceFingerprint === canonical
    );
  return value.sourceHash === legacy;
}
export type ChapterProgress = TranslationSourceProof & {
  index: number;
  sourceHash: string;
  state: ChapterState;
  completedChunks: number;
  totalChunks: number;
  error?: string;
  attempts?: number;
  retryAt?: number;
};
export type TranslationEdition = TranslationSourceProof & {
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
export type ChapterTranslation = TranslationSourceProof & {
  editionId: string;
  bookId: string;
  index: number;
  sourceHash: string;
  paragraphs: Record<string, string>;
};
export async function contentHash(value: unknown) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function translationSource(book: Book) {
  const chapters = await Promise.all(book.chapters.map((c) => contentHash(c)));
  return { chapters, hash: await contentHash([TRANSLATION_PIPELINE, book.language, chapters]) };
}

export const editionNoteKey = (language: string, paragraph: string, edition: string) =>
  `${language}:${paragraph}:edition-${edition}`;
