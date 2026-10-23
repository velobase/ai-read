import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { database } from './database';
import { serverAIConfig } from './ai-config';
import { logException } from './observability';
import { normalizeSavedTranslation } from './translation-jobs';
import { translateBatch, type TranslationPart } from './translation-provider';
import type { Book } from '../types';
import type { TranslationProfile } from '../translation-edition';

const LEASE_MS = 180000;
const BATCH_CHARACTERS = 6000;
const MAX_ATTEMPTS = 3;
type Checkpoint = { paragraphId: string; part: number; total: number; text: string };

function splitParagraph(text: string) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > BATCH_CHARACTERS) {
    const window = rest.slice(0, BATCH_CHARACTERS);
    let cut =
      Math.max(
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('。'),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
      ) + 1;
    if (cut < BATCH_CHARACTERS / 2) {
      const space = window.lastIndexOf(' ');
      cut = space > BATCH_CHARACTERS / 2 ? space + 1 : BATCH_CHARACTERS - 1;
    }
    // Do not split a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : [text];
}

function readCheckpoint(value: unknown): Checkpoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (part): part is Checkpoint =>
      part &&
      typeof part === 'object' &&
      typeof part.paragraphId === 'string' &&
      Number.isInteger(part.part) &&
      Number.isInteger(part.total) &&
      typeof part.text === 'string',
  );
}

/** One bounded batch per lease keeps other books and new chapter priorities responsive. */
export async function runTranslationBatch() {
  const now = new Date();
  const available = { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] };
  const due = {
    state: { in: ['queued', 'running', 'missing'] },
    OR: [{ retryAt: null }, { retryAt: { lte: now } }],
  };
  const token = randomUUID();
  const candidate = await database.$transaction(async (tx) => {
    // Two slots across all server replicas, not two new requests per replica.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('leafread.translation.worker.slots'))`;
    const occupied = await tx.translationEdition.count({
      where: { leaseUntil: { gt: now }, leaseToken: { not: null } },
    });
    if (occupied >= 2) return null;
    const job = await tx.translationEdition.findFirst({
      where: { state: 'active', ...available, chapters: { some: due } },
      orderBy: { updatedAt: 'asc' },
      select: { id: true },
    });
    if (!job) return null;
    const claimed = await tx.translationEdition.updateMany({
      where: { id: job.id, state: 'active', ...available },
      data: { leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    return claimed.count ? job : null;
  });
  if (!candidate) return false;
  let chapterIndex: number | undefined;
  let attempts = 0;
  const started = Date.now();
  try {
    const claimed = await database.$transaction(
      async (tx) => {
        const owned = await tx.translationEdition.updateMany({
          where: { id: candidate.id, leaseToken: token, leaseUntil: { gt: new Date() } },
          data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
        });
        if (!owned.count)
          throw new Error('Translation worker lease expired before claiming a chapter');
        const edition = await tx.translationEdition.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        await normalizeSavedTranslation(tx, edition);
        const chapter = await tx.translationChapter.findFirst({
          where: { editionId: edition.id, ...due },
          orderBy: [{ priority: 'desc' }, { chapterIndex: 'asc' }],
        });
        if (chapter)
          await tx.translationChapter.update({
            where: {
              editionId_chapterIndex: { editionId: edition.id, chapterIndex: chapter.chapterIndex },
            },
            data: { state: 'running' },
          });
        return { edition, chapter };
      },
      { timeout: 30000 },
    );
    const { edition, chapter } = claimed;
    if (!chapter) return true;
    chapterIndex = chapter.chapterIndex;
    attempts = chapter.attempts;
    const source = edition.source as unknown as Book;
    const original = source.chapters[chapterIndex];
    if (!original) throw new Error('Translation source chapter is missing');
    const paragraphs = Object.assign(Object.create(null), chapter.paragraphs || {}) as Record<
      string,
      string
    >;
    let checkpoint = readCheckpoint(chapter.checkpoint);
    const batch: TranslationPart[] = [];
    let characters = 0;
    for (let paragraphIndex = 0; paragraphIndex < original.paragraphs.length; paragraphIndex++) {
      const paragraph = original.paragraphs[paragraphIndex];
      if (typeof paragraphs[paragraph.id] === 'string' && paragraphs[paragraph.id].trim()) continue;
      if (!paragraph.text.trim()) {
        paragraphs[paragraph.id] = paragraph.text;
        continue;
      }
      const pieces = splitParagraph(paragraph.text);
      for (let part = 0; part < pieces.length; part++) {
        if (
          checkpoint.some(
            (saved) =>
              saved.paragraphId === paragraph.id &&
              saved.part === part &&
              saved.total === pieces.length,
          )
        )
          continue;
        if (
          batch.length &&
          (characters + pieces[part].length > BATCH_CHARACTERS || batch.length >= 24)
        )
          break;
        batch.push({
          id: `${paragraphIndex}.${part}`,
          paragraphId: paragraph.id,
          part,
          total: pieces.length,
          text: pieces[part],
        });
        characters += pieces[part].length;
      }
      if (characters >= BATCH_CHARACTERS || batch.length >= 24 || pieces.length > 1) break;
    }
    if (batch.length) {
      const stillOwned = await database.translationEdition.updateMany({
        where: { id: edition.id, leaseToken: token, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!stillOwned.count)
        throw new Error('Translation worker lease expired before provider request');
      const config = await serverAIConfig(edition.userId);
      // Credentials/endpoints always come from the platform; preserve this job's prose style.
      const profile = edition.profile as TranslationProfile;
      config.translationPrompt = profile.translationPrompt;
      const translated = await translateBatch(
        config,
        {
          editionId: edition.id,
          bookId: edition.bookId,
          title: source.title,
          chapter: chapterIndex,
          chapterTitle: original.title,
          sourceLanguage: source.language,
          language: edition.targetLanguage,
        },
        batch,
      );
      checkpoint.push(
        ...batch.map((part) => ({
          paragraphId: part.paragraphId,
          part: part.part,
          total: part.total,
          text: translated.get(part.id)!,
        })),
      );
    }
    for (const paragraph of original.paragraphs) {
      const pieces = checkpoint
        .filter((part) => part.paragraphId === paragraph.id)
        .sort((a, b) => a.part - b.part);
      if (
        pieces.length &&
        pieces.length === pieces[0].total &&
        pieces.every((part, index) => part.part === index && part.total === pieces.length)
      ) {
        paragraphs[paragraph.id] = pieces.map((part) => part.text).join('\n');
        checkpoint = checkpoint.filter((part) => part.paragraphId !== paragraph.id);
      }
    }
    const completed = original.paragraphs.filter(
      (paragraph) =>
        Object.hasOwn(paragraphs, paragraph.id) &&
        typeof paragraphs[paragraph.id] === 'string' &&
        (!paragraph.text.trim() || paragraphs[paragraph.id].trim()),
    ).length;
    const ready = completed === original.paragraphs.length;
    await database.$transaction(async (tx) => {
      // Taking the edition row lock fences publication against a replacement worker.
      const owned = await tx.translationEdition.updateMany({
        where: { id: edition.id, leaseToken: token, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!owned.count)
        throw new Error('Translation worker lease expired before checkpoint publication');
      await tx.translationChapter.update({
        where: { editionId_chapterIndex: { editionId: edition.id, chapterIndex: chapterIndex! } },
        data: {
          paragraphs: paragraphs as Prisma.InputJsonValue,
          checkpoint,
          completedChunks: completed,
          totalChunks: original.paragraphs.length,
          state: ready ? 'ready' : 'queued',
          attempts: 0,
          retryAt: null,
          error: null,
        },
      });
      const unfinished = await tx.translationChapter.findMany({
        where: { editionId: edition.id, state: { not: 'ready' } },
        select: { state: true },
      });
      await tx.translationEdition.update({
        where: { id: edition.id },
        data: {
          state: !unfinished.length
            ? 'ready'
            : unfinished.every((item) => item.state === 'error')
              ? 'error'
              : 'active',
          error:
            unfinished.length && unfinished.every((item) => item.state === 'error')
              ? '部分内容翻译失败，请重试。'
              : null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
    });
    console.info(
      JSON.stringify({
        event: 'translation.checkpoint.saved',
        editionId: edition.id,
        bookId: edition.bookId,
        title: source.title,
        chapter: chapterIndex,
        completed,
        total: original.paragraphs.length,
        durationMs: Date.now() - started,
      }),
    );
  } catch (error) {
    logException('translation.worker.batch', error, {
      editionId: candidate.id,
      chapter: chapterIndex,
      attempts: attempts + 1,
      durationMs: Date.now() - started,
    });
    await database.$transaction(async (tx) => {
      const owned = await tx.translationEdition.updateMany({
        where: { id: candidate.id, leaseToken: token, leaseUntil: { gt: new Date() } },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!owned.count) return;
      if (chapterIndex !== undefined)
        await tx.translationChapter.update({
          where: { editionId_chapterIndex: { editionId: candidate.id, chapterIndex } },
          data: {
            state: attempts + 1 >= MAX_ATTEMPTS ? 'error' : 'queued',
            attempts: attempts + 1,
            retryAt:
              attempts + 1 >= MAX_ATTEMPTS ? null : new Date(Date.now() + 5000 * 4 ** attempts),
            error: '这部分译文暂时无法生成。',
          },
        });
      const remaining = await tx.translationChapter.findMany({
        where: { editionId: candidate.id, state: { not: 'ready' } },
        select: { state: true },
      });
      const failed =
        remaining.length > 0 && remaining.every((chapter) => chapter.state === 'error');
      await tx.translationEdition.update({
        where: { id: candidate.id },
        data: {
          state: failed ? 'error' : 'active',
          error: failed ? '部分内容翻译失败，请重试。' : null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
    });
  } finally {
    await database.translationEdition.updateMany({
      where: { id: candidate.id, leaseToken: token },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
  return true;
}

const shared = globalThis as unknown as { translationWorkerStarted?: boolean };
export function startTranslationWorker() {
  if (shared.translationWorkerStarted || !process.env.DATABASE_URL) return;
  shared.translationWorkerStarted = true;
  // Database claims cap global work at two books and one request per book.
  const loop = async () => {
    let found = false;
    try {
      found = await runTranslationBatch();
    } catch (error) {
      logException('translation.worker.queue', error);
    }
    setTimeout(loop, found ? 100 : 1500).unref();
  };
  for (let slot = 0; slot < 2; slot++) setTimeout(loop, 1000 + slot * 100).unref();
}
