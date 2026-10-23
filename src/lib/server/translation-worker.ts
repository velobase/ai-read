import 'server-only';
import { logException } from './observability';
import { database } from './database';
import { authEnabled } from './auth-config';
import { serverAIConfig } from './ai-config';
import { normalizeAIUrl } from './ai-endpoint';
import { translateChunk, TranslationError } from './translate-chunk';
import {
  assembleChapter,
  chunkInput,
  mergeTerms,
  planChapter,
  contentHash,
  type ChunkResult,
  type Term,
  type TranslationProfile,
} from '../translation-edition';
import type { Book } from '../types';
import type { Prisma } from '@/generated/prisma/client';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const shared = globalThis as unknown as {
  chapterWorker?: { timer?: ReturnType<typeof setTimeout>; running: boolean };
};

async function runOne() {
  const now = new Date();
  const available = { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] };
  const candidate = await database.translationEdition.findFirst({
    where: {
      state: 'active',
      ...available,
      book: { deletedAt: null },
      chapters: {
        some: {
          state: { in: ['queued', 'running'] },
          OR: [{ retryAt: null }, { retryAt: { lte: now } }],
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
  });
  if (!candidate) return;
  const leaseToken = crypto.randomUUID();
  const lease = await database.translationEdition.updateMany({
    where: { id: candidate.id, state: 'active', ...available },
    data: { leaseToken, leaseUntil: new Date(Date.now() + 180000) },
  });
  if (!lease.count) return;
  const fence = { id: candidate.id, leaseToken, leaseUntil: { gt: new Date() } };
  let index: number | undefined;
  try {
    const edition = await database.translationEdition.findUniqueOrThrow({
      where: { id: candidate.id },
      include: { book: true },
    });
    if (edition.book.deletedAt || edition.state !== 'active') return;
    const chapter = await database.translationChapter.findFirst({
      where: {
        editionId: edition.id,
        state: { in: ['queued', 'running'] },
        OR: [{ retryAt: null }, { retryAt: { lte: now } }],
      },
      orderBy: [{ priority: 'desc' }, { chapterIndex: 'asc' }],
    });
    if (!chapter) return;
    index = chapter.chapterIndex;
    const book = edition.book.content as unknown as Book;
    const source = book.chapters[index];
    if (!source || (await contentHash(source)) !== chapter.sourceHash)
      throw new TranslationError('原文已变化，请创建新译本。');
    const profile = edition.profile as TranslationProfile;
    const config = await serverAIConfig(edition.userId);
    // Credentials remain in the account store. A key never follows an old or
    // caller-selected endpoint; the edition's model and style stay pinned.
    if (!config.baseUrl || normalizeAIUrl(config.baseUrl) !== normalizeAIUrl(profile.baseUrl))
      throw new TranslationError('模型服务地址已变化。请恢复原连接或创建新译本。');
    const chunks = planChapter(source);
    const results = chapter.checkpoint as unknown as ChunkResult[];
    if (chunks.length !== chapter.totalChunks || results.length !== chapter.completedChunks)
      throw new TranslationError('翻译断点不匹配，请创建新译本。');
    const canStart = await database.$transaction(async (tx) => {
      const owned = await tx.translationEdition.updateMany({
        where: { id: edition.id, leaseToken, leaseUntil: { gt: new Date() }, state: 'active' },
        data: { leaseUntil: new Date(Date.now() + 180000) },
      });
      if (!owned.count) return false;
      await tx.translationChapter.update({
        where: {
          editionId_chapterIndex: { editionId: edition.id, chapterIndex: index! },
        },
        data: { state: 'running' },
      });
      return true;
    });
    if (!canStart) return;
    let terms = edition.glossary as unknown as Term[];
    if (results.length < chunks.length) {
      const result = await translateChunk(
        chunkInput(
          book,
          index,
          edition.targetLanguage,
          chunks[results.length],
          terms,
          results.at(-1),
        ),
        profile,
        config.apiKey,
        AbortSignal.timeout(120000),
      );
      results.push(result);
      terms = mergeTerms(terms, result.terms);
    }
    const complete = results.length === chunks.length;
    const paragraphs = complete ? assembleChapter(source, chunks, results) : undefined;
    await database.$transaction(async (tx) => {
      // Updating the lease row locks it until both checkpoint and glossary commit.
      const owned = await tx.translationEdition.updateMany({
        where: { ...fence, leaseUntil: { gt: new Date() } },
        data: { glossary: json(terms) },
      });
      if (!owned.count) return;
      const parent = await tx.book.findUnique({
        where: { userId_id: { userId: edition.userId, id: edition.bookId } },
      });
      if (!parent || parent.deletedAt) return;
      await tx.translationChapter.update({
        where: {
          editionId_chapterIndex: { editionId: edition.id, chapterIndex: index! },
        },
        data: {
          state: complete ? 'ready' : 'queued',
          completedChunks: results.length,
          checkpoint: json(complete ? [] : results),
          ...(paragraphs ? { paragraphs: json(paragraphs) } : {}),
          attempts: 0,
          retryAt: null,
          error: null,
        },
      });
      const pending = await tx.translationChapter.count({
        where: { editionId: edition.id, state: { in: ['queued', 'running'] } },
      });
      if (!pending)
        await tx.translationEdition.updateMany({
          where: { id: edition.id, state: 'active' },
          data: { state: 'idle' },
        });
    });
  } catch (error) {
    logException('translation.worker', error, { editionId: candidate.id, chapterIndex: index });
    if (index !== undefined)
      await database.$transaction(async (tx) => {
        const owned = await tx.translationEdition.updateMany({
          where: { ...fence, leaseUntil: { gt: new Date() } },
          data: { updatedAt: new Date() },
        });
        if (!owned.count) return;
        const key = { editionId_chapterIndex: { editionId: candidate.id, chapterIndex: index! } };
        const row = await tx.translationChapter.findUnique({ where: key });
        if (!row) return;
        const attempts = row.attempts + 1;
        const retryable = !(error instanceof TranslationError) || error.retryable;
        const retry = retryable && attempts < 3;
        const message =
          error instanceof TranslationError ? error.message : '翻译连接中断，已保留完成的部分。';
        await tx.translationChapter.update({
          where: key,
          data: {
            state: retry ? 'queued' : 'error',
            attempts,
            error: message,
            retryAt: retry ? new Date(Date.now() + attempts * 10000) : null,
          },
        });
        if (!retry)
          await tx.translationEdition.updateMany({
            where: { id: candidate.id, state: 'active' },
            data: { state: 'error', error: message },
          });
      });
  } finally {
    await database.translationEdition.updateMany({
      where: { id: candidate.id, leaseToken },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
}

// The deployed app uses long-lived Node servers. Each instance runs one worker;
// database leases coordinate replicas. Nothing depends on a browser connection.
export function startTranslationWorker() {
  if (
    shared.chapterWorker ||
    !process.env.DATABASE_URL ||
    !authEnabled() ||
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.TRANSLATION_WORKER_DISABLED === '1'
  )
    return;
  const worker = { running: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
  shared.chapterWorker = worker;
  const tick = async () => {
    worker.running = true;
    try {
      await runOne();
    } catch {
      // A database outage leaves the durable job intact. Do not log credentials,
      // book contents, or provider response bodies.
    } finally {
      worker.running = false;
      worker.timer = setTimeout(() => void tick(), 2000);
      worker.timer.unref();
    }
  };
  worker.timer = setTimeout(() => void tick(), 1000);
  worker.timer.unref();
}
