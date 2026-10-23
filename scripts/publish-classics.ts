/** Run with NODE_OPTIONS=--conditions=react-server. Credentials come from the operator environment. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCatalogBook } from '../src/lib/server/catalog-parser';
import { database } from '../src/lib/server/database';
import { catalogBundle, enqueueCatalogImport, publishCatalogBook } from '../src/lib/server/catalog';
import { runCatalogImport } from '../src/lib/server/catalog-worker';

const entries = [
  {
    number: 1342,
    slug: 'pride-and-prejudice',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    category: 'Literature',
    description:
      'Elizabeth Bennet and Mr. Darcy meet across a divide of pride, class and first impressions. Austen’s novel combines a sharp social eye with an enduring story of affection and self-discovery.',
  },
  {
    number: 11,
    slug: 'alice-in-wonderland',
    title: 'Alice’s Adventures in Wonderland',
    author: 'Lewis Carroll',
    category: 'Fantasy',
    description:
      'Follow Alice down the rabbit hole into a world of curious creatures, wordplay and impossible rules. A short, playful classic for readers who enjoy language and imagination.',
  },
  {
    number: 84,
    slug: 'frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    category: 'Science Fiction',
    description:
      'A scientist brings a creature to life and turns away from what he has made. This Gothic novel asks what creators owe their creations, and what happens when loneliness meets rejection.',
  },
  {
    number: 1661,
    slug: 'sherlock-holmes-adventures',
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    category: 'Mystery',
    description:
      'Twelve mysteries with Sherlock Holmes and Dr. Watson, from A Scandal in Bohemia to The Adventure of the Copper Beeches. Each story offers a compact journey through observation, deduction and surprise.',
  },
];
const directory = resolve(process.env.CATALOG_SEED_DIR || '/tmp/leafread-public-classics');
await mkdir(directory, { recursive: true });
const publish = process.argv.includes('--publish');
const ids: string[] = [];
for (const entry of entries) {
  const fileName = `${entry.slug}.epub`;
  let bytes: Buffer;
  try {
    bytes = await readFile(resolve(directory, fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const response = await fetch(`https://www.gutenberg.org/ebooks/${entry.number}.epub3.images`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Download ${entry.number}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(resolve(directory, fileName), bytes);
  }
  // These complete source editions include their original credits and license.
  // Content inspection is part of publication preparation, not an automated test suite.
  const parsed = await parseCatalogBook(bytes, `pg-${entry.number}`, fileName);
  const text = parsed.book.chapters
    .flatMap((c) => c.paragraphs)
    .map((p) => p.text)
    .join('\n');
  if (!text.includes('PROJECT GUTENBERG LICENSE'))
    throw new Error(`Missing source license: ${entry.slug}`);
  await writeFile(
    resolve(directory, `${entry.slug}.preview.json`),
    JSON.stringify(parsed.book, null, 2),
  );
  console.log(
    JSON.stringify({
      book: entry.title,
      chapters: parsed.book.chapters.map((c) => c.title),
      characters: text.length,
      images: parsed.book.media?.assets.length || 0,
      warnings: parsed.warnings,
      source: `https://www.gutenberg.org/ebooks/${entry.number}`,
    }),
  );
  if (!publish) continue;
  const { number, ...metadata } = entry;
  const book = await database.catalogBook.upsert({
    where: { slug: entry.slug },
    create: {
      ...metadata,
      language: 'en',
      sourceUrl: `https://www.gutenberg.org/ebooks/${number}`,
    },
    update: {},
    include: {
      editions: { include: { job: true }, orderBy: { createdAt: 'desc' } },
      publication: true,
    },
  });
  ids.push(book.id);
  if (book.publication) {
    console.log(`Already published: ${entry.slug}`);
    continue;
  }
  let edition = book.editions.find((e) => e.state === 'ready');
  if (!edition) {
    const queued =
      book.editions.find((e) => ['queued', 'running'].includes(e.job?.state || '')) ||
      (await enqueueCatalogImport(book.id, bytes, fileName));
    for (let n = 0; n < 120; n++) {
      await runCatalogImport();
      const state = await database.catalogEdition.findUniqueOrThrow({
        where: { id: queued.id },
        include: { job: true },
      });
      if (state.state === 'failed') throw new Error(state.job?.error || 'Parsing failed');
      if (state.state === 'ready') {
        edition = state;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  if (!edition) throw new Error('Import is still pending; rerun publication after it completes');
  const normalized = await catalogBundle(edition.id);
  if (
    !normalized.chapters.length ||
    !normalized.chapters
      .flatMap((c) => c.paragraphs)
      .some((p) => p.text.includes('PROJECT GUTENBERG LICENSE'))
  )
    throw new Error('Reading bundle is incomplete');
  await publishCatalogBook(book.id, edition.id);
  console.log(`Published: ${entry.slug} (${edition.id})`);
}
if (publish) {
  const existing = await database.catalogCollection.findFirst({
    where: { title: 'Start with a classic' },
  });
  const collection =
    existing ||
    (await database.catalogCollection.create({
      data: {
        title: 'Start with a classic',
        description:
          'Four familiar books, four different worlds. Complete English editions to read, annotate and translate.',
        sortOrder: 0,
      },
    }));
  await database.$transaction([
    database.catalogCollectionItem.deleteMany({ where: { collectionId: collection.id } }),
    database.catalogCollectionItem.createMany({
      data: ids.map((bookId, sortOrder) => ({ collectionId: collection.id, bookId, sortOrder })),
    }),
  ]);
}
await database.$disconnect();
