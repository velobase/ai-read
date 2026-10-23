import { validSyncId } from '../../packages/reading-core/src/reading-validation';
import { excerptMatch } from '../../packages/reading-core/src/search';
import { resolveTranslationKey } from '../../packages/reading-core/src/translation-key';
import {
  translationBookFingerprint,
  translationChapterFingerprint,
} from '../../packages/reading-core/src/translation-source';
import type { Book } from './types';
import type { PassageMatch, PassageSearch, PassageSearchOptions } from './book-search';
import { idb, localTransaction, readLocal } from './local-database';
import {
  contentHash,
  editionNoteKey,
  matchesTranslationSource,
  translationSource,
  type ChapterTranslation,
  type TranslationEdition,
  type TranslationManifest,
} from './translation-edition';
import { cachedChapterIndices, readChapterTranslation, readManifest } from './translation-storage';
import {
  readSavedTranslationSnapshot,
  readSavedTranslationVersion,
} from './saved-translation-storage';

/** URL-safe identity only. The paragraph text is reloaded from this device on activation. */
export type TranslationSearchTarget = {
  language: string;
  translationKey: string;
  textHash: string;
  sourceEnd: number;
};

const validLanguage = (value: string) => /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
const usableText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 100000 && !!value.trim();
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const timestamp = (value: number) => (Number.isFinite(value) ? value : 0);

type SourceIdentity = {
  hash: string;
  chapters: string[];
  fingerprint: string;
  fingerprints: string[];
};
const sourceIdentities = new WeakMap<Book, Promise<SourceIdentity>>();
function sourceIdentity(book: Book): Promise<SourceIdentity> {
  const cached = sourceIdentities.get(book);
  if (cached) return cached;
  // Book text is immutable. Reuse hashes when opening multiple search results,
  // without retaining the book after its reader/search scope is released.
  const pending = (async () => ({
    ...(await translationSource(book)),
    fingerprint: translationBookFingerprint(book),
    fingerprints: book.chapters.map(translationChapterFingerprint),
  }))();
  sourceIdentities.set(book, pending);
  void pending.catch(() => {
    if (sourceIdentities.get(book) === pending) sourceIdentities.delete(book);
  });
  return pending;
}

/** Shared paging rules keep original and saved-translation searches consistent. */
export function passageSearchBounds(options: Pick<PassageSearchOptions, 'limit' | 'offset'>) {
  return {
    limit: Number.isFinite(options.limit)
      ? Math.min(200, Math.max(1, Math.floor(options.limit!)))
      : 60,
    offset: Number.isSafeInteger(options.offset) && options.offset! >= 0 ? options.offset! : 0,
  };
}

/** Never inherit shelf/recency order or count the same immutable book twice. */
export function orderedSearchBooks(books: readonly Book[]): Book[] {
  const seen = new Set<string>();
  return [...books]
    .sort((a, b) => timestamp(b.importedAt) - timestamp(a.importedAt) || compareText(a.id, b.id))
    .filter((book) => {
      if (seen.has(book.id)) return false;
      seen.add(book.id);
      return true;
    });
}

async function localManifests(bookId: string, language?: string) {
  if (language) return [{ language, manifest: await readManifest(bookId, language) }];
  return localTransaction(
    'readonly',
    async (tx) => {
      const store = tx.objectStore('translation-manifests');
      const keys = await idb(store.getAllKeys());
      const entries: { language: string; manifest: TranslationManifest }[] = [];
      for (const key of keys) {
        let scope: unknown;
        try {
          scope = JSON.parse(String(key));
        } catch {
          continue;
        }
        if (
          Array.isArray(scope) &&
          scope.length === 2 &&
          scope[0] === bookId &&
          typeof scope[1] === 'string' &&
          validLanguage(scope[1])
        ) {
          const manifest = (await idb(store.get(key))) as TranslationManifest | undefined;
          if (manifest) entries.push({ language: scope[1], manifest });
        }
      }
      return entries.sort((a, b) => compareText(a.language, b.language));
    },
    ['translation-manifests'],
  );
}

function usableEdition(edition: TranslationEdition, book: Book, language: string) {
  return (
    edition &&
    validSyncId(edition.id) &&
    edition.bookId === book.id &&
    edition.language === language
  );
}

function usableChapter(
  cached: ChapterTranslation | undefined,
  book: Book,
  editionId: string,
  index: number,
  sourceHash: string,
  sourceFingerprint: string,
): cached is ChapterTranslation {
  return !!(
    cached &&
    cached.bookId === book.id &&
    cached.editionId === editionId &&
    cached.index === index &&
    matchesTranslationSource(cached, sourceHash, sourceFingerprint) &&
    cached.paragraphs &&
    typeof cached.paragraphs === 'object' &&
    !Array.isArray(cached.paragraphs)
  );
}

/** Read the exact saved version without fetching a manifest, downloading or preparing text. */
export async function readSearchTranslation(
  book: Book,
  target: Pick<TranslationSearchTarget, 'language' | 'translationKey'> & { paragraphId: string },
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  const { language, translationKey: key, paragraphId } = target;
  if (!validLanguage(language) || !validSyncId(key)) return null;
  const paragraphIds = new Set(
    book.chapters.flatMap((chapter) => chapter.paragraphs.map((p) => p.id)),
  );
  const resolved = resolveTranslationKey(key, paragraphIds);
  if (!resolved || resolved.language !== language || resolved.paragraphId !== paragraphId)
    return null;
  const index = book.chapters.findIndex((chapter) =>
    chapter.paragraphs.some((paragraph) => paragraph.id === paragraphId),
  );
  if (index < 0) return null;
  const exact = await readSavedTranslationVersion(book, key);
  signal?.throwIfAborted();
  if (exact !== undefined) return exact?.text || null;
  if (resolved.version.startsWith('edition-')) {
    const editionId = resolved.version.slice('edition-'.length);
    const manifest = await readManifest(book.id, language);
    signal?.throwIfAborted();
    const edition = manifest.editions?.find(
      (edition) => usableEdition(edition, book, language) && edition.id === editionId,
    );
    if (!edition) return null;
    const source = await sourceIdentity(book);
    signal?.throwIfAborted();
    if (!matchesTranslationSource(edition, source.hash, source.fingerprint)) return null;
    const cached = await readChapterTranslation(editionId, index);
    signal?.throwIfAborted();
    if (
      !usableChapter(
        cached,
        book,
        editionId,
        index,
        source.chapters[index],
        source.fingerprints[index],
      )
    )
      return null;
    const text = cached.paragraphs[paragraphId];
    return usableText(text) ? text : null;
  }
  // Portable/legacy caches are already scoped by immutable Book.id. They do not
  // have chapter artifacts, so keep their exact key instead of inventing an edition.
  const legacy = await readLocal<Record<string, string>>('translations', book.id);
  signal?.throwIfAborted();
  const text = legacy?.[key];
  return usableText(text) ? text : null;
}

/** Search complete local artifacts across the whole book, not the Reader's nearby window. */
export async function searchSavedBookPassages(
  books: readonly Book[],
  query: string,
  options: Omit<PassageSearchOptions, 'source'> = {},
): Promise<PassageSearch> {
  const needle = query.trim().slice(0, 160);
  const { limit, offset } = passageSearchBounds(options);
  const matches: PassageMatch[] = [];
  let scannedBooks = 0;
  let skipped = 0;
  if (!needle || (options.language && !validLanguage(options.language)))
    return { matches, limited: false, scannedBooks };
  const signal = options.signal;
  let sliceStart = performance.now();
  const yieldIfNeeded = async () => {
    signal?.throwIfAborted();
    if (performance.now() - sliceStart >= 8) {
      options.onProgress?.(scannedBooks);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      sliceStart = performance.now();
    }
  };
  for (const book of orderedSearchBooks(books)) {
    signal?.throwIfAborted();
    const seen = new Set<string>();
    const collect = async (
      index: number,
      paragraphId: string,
      text: unknown,
      language: string,
      key: string,
      editionLabel?: string,
    ) => {
      await yieldIfNeeded();
      if (!usableText(text) || !validSyncId(key)) return false;
      const excerpt = excerptMatch(text, needle);
      if (!excerpt) return false;
      const textHash = await contentHash(text);
      signal?.throwIfAborted();
      const identity = JSON.stringify([paragraphId, language, textHash]);
      if (seen.has(identity)) return false;
      seen.add(identity);
      if (skipped < offset) {
        skipped++;
        return false;
      }
      if (matches.length === limit) return true;
      matches.push({
        bookId: book.id,
        chapterIndex: index,
        chapterTitle: book.chapters[index].title,
        paragraphId,
        source: 'translation',
        language,
        translationKey: key,
        textHash,
        ...(editionLabel ? { editionLabel } : {}),
        ...excerpt,
      });
      return false;
    };
    const manifests = await localManifests(book.id, options.language);
    signal?.throwIfAborted();
    const exact = await readSavedTranslationSnapshot(book);
    signal?.throwIfAborted();
    const exactOrder = new Map(
      book.chapters.flatMap((c) => c.paragraphs).map((p, index) => [p.id, index]),
    );
    for (const version of [...exact.versions.values()].sort(
      (a, b) =>
        exactOrder.get(a.paragraphId)! - exactOrder.get(b.paragraphId)! ||
        compareText(a.language, b.language) ||
        b.createdAt - a.createdAt ||
        compareText(a.key, b.key),
    )) {
      if (options.language && version.language !== options.language) continue;
      if (
        await collect(
          version.chapterIndex,
          version.paragraphId,
          version.text,
          version.language,
          version.key,
        )
      )
        return { matches, limited: true, scannedBooks };
    }
    for (const { language, manifest } of manifests) {
      const editions = (Array.isArray(manifest.editions) ? manifest.editions : [])
        .filter((edition) => usableEdition(edition, book, language))
        .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt) || compareText(a.id, b.id));
      const source = editions.length ? await sourceIdentity(book) : null;
      signal?.throwIfAborted();
      for (const edition of editions) {
        if (!source || !matchesTranslationSource(edition, source.hash, source.fingerprint))
          continue;
        const indices = [...new Set(await cachedChapterIndices(edition.id))]
          .filter(
            (index) => Number.isSafeInteger(index) && index >= 0 && index < book.chapters.length,
          )
          .sort((a, b) => a - b);
        signal?.throwIfAborted();
        for (const index of indices) {
          await yieldIfNeeded();
          const cached = await readChapterTranslation(edition.id, index);
          signal?.throwIfAborted();
          if (
            !usableChapter(
              cached,
              book,
              edition.id,
              index,
              source.chapters[index],
              source.fingerprints[index],
            )
          )
            continue;
          for (const paragraph of book.chapters[index].paragraphs) {
            if (
              await collect(
                index,
                paragraph.id,
                cached.paragraphs[paragraph.id],
                language,
                editionNoteKey(language, paragraph.id, edition.id),
                edition.profile?.model?.slice(0, 120),
              )
            )
              return { matches, limited: true, scannedBooks };
          }
        }
      }
    }
    const legacy = (await readLocal<Record<string, string>>('translations', book.id)) || {};
    signal?.throwIfAborted();
    // Resolve each key once. Trying every cache key for every paragraph becomes
    // quadratic on a prepared book. IDs may themselves contain colons.
    const locations = new Map<string, { index: number; ordinal: number }>();
    let ordinal = 0;
    book.chapters.forEach((chapter, index) =>
      chapter.paragraphs.forEach((paragraph) =>
        locations.set(paragraph.id, { index, ordinal: ordinal++ }),
      ),
    );
    const candidates: {
      language: string;
      key: string;
      paragraphId: string;
      index: number;
      ordinal: number;
    }[] = [];
    const paragraphIds = new Set(locations.keys());
    for (const key of Object.keys(legacy)) {
      const resolved = resolveTranslationKey(key, paragraphIds);
      if (
        !resolved ||
        !validLanguage(resolved.language) ||
        resolved.version.startsWith('edition-') ||
        (options.language && resolved.language !== options.language)
      )
        continue;
      await yieldIfNeeded();
      const { language, paragraphId } = resolved;
      const location = locations.get(paragraphId)!;
      candidates.push({ language, key, paragraphId, ...location });
    }
    candidates.sort(
      (a, b) =>
        a.ordinal - b.ordinal || compareText(a.language, b.language) || compareText(a.key, b.key),
    );
    for (const candidate of candidates) {
      if (
        await collect(
          candidate.index,
          candidate.paragraphId,
          legacy[candidate.key],
          candidate.language,
          candidate.key,
        )
      )
        return { matches, limited: true, scannedBooks };
    }
    scannedBooks++;
    options.onProgress?.(scannedBooks);
  }
  signal?.throwIfAborted();
  return { matches, limited: false, scannedBooks };
}
