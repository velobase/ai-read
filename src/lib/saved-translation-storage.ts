import {
  assertSameSavedTranslationVersion,
  validateSavedTranslationSelection,
  validateSavedTranslationVersion,
  resolveSavedTranslationIdentity,
  type SavedTranslationSelection,
  type SavedTranslationVersion,
} from '../../packages/reading-core/src/saved-translation';
import {
  TRANSLATION_SOURCE_SCHEME,
  translationChapterFingerprint,
} from '../../packages/reading-core/src/translation-source';
import { sha256, utf8 } from '../../packages/reading-core/src/book-media';
import { selectLegacyTranslations } from './translation-selection';
import type { Book } from './types';
import { idb, localTransaction, readLocal } from './local-database';

export const savedTranslationRange = (bookId: string) => IDBKeyRange.bound([bookId], [bookId, []]);
const sourceIndexes = new WeakMap<
  Book,
  { chapters: Map<string, number>; fingerprints: Map<number, string> }
>();

/** Local content compatibility only; never asserts server publication or generation provenance. */
export function createSavedTranslationRecord(
  book: Book,
  key: string,
  text: string,
  createdAt: number,
) {
  const identity = resolveSavedTranslationIdentity(book, key);
  if (!identity) throw new Error('invalid_saved_translation');
  let index = sourceIndexes.get(book);
  if (!index) {
    index = {
      chapters: new Map(
        book.chapters.flatMap((c, i) => c.paragraphs.map((p) => [p.id, i] as const)),
      ),
      fingerprints: new Map(),
    };
    sourceIndexes.set(book, index);
  }
  const chapterIndex = index.chapters.get(identity.paragraphId)!;
  let fingerprint = index.fingerprints.get(chapterIndex);
  if (!fingerprint) {
    fingerprint = translationChapterFingerprint(book.chapters[chapterIndex]);
    index.fingerprints.set(chapterIndex, fingerprint);
  }
  return validateSavedTranslationVersion(book, {
    version: 1,
    bookId: book.id,
    key,
    language: identity.language,
    paragraphId: identity.paragraphId,
    kind: identity.kind,
    chapterIndex,
    sourceScheme: TRANSLATION_SOURCE_SCHEME,
    sourceFingerprint: fingerprint,
    text,
    textHash: sha256(utf8(text)),
    createdAt: Math.max(0, Math.floor(createdAt || 0)),
  });
}

export async function savedTranslationSnapshot(tx: IDBTransaction, bookId: string) {
  const [versions, selections] = await Promise.all([
    idb(tx.objectStore('translation-versions').getAll(savedTranslationRange(bookId))),
    idb(tx.objectStore('translation-selections').getAll(savedTranslationRange(bookId))),
  ]);
  return {
    versions: versions as SavedTranslationVersion[],
    selections: selections as SavedTranslationSelection[],
  };
}

export async function readSavedTranslationSnapshot(book: Book) {
  const raw = await localTransaction('readonly', (tx) => savedTranslationSnapshot(tx, book.id), [
    'translation-versions',
    'translation-selections',
  ]);
  const versions = new Map(
    raw.versions.map((value) => {
      const version = validateSavedTranslationVersion(book, value);
      return [version.key, version] as const;
    }),
  );
  const selections = raw.selections.map((value) =>
    validateSavedTranslationSelection(book, value, versions),
  );
  return { versions, selections };
}

/** undefined means absent; null means an existing record failed its source/text proof. */
export async function readSavedTranslationVersion(book: Book, key: string) {
  const value = await readLocal<SavedTranslationVersion>('translation-versions', [book.id, key]);
  if (value === undefined) return undefined;
  try {
    return validateSavedTranslationVersion(book, value);
  } catch {
    return null;
  }
}

/** Called inside the same import transaction as books, notes and positions. */
export async function mergeSavedTranslationVersions(
  tx: IDBTransaction,
  incoming: readonly SavedTranslationVersion[],
  selections: readonly SavedTranslationSelection[],
  preserveLegacyBooks: ReadonlySet<string> = new Set(),
  preferredVersion?: string,
) {
  const books = new Map<string, Book>();
  const versions = new Map<string, Map<string, SavedTranslationVersion>>();
  const legacyByBook = new Map<string, Record<string, string>>();
  const getBook = async (bookId: string) => {
    let book = books.get(bookId);
    if (!book) {
      book = await idb(tx.objectStore('books').get(bookId));
      if (!book) throw new Error('invalid_saved_translation');
      books.set(bookId, book);
    }
    return book;
  };
  const getLegacy = async (bookId: string) => {
    let values = legacyByBook.get(bookId);
    if (!values) {
      values = (await idb(tx.objectStore('translations').get(bookId))) || {};
      legacyByBook.set(bookId, values!);
    }
    return values!;
  };
  // Old libraries have an implicit reader choice. Materialize that choice only
  // where an incoming selection would otherwise replace it.
  for (const bookId of preserveLegacyBooks) {
    const book = await getBook(bookId);
    const legacy = await getLegacy(bookId);
    for (const language of new Set(
      selections.filter((s) => s.bookId === bookId).map((s) => s.language),
    )) {
      const chosen = selectLegacyTranslations(book, language, legacy, preferredVersion);
      for (const selected of selections.filter(
        (s) => s.bookId === bookId && s.language === language,
      )) {
        const key = [bookId, language, selected.paragraphId];
        if (await idb(tx.objectStore('translation-selections').get(key))) continue;
        const chapter = [...chosen.values()].find((c) => c.keys[selected.paragraphId]);
        if (!chapter) continue;
        const record = createSavedTranslationRecord(
          book,
          chapter.keys[selected.paragraphId],
          chapter.texts[selected.paragraphId],
          book.importedAt,
        );
        const existing = await idb(
          tx.objectStore('translation-versions').get([bookId, record.key]),
        );
        if (existing)
          assertSameSavedTranslationVersion(
            validateSavedTranslationVersion(book, existing),
            record,
          );
        else await idb(tx.objectStore('translation-versions').put(record, [bookId, record.key]));
        await idb(
          tx
            .objectStore('translation-selections')
            .put({ bookId, language, paragraphId: record.paragraphId, key: record.key }, key),
        );
      }
    }
  }
  for (const value of incoming) {
    const book = await getBook(value.bookId);
    const version = validateSavedTranslationVersion(book, value);
    const store = tx.objectStore('translation-versions');
    const existing = await idb(store.get([book.id, version.key]));
    if (existing)
      assertSameSavedTranslationVersion(validateSavedTranslationVersion(book, existing), version);
    const legacy = await getLegacy(book.id);
    if (typeof legacy[version.key] === 'string' && legacy[version.key] !== version.text)
      throw new Error('saved_translation_immutable_conflict');
    if (version.kind === 'published') {
      const prefix = `${version.language}:${version.paragraphId}:edition-`;
      const artifact = await idb(
        tx
          .objectStore('chapter-translations')
          .get([version.key.slice(prefix.length), version.chapterIndex]),
      );
      const text =
        artifact?.bookId === book.id ? artifact.paragraphs?.[version.paragraphId] : undefined;
      if (typeof text === 'string' && text !== version.text)
        throw new Error('saved_translation_immutable_conflict');
    }
    if (!existing) await idb(store.put(version, [book.id, version.key]));
    if (!versions.has(book.id)) versions.set(book.id, new Map());
    versions.get(book.id)!.set(version.key, existing || version);
  }
  for (const value of selections) {
    const book = await getBook(value.bookId);
    const candidates = versions.get(book.id) || new Map<string, SavedTranslationVersion>();
    if (!candidates.has(value.key)) {
      const found = await idb(tx.objectStore('translation-versions').get([book.id, value.key]));
      if (found) candidates.set(value.key, validateSavedTranslationVersion(book, found));
    }
    const selected = validateSavedTranslationSelection(book, value, candidates);
    const key = [book.id, selected.language, selected.paragraphId];
    const store = tx.objectStore('translation-selections');
    if (!(await idb(store.get(key)))) await idb(store.put(selected, key));
  }
}

/** A later server download/local completion cannot redefine an imported exact key. */
export async function assertSavedTranslationChapter(
  tx: IDBTransaction,
  book: Book,
  chapter: {
    editionId: string;
    language: string;
    index: number;
    paragraphs: Record<string, string>;
  },
) {
  const store = tx.objectStore('translation-versions');
  const keys = await idb(store.getAllKeys(savedTranslationRange(book.id)));
  const ids = new Set(book.chapters[chapter.index]?.paragraphs.map((p) => p.id) || []);
  for (const key of keys) {
    if (!Array.isArray(key) || typeof key[1] !== 'string')
      throw new Error('invalid_saved_translation');
    const identity = resolveSavedTranslationIdentity(book, key[1]);
    if (
      !identity ||
      identity.language !== chapter.language ||
      identity.version !== `edition-${chapter.editionId}` ||
      !ids.has(identity.paragraphId)
    )
      continue;
    const version = validateSavedTranslationVersion(book, await idb(store.get(key)));
    if (
      version.paragraphId in chapter.paragraphs &&
      chapter.paragraphs[version.paragraphId] !== version.text
    )
      throw new Error('saved_translation_immutable_conflict');
  }
}
