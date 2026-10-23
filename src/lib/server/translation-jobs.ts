import {
  TRANSLATION_SOURCE_SCHEME,
  translationBookFingerprint,
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
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type SourceIdentity = {
  hash: string;
  chapters: string[];
  fingerprint: string;
  chapterFingerprints: string[];
};
const sourceIdentities = new Map<string, { revision: string; value: SourceIdentity }>();
async function translationSourceIdentity(userId: string, bookId: string) {
  const key = JSON.stringify([userId, bookId]);
  const parent = await database.book.findUnique({
    where: { userId_id: { userId, id: bookId } },
    select: { version: true, updatedAt: true, deletedAt: true },
  });
  if (!parent || parent.deletedAt) {
    sourceIdentities.delete(key);
    return;
  }
  const revision = `${parent.version}:${parent.updatedAt.getTime()}`;
  const cached = sourceIdentities.get(key);
  if (cached?.revision === revision) {
    sourceIdentities.delete(key);
    sourceIdentities.set(key, cached);
    return cached.value;
  }
  // Preserve JSONB's original chapter property order for legacy hashes. Media,
  // references and the TOC are sidecars and never participated in those hashes.
  const [row] = await database.$queryRaw<
    Array<{ content: Book; version: number; updatedAt: Date }>
  >`
    SELECT "content" - 'media' - 'references' - 'toc' AS "content", "version", "updatedAt"
    FROM "Book"
    WHERE "userId" = ${userId} AND "id" = ${bookId} AND "deletedAt" IS NULL
  `;
  if (!row) {
    sourceIdentities.delete(key);
    return;
  }
  const value = {
    ...(await translationSource(row.content)),
    fingerprint: translationBookFingerprint(row.content),
    chapterFingerprints: row.content.chapters.map(translationChapterFingerprint),
  };
  // Polling/downloads retain bounded hashes only, never whole books or images.
  // A fresh parent revision/deletion check is still required for every read.
  sourceIdentities.delete(key);
  sourceIdentities.set(key, {
    revision: `${row.version}:${row.updatedAt.getTime()}`,
    value,
  });
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
      edition: { userId, bookId, targetLanguage: language, book: { deletedAt: null } },
    },
  });
  if (!chapter) throw new TranslationRequestError('这段已保存译文暂时不可用。', 404);
  const source = await translationSourceIdentity(userId, bookId);
  if (!source || source.chapters[index] !== chapter.sourceHash)
    throw new TranslationRequestError('这段已保存译文与当前原文不匹配。', 409);
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
    where: { userId, bookId, targetLanguage: language, book: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    include: {
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
  const source = rows.length ? await translationSourceIdentity(userId, bookId) : undefined;
  // Only attach portable proof after the original artifact's legacy identity
  // matches the stored source. Computing a new hash alone proves no provenance.
  return {
    selectedId: rows.some((r) => r.id === selection?.editionId) ? selection!.editionId : null,
    editions: rows.map((row): TranslationEdition => ({
      id: row.id,
      bookId,
      language,
      sourceHash: row.sourceHash,
      ...(source?.hash === row.sourceHash
        ? { sourceScheme: TRANSLATION_SOURCE_SCHEME, sourceFingerprint: source.fingerprint }
        : {}),
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
    })),
  };
}
