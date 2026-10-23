import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from './database';
import { readCatalogAsset, saveCatalogAsset } from './catalog-storage';
import { validateBook } from '../../../packages/reading-core/src/reading-backup';

export const editionInclude = { assets: true, job: true } as const;
export const catalogInclude = {
  editions: { orderBy: { createdAt: 'desc' as const }, include: editionInclude },
  publication: true,
  collections: { include: { collection: true } },
} as const;

export function catalogMetadata(body: Record<string, unknown>) {
  const field = (key: string, max: number, required = false) => {
    const value = body[key];
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
      throw new Error(`Invalid ${key}`);
    return value.trim();
  };
  const slug = field('slug', 100, true);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error('Use lowercase letters, numbers and hyphens for the URL');
  const sourceUrl = field('sourceUrl', 1000);
  if (sourceUrl && !/^https:\/\//.test(sourceUrl)) throw new Error('Source must be an HTTPS URL');
  const language = field('language', 20, true);
  if (!/^[a-zA-Z-]{2,20}$/.test(language)) throw new Error('Invalid language');
  return {
    slug,
    title: field('title', 500, true),
    author: field('author', 500, true),
    description: field('description', 10000),
    category: field('category', 100, true),
    language,
    sourceUrl,
  };
}
export async function enqueueCatalogImport(bookId: string, bytes: Buffer, fileName: string) {
  if (!bytes.length || bytes.length > 30 * 1024 * 1024)
    throw new Error('Upload a file under 30 MB');
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext || !['epub', 'pdf', 'txt'].includes(ext))
    throw new Error('Please upload EPUB, PDF or UTF-8 TXT');
  await database.catalogBook.findUniqueOrThrow({ where: { id: bookId } });
  const editionId = randomUUID();
  const mime = { epub: 'application/epub+zip', pdf: 'application/pdf', txt: 'text/plain' }[ext]!;
  const asset = await saveCatalogAsset(
    `catalog/${bookId}/${editionId}/original.${ext}`,
    bytes,
    mime,
  );
  return database.catalogEdition.create({
    data: {
      id: editionId,
      bookId,
      assets: { create: { ...asset, kind: 'original', fileName: fileName.slice(0, 200) } },
      job: { create: {} },
    },
    include: editionInclude,
  });
}
export async function publishCatalogBook(bookId: string, editionId: string) {
  // A ready immutable edition is the only publishable unit; re-importing never
  // changes a reader's existing paragraph IDs or annotations.
  return database.$transaction(async (tx) => {
    const edition = await tx.catalogEdition.findFirst({
      where: { id: editionId, bookId, state: 'ready', assets: { some: { kind: 'bundle' } } },
    });
    if (!edition) throw new Error('Finish parsing and preview a ready edition before publishing');
    return tx.catalogPublication.upsert({
      where: { bookId },
      create: { bookId, editionId },
      update: { editionId, publishedAt: new Date() },
    });
  });
}
export async function catalogBundle(editionId: string) {
  const asset = await database.catalogAsset.findUniqueOrThrow({
    where: { editionId_kind: { editionId, kind: 'bundle' } },
  });
  return validateBook(JSON.parse((await readCatalogAsset(asset)).toString('utf8')));
}
export async function publicCatalog() {
  const books = await database.catalogBook.findMany({
    where: { publication: { isNot: null } },
    orderBy: { title: 'asc' },
    include: {
      publication: { include: { edition: { include: { assets: true } } } },
      collections: true,
    },
  });
  return books.map((book) => {
    const edition = book.publication!.edition;
    const bundle = edition.assets.find((a) => a.kind === 'bundle')!;
    return {
      id: book.id,
      slug: book.slug,
      title: book.title,
      author: book.author,
      description: book.description,
      category: book.category,
      language: book.language,
      sourceUrl: book.sourceUrl,
      editionId: edition.id,
      chapterCount: edition.chapterCount,
      characterCount: edition.characterCount,
      byteLength: bundle.byteLength,
      sha256: bundle.sha256,
      cover: edition.assets.some((a) => a.kind === 'cover')
        ? `/api/catalog/${book.slug}/cover`
        : undefined,
      collectionIds: book.collections.map((c) => c.collectionId),
    };
  });
}
