import 'server-only';
import { database } from './database';
import { Prisma } from '@/generated/prisma/client';
import {
  cleanPreferences,
  cleanShelf,
  bookMetadata,
  syncEntities,
  type SyncEntity,
  type SyncRecord,
  type SyncData,
  type ChatTurn,
  type BookMetadata,
} from '../sync-types';
import { validateBook } from '../reading-backup';
import { validNoteAnchor, validPosition, validSyncId } from '../reading-validation';
import type { Book, Note, Position } from '../types';
import { supplementBookMetadata } from '../book-metadata';
import { supplementBookMedia } from '../../../packages/reading-core/src/book-media';
import { supplementBookReferences } from '../../../packages/reading-core/src/book-references';
import { sameBookContent } from '../../../packages/reading-core/src/import-markup';
import {
  MAX_BOOKMARKS_PER_BOOK,
  validateBookmark,
} from '../../../packages/reading-core/src/bookmarks';
import type { Bookmark } from '../../../packages/reading-core/src/types';
import { resolveTranslationKey } from '../../../packages/reading-core/src/translation-key';

type DB = Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fail = (): never => {
  throw new Error('invalid-sync-data');
};
const text = (v: unknown, max: number): string =>
  typeof v === 'string' && v.length <= max ? v : fail();
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail();
export const validId = validSyncId;
export function entityFrom(v: unknown): SyncEntity {
  if (syncEntities.includes(v as SyncEntity)) return v as SyncEntity;
  return fail();
}
export async function syncBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail();
  const reader = request.body?.getReader();
  if (!reader) return fail();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // The former 64 MiB text/metadata budget plus up to 16 MiB of base64
      // image bytes and bounded placement metadata. Still cap the raw body.
      if (size > 96 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('sync-body-too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

export async function readRecord(
  db: DB,
  userId: string,
  entity: SyncEntity,
  bookId: string,
  id: string,
  includeContent = true,
): Promise<SyncRecord | null> {
  const base = { entity, bookId, id };
  const key = { userId_bookId_id: { userId, bookId, id } };
  if (entity === 'preferences') {
    const row = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferences: true, preferencesVersion: true, preferencesMutation: true },
    });
    return {
      ...base,
      version: row.preferencesVersion,
      deleted: false,
      mutationId: row.preferencesMutation,
      data: cleanPreferences(row.preferences),
    };
  }
  if (entity === 'book') {
    // Project metadata in PostgreSQL; shelf ACKs never load text or image bytes.
    const [row] = await db.$queryRaw<
      Array<{
        version: number;
        deletedAt: Date | null;
        mutationId: string;
        shelfState: unknown;
        content: Book | null;
        metadata: BookMetadata;
      }>
    >`SELECT "version", "deletedAt", "mutationId", "shelfState",
      CASE WHEN ${includeContent} THEN "content" ELSE NULL END AS "content",
      jsonb_strip_nulls(jsonb_build_object(
        'toc', "content" -> 'toc', 'sourceFormat', "content" -> 'sourceFormat',
        'sourceLanguage', "content" -> 'sourceLanguage',
        'references', "content" -> 'references',
        'mediaRevision', "content" -> 'media' -> 'revision'
      )) AS "metadata"
      FROM "Book" WHERE "userId" = ${userId} AND "id" = ${id}`;
    return row
      ? {
          ...base,
          version: row.version,
          deleted: !!row.deletedAt,
          mutationId: row.mutationId,
          data: {
            shelfState: cleanShelf(row.shelfState),
            ...(!row.deletedAt ? { metadata: bookMetadata(row.metadata) } : {}),
            ...(includeContent && !row.deletedAt
              ? { content: row.content as unknown as Book }
              : {}),
          },
        }
      : null;
  }
  if (entity === 'position') {
    const row = await db.readingProgress.findUnique({
      where: { userId_bookId: { userId, bookId } },
    });
    return row
      ? {
          ...base,
          version: row.version,
          deleted: !!row.deletedAt,
          mutationId: row.mutationId,
          data: row.position as Position,
        }
      : null;
  }
  if (entity === 'note') {
    const row = await db.note.findUnique({ where: key });
    return row
      ? {
          ...base,
          version: row.version,
          deleted: !!row.deletedAt,
          mutationId: row.mutationId,
          data: {
            id,
            bookId,
            paragraphId: row.paragraphId,
            quote: row.quote,
            ...(row.anchor ? { anchor: row.anchor as Note['anchor'] } : {}),
            text: row.content,
            createdAt: row.createdAt.getTime(),
          },
        }
      : null;
  }
  if (entity === 'bookmark') {
    const row = await db.bookmark.findUnique({ where: key });
    return row
      ? {
          ...base,
          version: row.version,
          deleted: !!row.deletedAt,
          mutationId: row.mutationId,
          data: row.body as Bookmark,
        }
      : null;
  }
  if (entity === 'chat') {
    const row = await db.chatTurn.findUnique({ where: key });
    return row
      ? {
          ...base,
          version: row.version,
          deleted: !!row.deletedAt,
          mutationId: row.mutationId,
          data: {
            id,
            question: row.question,
            answer: row.answer,
            sources: row.sources as string[],
            partial: row.partial,
            createdAt: row.createdAt.getTime(),
          },
        }
      : null;
  }
  const row = await db.translationCache.findUnique({ where: key });
  return row
    ? {
        ...base,
        version: row.version,
        deleted: !!row.deletedAt,
        mutationId: row.mutationId,
        data: { key: id, text: row.translation },
      }
    : null;
}

export async function listRecords(
  userId: string,
  entity: SyncEntity,
  bookId: string,
  after: string,
) {
  const where = { userId, bookId, ...(after ? { id: { gt: after } } : {}) };
  const select = { id: true, version: true, deletedAt: true };
  const options = { where, select, orderBy: { id: 'asc' as const }, take: 200 };
  const rows =
    entity === 'book'
      ? await database.book.findMany({
          ...options,
          where: { userId, ...(after ? { id: { gt: after } } : {}) },
        })
      : entity === 'note'
        ? await database.note.findMany(options)
        : entity === 'bookmark'
          ? await database.bookmark.findMany(options)
          : entity === 'chat'
            ? await database.chatTurn.findMany(options)
            : entity === 'translation'
              ? await database.translationCache.findMany(options)
              : entity === 'position'
                ? (
                    await database.readingProgress.findMany({
                      where: { userId, bookId },
                      select: { bookId: true, version: true, deletedAt: true },
                    })
                  ).map((r) => ({ ...r, id: bookId }))
                : [];
  return {
    items: rows.map((row) => ({
      entity,
      bookId: entity === 'book' ? row.id : bookId,
      id: row.id,
      version: row.version,
      deleted: !!row.deletedAt,
    })),
    next: rows.length === 200 ? rows.at(-1)!.id : null,
  };
}

export async function writeRecord(userId: string, raw: Record<string, unknown>) {
  const entity = entityFrom(raw.entity);
  const id = text(raw.id, 200),
    bookId = text(raw.bookId, 200),
    mutationId = text(raw.mutationId, 100);
  if (
    !validId(id) ||
    !validId(mutationId) ||
    (entity !== 'preferences' && !validId(bookId)) ||
    (entity === 'book' && id !== bookId) ||
    (entity === 'position' && id !== bookId)
  )
    fail();
  const baseVersion = raw.baseVersion;
  if (
    !Number.isSafeInteger(baseVersion) ||
    Number(baseVersion) < 0 ||
    typeof raw.deleted !== 'boolean'
  )
    fail();
  const deleted = raw.deleted;
  return database.$transaction(
    async (tx) => {
      // All sync writers use this short per-account lock. No network or model work inside it.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await readRecord(tx, userId, entity, bookId, id, entity !== 'book');
      if (current?.mutationId === mutationId) return { status: 200, record: current };
      if (entity !== 'book' && entity !== 'preferences') {
        const parent = await tx.book.findUnique({
          where: { userId_id: { userId, id: bookId } },
          select: { deletedAt: true },
        });
        if (!parent || parent.deletedAt)
          return {
            status: 409,
            parentDeleted: true,
            record: await readRecord(tx, userId, 'book', bookId, bookId, false),
          };
      }
      if ((current?.version ?? 0) !== baseVersion) return { status: 409, record: current };
      if (deleted && !current)
        return {
          status: 200,
          record: { entity, id, bookId, version: 0, deleted: true } as SyncRecord,
        };
      const version = Number(baseVersion) + 1;
      const stamp = { version, mutationId, deletedAt: deleted ? new Date() : null };
      const key = { userId_bookId_id: { userId, bookId, id } };
      if (entity === 'preferences') {
        if (deleted) fail();
        await tx.user.update({
          where: { id: userId },
          data: {
            preferences: json(cleanPreferences(raw.data)),
            preferencesVersion: version,
            preferencesMutation: mutationId,
          },
        });
      } else if (entity === 'book') {
        const data = deleted ? {} : object(raw.data);
        let content: Book | undefined;
        if (!current || current.deleted) {
          if (deleted) fail();
          content = validateBook(data.content);
          if (content.id !== id) fail();
          content = supplementBookMetadata(content, data.metadata);
        } else if (!deleted && (data.metadata !== undefined || data.content !== undefined)) {
          const saved = await tx.book.findUniqueOrThrow({
            where: { userId_id: { userId, id } },
            select: { content: true },
          });
          const previous = saved.content as unknown as Book;
          const incoming = data.content === undefined ? undefined : validateBook(data.content);
          if (incoming && (incoming.id !== id || !sameBookContent(previous, incoming))) fail();
          const withMedia = incoming
            ? supplementBookReferences(supplementBookMedia(previous, incoming), incoming)
            : previous;
          const next = supplementBookMetadata(
            withMedia,
            data.metadata === undefined && incoming ? bookMetadata(incoming) : data.metadata,
          );
          if (next !== previous) content = next;
        }
        await tx.book.upsert({
          where: { userId_id: { userId, id } },
          create: {
            userId,
            id,
            sourceHash: id,
            title: content?.title || '',
            content: json(content || {}),
            shelfState: json(cleanShelf(data.shelfState)),
            ...stamp,
          },
          update: {
            ...stamp,
            ...(content ? { content: json(content) } : {}),
            ...(content && (!current || current.deleted) ? { title: content.title } : {}),
            ...(!deleted ? { shelfState: json(cleanShelf(data.shelfState)) } : {}),
          },
        });
        if (deleted) {
          await tx.translationEdition.updateMany({
            where: { userId, bookId },
            data: { state: 'paused', leaseToken: null, leaseUntil: null },
          });
          const childStamp = { deletedAt: stamp.deletedAt, version: { increment: 1 }, mutationId };
          await tx.note.updateMany({
            where: { userId, bookId, deletedAt: null },
            data: childStamp,
          });
          await tx.bookmark.updateMany({
            where: { userId, bookId, deletedAt: null },
            data: childStamp,
          });
          await tx.readingProgress.updateMany({
            where: { userId, bookId, deletedAt: null },
            data: childStamp,
          });
          await tx.chatTurn.updateMany({
            where: { userId, bookId, deletedAt: null },
            data: childStamp,
          });
          await tx.translationCache.updateMany({
            where: { userId, bookId, deletedAt: null },
            data: childStamp,
          });
        }
      } else if (deleted) {
        if (entity === 'note') await tx.note.update({ where: key, data: stamp });
        else if (entity === 'bookmark') await tx.bookmark.update({ where: key, data: stamp });
        else if (entity === 'chat') await tx.chatTurn.update({ where: key, data: stamp });
        else if (entity === 'translation')
          await tx.translationCache.update({ where: key, data: stamp });
        else
          await tx.readingProgress.update({
            where: { userId_bookId: { userId, bookId } },
            data: stamp,
          });
      } else {
        const data = object(raw.data);
        // Paragraph validation does not need the EPUB image sidecar. Avoid
        // loading it into Node on every progress, bookmark, note or translation mutation.
        const [parent] = await tx.$queryRaw<Array<{ content: Book }>>`
          SELECT "content" - 'media' AS "content" FROM "Book"
          WHERE "userId" = ${userId} AND "id" = ${bookId}`;
        if (!parent) fail();
        const book = parent.content;
        const paragraphs = new Set(book.chapters.flatMap((c) => c.paragraphs.map((p) => p.id)));
        if (entity === 'position') {
          const p = data as Position;
          if (!validPosition(book, p)) fail();
          const position: Position = {
            chapter: p.chapter,
            paragraph: p.paragraph,
            farthest: Math.max(
              p.farthest,
              current && !current.deleted ? (current.data as Position).farthest : 0,
            ),
            offset:
              typeof p.offset === 'number' && Number.isFinite(p.offset)
                ? Math.max(0, Math.min(1, p.offset))
                : 0,
            ...(p.textOffset !== undefined ? { textOffset: p.textOffset } : {}),
            ...(p.textSource !== undefined ? { textSource: p.textSource } : {}),
            ...(p.textQuote !== undefined ? { textQuote: p.textQuote } : {}),
          };
          await tx.readingProgress.upsert({
            where: { userId_bookId: { userId, bookId } },
            create: { userId, bookId, position: json(position), ...stamp },
            update: { position: json(position), ...stamp },
          });
        } else if (entity === 'bookmark') {
          const bookmark = validateBookmark(book, data);
          if (bookmark.id !== id || bookmark.bookId !== bookId) fail();
          // The same account lock above serializes creation/restoration with this bound.
          if (
            (!current || current.deleted) &&
            (await tx.bookmark.count({ where: { userId, bookId, deletedAt: null } })) >=
              MAX_BOOKMARKS_PER_BOOK
          )
            throw new Error('Invalid bookmark');
          const values = { body: json(bookmark), createdAt: new Date(bookmark.createdAt) };
          await tx.bookmark.upsert({
            where: key,
            create: { userId, bookId, id, ...values, ...stamp },
            update: { ...values, ...stamp },
          });
        } else if (entity === 'note') {
          const note = data as Note;
          const paragraph = book.chapters
            .flatMap((c) => c.paragraphs)
            .find((p) => p.id === note.paragraphId);
          if (
            note.id !== id ||
            note.bookId !== bookId ||
            !paragraph ||
            !validNoteAnchor(note.anchor, note.quote, paragraph.text) ||
            !Number.isFinite(note.createdAt) ||
            note.createdAt < 0 ||
            note.createdAt > 8640000000000000
          )
            fail();
          const values = {
            paragraphId: note.paragraphId,
            quote: text(note.quote, 20000),
            anchor: note.anchor ? json(note.anchor) : Prisma.DbNull,
            content: text(note.text, 50000),
            createdAt: new Date(note.createdAt),
          };
          await tx.note.upsert({
            where: key,
            create: { userId, bookId, id, ...values, ...stamp },
            update: { ...values, ...stamp },
          });
        } else if (entity === 'chat') {
          const turn = data as ChatTurn;
          if (
            !Array.isArray(turn.sources) ||
            turn.sources.length > 500 ||
            !turn.sources.every((x) => paragraphs.has(x)) ||
            !Number.isFinite(turn.createdAt) ||
            turn.createdAt < 0 ||
            turn.createdAt > 8640000000000000
          )
            fail();
          const values = {
            question: text(turn.question, 20000),
            answer: text(turn.answer, 8 * 1024 * 1024),
            sources: json(turn.sources),
            partial: turn.partial === true,
            createdAt: new Date(turn.createdAt),
          };
          await tx.chatTurn.upsert({
            where: key,
            create: { userId, bookId, id, ...values, ...stamp },
            update: { ...stamp },
          });
        } else {
          const translationKey = resolveTranslationKey(id, paragraphs);
          if (data.key !== id || !translationKey) return fail();
          const values = {
            paragraphId: translationKey.paragraphId,
            targetLanguage: translationKey.language,
            translation: text(data.text, 1024 * 1024),
          };
          await tx.translationCache.upsert({
            where: key,
            create: { userId, bookId, id, ...values, ...stamp },
            update: { ...values, ...stamp },
          });
        }
      }
      return { status: 200, record: await readRecord(tx, userId, entity, bookId, id, false) };
    },
    { maxWait: 15000, timeout: 30000 },
  );
}
