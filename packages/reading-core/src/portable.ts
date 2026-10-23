import { validateBackup, type ReadingBackup } from './reading-backup';
import { resolveQuotedRange, safeReadingQuote } from './reading-anchor';
import { MAX_COLLECTIONS, normalizeCollectionName } from './collections';
import { utf8 } from './book-media';
import {
  validateSavedTranslationSelection,
  validateSavedTranslationVersion,
  type SavedTranslationSelection,
  type SavedTranslationVersion,
} from './saved-translation';

export const MAX_PORTABLE_TRANSLATION_VERSIONS = 100000;
export const MAX_PORTABLE_TRANSLATION_SELECTIONS = 100000;
export const MAX_PORTABLE_TRANSLATION_BYTES = 30 * 1024 * 1024;
export const MAX_PORTABLE_LIBRARY_BYTES = 50 * 1024 * 1024;

export type PortableCollection = { name: string; bookIds: string[] };

export type PortableTranslation = {
  bookId: string;
  language: string;
  paragraphs: Record<string, string>;
};
type PortableLibraryBase = {
  format: 'bypage-portable-library';
  backup: ReadingBackup;
  translations: PortableTranslation[];
  collections?: PortableCollection[];
};
export type PortableLibraryV1 = PortableLibraryBase & {
  version: 1;
  translationVersions?: never;
  translationSelections?: never;
};
export type PortableLibraryV2 = PortableLibraryBase & {
  version: 2;
  translationVersions: SavedTranslationVersion[];
  translationSelections: SavedTranslationSelection[];
};
export type PortableLibrary = PortableLibraryV1 | PortableLibraryV2;
export const portableTranslationKey = (language: string, paragraph: string) =>
  `${language}:${paragraph}:portable-v1`;

/** Accept the existing web backup too; no migration or network is required. */
export function validatePortableLibrary(raw: unknown): PortableLibrary {
  const value = raw as Partial<PortableLibrary> | null;
  if (value?.format !== 'bypage-portable-library') {
    return {
      format: 'bypage-portable-library',
      version: 1,
      backup: validateBackup(raw),
      translations: [],
    };
  }
  if (
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.translations) ||
    value.translations.length > 2000
  ) {
    throw new Error('Invalid reading pack');
  }
  if (
    value.version === 1 &&
    (value.translationVersions !== undefined || value.translationSelections !== undefined)
  )
    throw new Error('Invalid reading pack');
  if (value.version === 2) {
    if (
      !Array.isArray(value.translationVersions) ||
      value.translationVersions.length > MAX_PORTABLE_TRANSLATION_VERSIONS ||
      !Array.isArray(value.translationSelections) ||
      value.translationSelections.length > MAX_PORTABLE_TRANSLATION_SELECTIONS
    )
      throw new Error('Invalid reading pack translations');
    const serialized = JSON.stringify(raw);
    if (
      serialized.length > MAX_PORTABLE_LIBRARY_BYTES ||
      utf8(serialized).length > MAX_PORTABLE_LIBRARY_BYTES
    )
      throw new Error('Reading pack is too large');
  }
  // Book-level media and independent bookmarks travel with the existing v1 pack.
  // validateBackup retains and validates both, including their library-wide limits.
  const backup = validateBackup(value.backup);
  const books = new Map(
    backup.books.map((b) => [
      b.id,
      new Set(b.chapters.flatMap((c) => c.paragraphs.map((p) => p.id))),
    ]),
  );
  let collections: PortableCollection[] | undefined;
  if (value.collections !== undefined) {
    if (!Array.isArray(value.collections) || value.collections.length > MAX_COLLECTIONS)
      throw new Error('Invalid reading pack collections');
    const names = new Set<string>();
    const memberships = new Set<string>();
    collections = value.collections.map((collection) => {
      const normalized = normalizeCollectionName(collection?.name);
      if (
        !normalized ||
        names.has(normalized.key) ||
        !Array.isArray(collection?.bookIds) ||
        collection.bookIds.length > books.size
      )
        throw new Error('Invalid reading pack collections');
      names.add(normalized.key);
      const bookIds = collection.bookIds.map((bookId) => {
        if (typeof bookId !== 'string' || !books.has(bookId) || memberships.has(bookId))
          throw new Error('Invalid reading pack collection membership');
        memberships.add(bookId);
        return bookId;
      });
      return { name: normalized.name, bookIds };
    });
  }
  let total = 0;
  let translationBytes = 0;
  const seen = new Set<string>();
  const translations = value.translations.map((item) => {
    if (
      !item ||
      typeof item.language !== 'string' ||
      !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(item.language) ||
      item.language.length > 30 ||
      !books.has(item.bookId) ||
      !item.paragraphs ||
      typeof item.paragraphs !== 'object' ||
      Array.isArray(item.paragraphs)
    )
      throw new Error('Invalid reading pack');
    const key = JSON.stringify([item.bookId, item.language]);
    if (seen.has(key)) throw new Error('Duplicate translation');
    seen.add(key);
    const paragraphs: Record<string, string> = Object.create(null);
    for (const [id, text] of Object.entries(item.paragraphs)) {
      if (
        !books.get(item.bookId)!.has(id) ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 100000
      )
        throw new Error('Invalid translation');
      total += text.length;
      if (value.version === 2) {
        translationBytes += utf8(text).length;
        if (translationBytes > MAX_PORTABLE_TRANSLATION_BYTES)
          throw new Error('Reading pack is too large');
      }
      if (total > 30 * 1024 * 1024) throw new Error('Reading pack is too large');
      paragraphs[id] = text;
    }
    return { bookId: item.bookId, language: item.language, paragraphs };
  });
  if (value.version === 2) {
    const bookMap = new Map(backup.books.map((book) => [book.id, book]));
    const versionsByBook = new Map<string, Map<string, SavedTranslationVersion>>();
    const translationVersions = value.translationVersions!.map((item) => {
      const book = item && bookMap.get(item.bookId);
      if (!book) throw new Error('Invalid reading pack translations');
      const version = validateSavedTranslationVersion(book, item);
      let versions = versionsByBook.get(book.id);
      if (!versions) versionsByBook.set(book.id, (versions = new Map()));
      if (versions.has(version.key)) throw new Error('Duplicate saved translation');
      versions.set(version.key, version);
      translationBytes += utf8(version.text).length;
      if (translationBytes > MAX_PORTABLE_TRANSLATION_BYTES)
        throw new Error('Reading pack is too large');
      return version;
    });
    const selected = new Set<string>();
    const translationSelections = value.translationSelections!.map((item) => {
      const book = item && bookMap.get(item.bookId);
      if (!book) throw new Error('Invalid reading pack translations');
      const selection = validateSavedTranslationSelection(
        book,
        item,
        versionsByBook.get(book.id) || new Map(),
      );
      const scope = JSON.stringify([selection.bookId, selection.language, selection.paragraphId]);
      if (selected.has(scope)) throw new Error('Duplicate translation selection');
      selected.add(scope);
      return selection;
    });
    // Exact references are portable as-is. Never rewrite them to a selected
    // projection or portable-v1; missing referenced text stays unavailable.
    return {
      format: 'bypage-portable-library',
      version: 2,
      backup,
      translations,
      translationVersions,
      translationSelections,
      ...(collections !== undefined ? { collections } : {}),
    };
  }
  const byBookLanguage = new Map(
    translations.map((entry) => [JSON.stringify([entry.bookId, entry.language]), entry.paragraphs]),
  );
  // A portable pack carries one readable translation per language, not model
  // editions. Rebind only exact quotes that survived export, with a unique
  // relocation when their offsets changed. Unverified old keys stay intact.
  const notes = backup.notes.map((note) => {
    const anchor = note.anchor;
    if (anchor?.source !== 'translation') return note;
    const language = anchor.translationKey?.split(':')[0];
    if (!language || !anchor.translationKey?.startsWith(`${language}:${note.paragraphId}:`))
      return note;
    const text = byBookLanguage.get(JSON.stringify([note.bookId, language]))?.[note.paragraphId];
    const range = text ? resolveQuotedRange(text, note.quote, anchor.start) : null;
    if (!range) return note;
    return {
      ...note,
      anchor: {
        ...anchor,
        start: range.start,
        end: range.end,
        translationKey: portableTranslationKey(language, note.paragraphId),
      },
    };
  });
  const bookmarks = backup.bookmarks?.map((bookmark) => {
    if (bookmark.position.textSource !== 'translation') return bookmark;
    const language = bookmark.translationKey?.split(':')[0];
    const paragraph = bookmark.position.paragraph;
    if (!language || !bookmark.translationKey?.startsWith(`${language}:${paragraph}:`))
      return bookmark;
    const text = byBookLanguage.get(JSON.stringify([bookmark.bookId, language]))?.[paragraph];
    // Position quotes describe the exact visible point; the longer bookmark
    // excerpt is evidence only for older captures without a position quote.
    const quote = bookmark.position.textQuote || bookmark.quote;
    if (!text) return bookmark;
    const range = resolveQuotedRange(text, quote, bookmark.position.textOffset);
    if (!range) return bookmark;
    return {
      ...bookmark,
      translationKey: portableTranslationKey(language, paragraph),
      position: {
        ...bookmark.position,
        textOffset: range.start,
        textQuote: safeReadingQuote(text, range.start, Math.min(64, range.quote.length)),
        ...(bookmark.position.offset !== undefined ? { offset: range.start / text.length } : {}),
      },
    };
  });
  return {
    format: 'bypage-portable-library',
    version: 1,
    backup: { ...backup, notes, ...(bookmarks ? { bookmarks } : {}) },
    translations,
    ...(collections !== undefined ? { collections } : {}),
  };
}
