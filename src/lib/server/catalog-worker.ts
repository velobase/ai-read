import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from './database';
import { parseCatalogBook } from './catalog-parser';
import { readCatalogAsset, saveCatalogAsset } from './catalog-storage';
import { validateBook } from '../../../packages/reading-core/src/reading-backup';

export async function runCatalogImport() {
  const available = { OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] };
  const job = await database.catalogImportJob.findFirst({
    where: { state: { in: ['queued', 'running'] }, ...available },
    orderBy: { createdAt: 'asc' },
  });
  if (!job) return false;
  const token = randomUUID();
  const claimed = await database.catalogImportJob.updateMany({
    where: { id: job.id, ...available },
    data: {
      state: 'running',
      leaseToken: token,
      leaseUntil: new Date(Date.now() + 600000),
      attempts: { increment: 1 },
      error: null,
    },
  });
  if (!claimed.count) return true;
  const started = Date.now();
  try {
    const edition = await database.catalogEdition.findUniqueOrThrow({
      where: { id: job.editionId },
      include: { book: true, assets: true },
    });
    const original = edition.assets.find((a) => a.kind === 'original')!;
    const parsed = await parseCatalogBook(
      await readCatalogAsset(original),
      edition.id,
      original.fileName,
    );
    const book = validateBook({
      ...parsed.book,
      title: edition.book.title,
      author: edition.book.author,
      language: edition.book.language,
      description: edition.book.description,
      category: edition.book.category,
    });
    const prefix = `catalog/${edition.bookId}/${edition.id}/${token}`;
    const bytes = Buffer.from(JSON.stringify(book));
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Reading bundle exceeds 50 MB');
    const assets = [
      {
        ...(await saveCatalogAsset(`${prefix}/book.json`, bytes, 'application/json')),
        kind: 'bundle',
        fileName: 'book.json',
      },
    ];
    const cover = book.cover?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
    if (cover)
      assets.push({
        ...(await saveCatalogAsset(`${prefix}/cover`, Buffer.from(cover[2], 'base64'), cover[1])),
        kind: 'cover',
        fileName: 'cover',
      });
    const warnings = [
      ...parsed.warnings,
      ...Object.entries(book.media?.diagnostics || {})
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${kind}: ${count}`),
    ];
    await database.$transaction(async (tx) => {
      const owned = await tx.catalogImportJob.updateMany({
        where: { id: job.id, leaseToken: token, leaseUntil: { gt: new Date() } },
        data: { state: 'ready', leaseToken: null, leaseUntil: null },
      });
      if (!owned.count) throw new Error('Import lease expired; waiting for retry');
      await tx.catalogEdition.update({
        where: { id: edition.id },
        data: {
          state: 'ready',
          chapterCount: book.chapters.length,
          paragraphCount: book.chapters.reduce((n, c) => n + c.paragraphs.length, 0),
          characterCount: book.chapters.reduce(
            (n, c) => n + c.paragraphs.reduce((m, p) => m + p.text.length, 0),
            0,
          ),
          warnings,
          assets: { create: assets },
        },
      });
    });
    console.info(
      JSON.stringify({
        event: 'catalog.import.ready',
        editionId: edition.id,
        durationMs: Date.now() - started,
        chapters: book.chapters.length,
        bytes: bytes.length,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed';
    await database.$transaction(async (tx) => {
      const owned = await tx.catalogImportJob.updateMany({
        where: { id: job.id, leaseToken: token },
        data: { state: 'failed', error: message, leaseToken: null, leaseUntil: null },
      });
      if (owned.count)
        await tx.catalogEdition.update({ where: { id: job.editionId }, data: { state: 'failed' } });
    });
    console.error(
      {
        event: 'catalog.import.failed',
        jobId: job.id,
        editionId: job.editionId,
        durationMs: Date.now() - started,
      },
      error,
    );
  }
  return true;
}
const shared = globalThis as unknown as { catalogWorkerStarted?: boolean };
export function startCatalogWorker() {
  if (shared.catalogWorkerStarted || !process.env.CATALOG_BUCKET || !process.env.DATABASE_URL)
    return;
  shared.catalogWorkerStarted = true;
  async function tick() {
    try {
      await runCatalogImport();
    } catch (error) {
      console.error('[catalog] Worker could not reach its queue', error);
    }
    setTimeout(tick, 5000).unref();
  }
  setTimeout(tick, 2000).unref();
}
