import {
  TRANSLATION_SOURCE_SCHEME,
  translationChapterFingerprint,
} from '../../../packages/reading-core/src';
import 'server-only';
import { database } from './database';
import type { Book } from '../types';
import {
  translationSource,
  type TranslationEdition,
  type TranslationManifest,
  type TranslationProfile,
  type ChapterState,
  type ChapterTranslation,
} from '../translation-edition';

export class TranslationRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'TranslationRequestError';
  }
}
type SourceIdentity = { hash: string; chapters: string[]; chapterFingerprints: string[] };
const sourceIdentities = new Map<string, SourceIdentity>();
async function translationSourceIdentity(userId: string, editionId: string, sourceHash: string) {
  const key = JSON.stringify([userId, editionId, sourceHash]);
  const cached = sourceIdentities.get(key);
  if (cached) {
    sourceIdentities.delete(key);
    sourceIdentities.set(key, cached);
    return cached;
  }
  // Edition sources are immutable. Ownership is checked on every manifest/chapter read;
  // keep only bounded hashes between reads, never book content or provider credentials.
  const row = await database.translationEdition.findFirst({
    where: { id: editionId, userId, sourceHash },
    select: { source: true },
  });
  if (!row) return;
  const source = row.source as unknown as Book;
  const identity = await translationSource(source);
  if (identity.hash !== sourceHash) return;
  const value = {
    ...identity,
    chapterFingerprints: source.chapters.map(translationChapterFingerprint),
  };
  sourceIdentities.set(key, value);
  while (sourceIdentities.size > 16) sourceIdentities.delete(sourceIdentities.keys().next().value!);
  return value;
}

export async function readTranslationChapter(
  userId: string,
  bookId: string,
  language: string,
  editionId: string,
  index: number,
): Promise<ChapterTranslation> {
  const chapter = await database.translationChapter.findFirst({
    where: {
      editionId,
      chapterIndex: index,
      state: 'ready',
      edition: { userId, bookId, targetLanguage: language },
    },
    include: { edition: { select: { sourceHash: true } } },
  });
  if (!chapter)
    throw new TranslationRequestError(
      'translation_chapter_not_ready',
      '这段已保存译文暂时不可用。',
      404,
    );
  const source = await translationSourceIdentity(userId, editionId, chapter.edition.sourceHash);
  if (!source || source.chapters[index] !== chapter.sourceHash)
    throw new TranslationRequestError(
      'translation_source_changed',
      '这段已保存译文与当前原文不匹配。',
      409,
    );
  return {
    editionId,
    bookId,
    index,
    sourceHash: chapter.sourceHash,
    sourceScheme: TRANSLATION_SOURCE_SCHEME,
    sourceFingerprint: source.chapterFingerprints[index],
    paragraphs: chapter.paragraphs as Record<string, string>,
  };
}

export async function translationManifest(
  userId: string,
  bookId: string,
  language: string,
): Promise<TranslationManifest> {
  const rows = await database.translationEdition.findMany({
    where: { userId, bookId, targetLanguage: language },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sourceHash: true,
      profile: true,
      state: true,
      error: true,
      createdAt: true,
      chapters: {
        orderBy: { chapterIndex: 'asc' },
        select: {
          chapterIndex: true,
          sourceHash: true,
          state: true,
          completedChunks: true,
          totalChunks: true,
          error: true,
          attempts: true,
          retryAt: true,
        },
      },
    },
  });
  const selection = await database.translationSelection.findUnique({
    where: { userId_bookId_targetLanguage: { userId, bookId, targetLanguage: language } },
  });
  const sources = await Promise.all(
    rows.map((row) => translationSourceIdentity(userId, row.id, row.sourceHash)),
  );
  // Only attach portable proof after the original artifact's legacy identity
  // matches the stored source. Computing a new hash alone proves no provenance.
  return {
    selectedId: rows.some((r) => r.id === selection?.editionId) ? selection!.editionId : null,
    editions: rows.map((row, index): TranslationEdition => {
      const source = sources[index];
      return {
        id: row.id,
        bookId,
        language,
        sourceHash: row.sourceHash,
        // Canonical SHA includes the effective source language. The stored source
        // cannot prove the book's original import-language portable fingerprint.
        profile: row.profile as TranslationProfile,
        state: row.state as TranslationEdition['state'],
        error: row.error || undefined,
        createdAt: row.createdAt.getTime(),
        chapters: row.chapters.map((c) => ({
          index: c.chapterIndex,
          sourceHash: c.sourceHash,
          ...(source?.chapters[c.chapterIndex] === c.sourceHash
            ? {
                sourceScheme: TRANSLATION_SOURCE_SCHEME,
                sourceFingerprint: source.chapterFingerprints[c.chapterIndex],
              }
            : {}),
          state: c.state as ChapterState,
          completedChunks: c.completedChunks,
          totalChunks: c.totalChunks,
          error: c.error || undefined,
          attempts: c.attempts,
          retryAt: c.retryAt?.getTime(),
        })),
      };
    }),
  };
}
