import 'server-only';
import { database } from './database';
import { publicAIConfig } from './ai-config';
import { normalizeAIUrl } from './ai-endpoint';
import type { Prisma } from '@/generated/prisma/client';
import type { Book } from '../types';
import {
  translationProfile,
  translationSource,
  planChapter,
  type TranslationEdition,
  type TranslationManifest,
  type TranslationProfile,
  type ChapterState,
} from '../translation-edition';
import { validSyncId } from '../reading-validation';

const json = (value: unknown) => value as Prisma.InputJsonValue;
export class TranslationRequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function translationBook(userId: string, bookId: string) {
  if (!validSyncId(bookId)) throw new TranslationRequestError('书籍编号无效。');
  const row = await database.book.findUnique({ where: { userId_id: { userId, id: bookId } } });
  if (!row || row.deletedAt) throw new TranslationRequestError('等待书籍同步后开始准备译文。', 409);
  return row.content as unknown as Book;
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
        },
      },
    },
  });
  const selection = await database.translationSelection.findUnique({
    where: { userId_bookId_targetLanguage: { userId, bookId, targetLanguage: language } },
  });
  return {
    selectedId: rows.some((r) => r.id === selection?.editionId) ? selection!.editionId : null,
    editions: rows.map((row): TranslationEdition => ({
      id: row.id,
      bookId,
      language,
      sourceHash: row.sourceHash,
      profile: row.profile as TranslationProfile,
      state: row.state as TranslationEdition['state'],
      error: row.error || undefined,
      createdAt: row.createdAt.getTime(),
      chapters: row.chapters.map((c) => ({
        index: c.chapterIndex,
        sourceHash: c.sourceHash,
        state: c.state as ChapterState,
        completedChunks: c.completedChunks,
        totalChunks: c.totalChunks,
        error: c.error || undefined,
      })),
    })),
  };
}

export async function changeTranslation(userId: string, body: Record<string, unknown>) {
  const bookId = String(body.bookId || ''),
    language = String(body.language || '');
  if (!/^[\w-]{2,30}$/.test(language)) throw new TranslationRequestError('请选择翻译语言。');
  const action = body.action;
  if (!['prepare', 'new', 'pause', 'resume', 'select'].includes(String(action)))
    throw new TranslationRequestError('翻译操作无效。');
  const book = await translationBook(userId, bookId);
  const index = Number(body.chapter ?? 0);
  if (!Number.isInteger(index) || index < 0 || index >= book.chapters.length)
    throw new TranslationRequestError('章节编号无效。');
  const source = await translationSource(book);
  const config = await publicAIConfig(userId);
  const scope = body.scope === 'book' ? 'book' : 'chapter';
  const auto = body.auto === true;
  const newId = body.requestId;
  if (action === 'new' && (!validSyncId(newId) || newId.length > 80))
    throw new TranslationRequestError('翻译任务编号无效。');
  await database.$transaction(
    async (tx) => {
      // Serialize selection + edition creation with sync writes for this account.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const parent = await tx.book.findUnique({ where: { userId_id: { userId, id: bookId } } });
      if (!parent || parent.deletedAt) throw new TranslationRequestError('书籍已移除。', 409);
      const key = { userId, bookId, targetLanguage: language };
      const selection = await tx.translationSelection.findUnique({
        where: { userId_bookId_targetLanguage: key },
      });
      let edition = await tx.translationEdition.findFirst({
        where: {
          ...key,
          id:
            action === 'new'
              ? String(newId)
              : typeof body.editionId === 'string'
                ? body.editionId
                : selection?.editionId || '',
        },
      });
      if (!edition && (action === 'prepare' || action === 'new')) {
        if (!config.baseUrl || !config.model)
          throw new TranslationRequestError('请先连接翻译模型。');
        const profile = translationProfile({ ...config, baseUrl: normalizeAIUrl(config.baseUrl) });
        edition = await tx.translationEdition.create({
          data: {
            ...key,
            id: action === 'new' ? String(newId) : crypto.randomUUID(),
            sourceHash: source.hash,
            profile: json(profile),
            chapters: {
              create: book.chapters.map((chapter, chapterIndex) => ({
                chapterIndex,
                sourceHash: source.chapters[chapterIndex],
                totalChunks: planChapter(chapter).length,
              })),
            },
          },
        });
        if (!selection)
          await tx.translationSelection.create({ data: { ...key, editionId: edition.id } });
        if (action === 'new')
          await tx.translationEdition.updateMany({
            where: { ...key, id: { not: edition.id }, state: 'active' },
            data: { state: 'paused' },
          });
      }
      if (!edition) throw new TranslationRequestError('没有找到这个译本。', 404);
      // Match the worker's edition-before-chapter lock order. In particular,
      // reprioritizing a chapter must not deadlock its checkpoint transaction.
      await tx.$queryRaw`SELECT "id" FROM "TranslationEdition" WHERE "id" = ${edition.id} FOR UPDATE`;
      if (action === 'select') {
        if (edition.sourceHash !== source.hash)
          throw new TranslationRequestError('这个译本的原文版本已变化。');
        const pending = await tx.translationChapter.count({
          where: { editionId: edition.id, state: { not: 'ready' } },
        });
        const selected = selection
          ? await tx.translationEdition.findUnique({ where: { id: selection.editionId } })
          : null;
        if (
          selected &&
          selected.id !== edition.id &&
          edition.createdAt >= selected.createdAt &&
          pending
        )
          throw new TranslationRequestError('新译本完成后即可切换，当前译本仍可阅读。');
        await tx.translationSelection.upsert({
          where: { userId_bookId_targetLanguage: key },
          create: { ...key, editionId: edition.id },
          update: { editionId: edition.id },
        });
        return;
      }
      if (action === 'pause') {
        await tx.translationEdition.update({
          where: { id: edition.id },
          data: { state: 'paused' },
        });
        return;
      }
      if (edition.sourceHash !== source.hash)
        throw new TranslationRequestError('原文已变化，请创建新译本。');
      // Automatic reading never silently resumes a user-paused or failed job.
      if (auto && ['paused', 'error'].includes(edition.state)) return;
      const indices =
        action === 'new' || scope === 'book'
          ? book.chapters.map((_, i) => i)
          : [index, ...(body.prefetch === false ? [] : [index + 1])].filter(
              (i) => i < book.chapters.length,
            );
      if (action === 'resume') {
        const failed = await tx.translationChapter.findMany({
          where: { editionId: edition.id, state: 'error' },
          select: { chapterIndex: true },
        });
        indices.push(...failed.map((c) => c.chapterIndex));
      }
      await tx.translationChapter.updateMany({
        where: {
          editionId: edition.id,
          chapterIndex: { in: indices },
          state: { in: ['missing', ...(auto ? [] : ['error'])] },
        },
        data: { state: 'queued', attempts: 0, retryAt: null, error: null },
      });
      // Navigation prioritizes the current chapter without abandoning in-flight work.
      await tx.translationChapter.updateMany({
        where: { editionId: edition.id, chapterIndex: index },
        data: { priority: (Date.now() / 1000) | 0 },
      });
      const pending = await tx.translationChapter.count({
        where: { editionId: edition.id, state: { in: ['queued', 'running'] } },
      });
      await tx.translationEdition.update({
        where: { id: edition.id },
        data: { state: pending ? 'active' : 'idle', error: null },
      });
    },
    { timeout: 30000 },
  );
  return translationManifest(userId, bookId, language);
}
