import {
  TRANSLATION_SOURCE_SCHEME,
  translationChapterFingerprint,
} from '../../../packages/reading-core/src';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { translationBookSource } from '../translation-edition';
import { serverAIConfig } from './ai-config';
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
    paragraphs: (chapter.paragraphs || {}) as Record<string, string>,
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
        progress: {
          completed: row.chapters.reduce((sum, chapter) => sum + chapter.completedChunks, 0),
          total: row.chapters.reduce((sum, chapter) => sum + chapter.totalChunks, 0),
        },
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

/** A client may enqueue or reprioritize work; its connection never owns that work. */
export async function ensureTranslation(
  userId: string,
  input: { book: Book; language: string; chapter: number; action?: 'ensure' | 'retry' },
): Promise<TranslationManifest> {
  if (
    typeof input.language !== 'string' ||
    !input.language.trim() ||
    input.language.length > 80 ||
    !Number.isInteger(input.chapter) ||
    input.chapter < 0 ||
    (input.action !== undefined && input.action !== 'ensure' && input.action !== 'retry')
  )
    throw new TranslationRequestError('translation_request_invalid', '翻译请求格式不正确。');
  let source: Book;
  try {
    source = translationBookSource(input.book);
  } catch (cause) {
    const error = new TranslationRequestError(
      'translation_book_invalid',
      cause instanceof Error ? cause.message : '书籍格式不正确。',
    );
    error.cause = cause;
    throw error;
  }
  if (input.chapter >= source.chapters.length)
    throw new TranslationRequestError('translation_request_invalid', '章节不存在。');
  const language = input.language.trim();
  const identity = await translationSource(source);
  const config = await serverAIConfig(userId);
  const profile = {
    baseUrl: config.baseUrl,
    model: config.model,
    translationPrompt: config.translationPrompt,
    progressUnit: 'paragraph',
  };
  await database.$transaction(
    async (tx) => {
      // Serializes creation across replicas without replacing or deleting saved editions.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify([userId, source.id, language])}))`;
      const selection = await tx.translationSelection.findUnique({
        where: {
          userId_bookId_targetLanguage: { userId, bookId: source.id, targetLanguage: language },
        },
      });
      const candidates = await tx.translationEdition.findMany({
        where: { userId, bookId: source.id, targetLanguage: language, sourceHash: identity.hash },
        orderBy: { createdAt: 'desc' },
        include: { chapters: true },
      });
      let edition = candidates.find((item) => item.id === selection?.editionId) || candidates[0];
      if (!edition) {
        edition = await tx.translationEdition.create({
          data: {
            id: randomUUID(),
            userId,
            bookId: source.id,
            targetLanguage: language,
            sourceHash: identity.hash,
            source: source as unknown as Prisma.InputJsonValue,
            profile,
            state: 'active',
            chapters: {
              create: source.chapters.map((chapter, index) => ({
                chapterIndex: index,
                sourceHash: identity.chapters[index],
                state: 'queued',
                totalChunks: chapter.paragraphs.length,
                paragraphs: {},
                priority: index === input.chapter ? 1 : 0,
              })),
            },
          },
          include: { chapters: true },
        });
      } else {
        await tx.$queryRaw`SELECT id FROM "TranslationEdition" WHERE id = ${edition.id} FOR UPDATE`;
        edition = await tx.translationEdition.findUniqueOrThrow({
          where: { id: edition.id },
          include: { chapters: true },
        });
        if (!edition.leaseUntil || edition.leaseUntil.getTime() <= Date.now()) {
          await normalizeSavedTranslation(tx, edition);
          edition = await tx.translationEdition.findUniqueOrThrow({
            where: { id: edition.id },
            include: { chapters: true },
          });
        }
      }
      if (input.action === 'retry') {
        await tx.translationChapter.updateMany({
          where: { editionId: edition.id, state: 'error' },
          data: { state: 'queued', attempts: 0, retryAt: null, error: null },
        });
        if (edition.state === 'error')
          await tx.translationEdition.update({
            where: { id: edition.id },
            data: { state: 'active', error: null },
          });
      }
      // Priority affects the next claim only; it never touches a running request/lease.
      await tx.translationChapter.updateMany({
        where: { editionId: edition.id, state: { in: ['queued', 'missing'] } },
        data: { priority: 0 },
      });
      await tx.translationChapter.updateMany({
        where: {
          editionId: edition.id,
          chapterIndex: input.chapter,
          state: { in: ['queued', 'missing'] },
        },
        data: { priority: 1 },
      });
      await tx.translationSelection.upsert({
        where: {
          userId_bookId_targetLanguage: { userId, bookId: source.id, targetLanguage: language },
        },
        create: { userId, bookId: source.id, targetLanguage: language, editionId: edition.id },
        update: { editionId: edition.id },
      });
    },
    { timeout: 30000 },
  );
  return translationManifest(userId, source.id, language);
}

/** Recount saved business data once in paragraph units; never discard existing translations. */
export async function normalizeSavedTranslation(
  tx: Prisma.TransactionClient,
  edition: { id: string; source: unknown; profile: unknown; state: string },
) {
  const profile = edition.profile as Record<string, Prisma.InputJsonValue>;
  if (profile.progressUnit === 'paragraph') return;
  const source = edition.source as Book;
  const chapters = await tx.translationChapter.findMany({ where: { editionId: edition.id } });
  let complete = true;
  let allFailed = true;
  for (const chapter of chapters) {
    const original = source.chapters[chapter.chapterIndex];
    const saved = (chapter.paragraphs || {}) as Record<string, string>;
    const completed = original.paragraphs.filter(
      (paragraph) =>
        Object.hasOwn(saved, paragraph.id) &&
        typeof saved[paragraph.id] === 'string' &&
        (!paragraph.text.trim() || saved[paragraph.id].trim()),
    ).length;
    const ready = completed === original.paragraphs.length;
    complete &&= ready;
    if (!ready && chapter.state !== 'error') allFailed = false;
    await tx.translationChapter.update({
      where: {
        editionId_chapterIndex: { editionId: edition.id, chapterIndex: chapter.chapterIndex },
      },
      data: {
        totalChunks: original.paragraphs.length,
        completedChunks: completed,
        state: ready ? 'ready' : chapter.state === 'error' ? 'error' : 'queued',
      },
    });
  }
  await tx.translationEdition.update({
    where: { id: edition.id },
    data: {
      profile: { ...profile, progressUnit: 'paragraph' },
      state: complete ? 'ready' : allFailed ? 'error' : 'active',
      error: allFailed && !complete ? '部分内容翻译失败，请重试。' : null,
    },
  });
}
