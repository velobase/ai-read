import {
  TRANSLATION_SOURCE_SCHEME,
  type TranslationSourceScheme,
} from '../../packages/reading-core/src';
import type { Settings } from './types';
export {
  contentHash,
  translationSource,
  translationBookSource,
  editionNoteKey,
} from '../../packages/reading-core/src/translation-tasks';

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
  state: 'idle' | 'active' | 'paused' | 'ready' | 'error';
  progress: { completed: number; total: number };
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
