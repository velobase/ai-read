import {
  TRANSLATION_SOURCE_SCHEME,
  translationChapterFingerprint,
  type TranslationSourceScheme,
} from './translation-source';
import { resolveTranslationKey } from './translation-key';
import { sha256, utf8 } from './book-media';
import { validSyncId } from './reading-validation';
import type { Book } from './types';

export const MAX_SAVED_TRANSLATION_CHARACTERS = 100000;
export type SavedTranslationKind = 'saved' | 'portable' | 'published' | 'legacy';
export type SavedTranslationIdentity = {
  key: string;
  language: string;
  paragraphId: string;
  version: string;
  kind: SavedTranslationKind;
};
export type SavedTranslationVersion = {
  version: 1;
  bookId: string;
  key: string;
  language: string;
  paragraphId: string;
  kind: SavedTranslationKind;
  chapterIndex: number;
  sourceScheme: TranslationSourceScheme;
  /** Canonical chapter fingerprint, not legacy Web sourceHash or native draft sourceHash. */
  sourceFingerprint: string;
  text: string;
  /** SHA-256 of the exact text's UTF-8 bytes, without JSON quoting or trimming. */
  textHash: string;
  createdAt: number;
};

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const languageTag = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 30 &&
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value);
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new Error('invalid_saved_translation');
};
const locations = new WeakMap<
  Book,
  {
    ids: Set<string>;
    chapterByParagraph: Map<string, number>;
    fingerprints: Map<number, string>;
  }
>();
function sourceIndex(book: Book) {
  let index = locations.get(book);
  if (!index) {
    const chapterByParagraph = new Map<string, number>();
    book.chapters.forEach((chapter, chapterIndex) => {
      for (const paragraph of chapter.paragraphs) {
        if (chapterByParagraph.has(paragraph.id)) invalid();
        chapterByParagraph.set(paragraph.id, chapterIndex);
      }
    });
    index = {
      ids: new Set(chapterByParagraph.keys()),
      chapterByParagraph,
      fingerprints: new Map(),
    };
    locations.set(book, index);
  }
  return index;
}

/** Caller supplies a newly generated UUID; this helper has no randomness or side effects. */
export function savedTranslationKey(
  language: string,
  paragraphId: string,
  versionId: string,
): string {
  if (!languageTag(language) || !paragraphId || !uuid(versionId)) return invalid();
  const key = `${language}:${paragraphId}:saved-${versionId}`;
  // Existing notes/bookmarks allow at most 200 key characters. Never truncate an ID.
  if (!validSyncId(key)) throw new Error('saved_translation_key_unrepresentable');
  const resolved = resolveTranslationKey(key, new Set([paragraphId]));
  if (!resolved || resolved.language !== language || resolved.paragraphId !== paragraphId)
    return invalid();
  return key;
}

/** Resolve against actual paragraph IDs, including IDs containing colons. */
export function resolveSavedTranslationIdentity(
  book: Book,
  key: unknown,
): SavedTranslationIdentity | null {
  const resolved = resolveTranslationKey(key, sourceIndex(book).ids);
  if (!resolved || !languageTag(resolved.language)) return null;
  const version = resolved.version;
  let kind: SavedTranslationKind;
  if (version.startsWith('saved-')) {
    if (!uuid(version.slice('saved-'.length))) return null;
    kind = 'saved';
  } else if (version === 'portable-v1') kind = 'portable';
  else if (version.startsWith('edition-')) kind = 'published';
  else kind = 'legacy';
  return { key: key as string, ...resolved, kind };
}

/**
 * Validate against an already validated, immutable local Book. This proves content
 * compatibility only; it grants no permission and cannot authenticate a published edition.
 */
export function validateSavedTranslationVersion(
  book: Book,
  value: unknown,
): SavedTranslationVersion {
  if (!object(value) || value.version !== 1 || value.bookId !== book.id) return invalid();
  const identity = resolveSavedTranslationIdentity(book, value.key);
  if (
    !identity ||
    identity.language !== value.language ||
    identity.paragraphId !== value.paragraphId ||
    identity.kind !== value.kind ||
    !Number.isSafeInteger(value.chapterIndex) ||
    value.sourceScheme !== TRANSLATION_SOURCE_SCHEME ||
    !digest(value.sourceFingerprint) ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    value.text.length > MAX_SAVED_TRANSLATION_CHARACTERS ||
    !digest(value.textHash) ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    (value.createdAt as number) > 8640000000000000
  )
    return invalid();
  const index = sourceIndex(book);
  const chapterIndex = index.chapterByParagraph.get(identity.paragraphId)!;
  if (value.chapterIndex !== chapterIndex) return invalid();
  let fingerprint = index.fingerprints.get(chapterIndex);
  if (!fingerprint) {
    fingerprint = translationChapterFingerprint(book.chapters[chapterIndex]);
    index.fingerprints.set(chapterIndex, fingerprint);
  }
  if (value.sourceFingerprint !== fingerprint || value.textHash !== sha256(utf8(value.text)))
    return invalid();
  return {
    version: 1,
    bookId: book.id,
    key: identity.key,
    language: identity.language,
    paragraphId: identity.paragraphId,
    kind: identity.kind,
    chapterIndex,
    sourceScheme: TRANSLATION_SOURCE_SCHEME,
    sourceFingerprint: fingerprint,
    text: value.text,
    textHash: value.textHash,
    createdAt: value.createdAt as number,
  };
}

/** Inputs must already be validated; callers keep the first version's creation metadata. */
export function assertSameSavedTranslationVersion(
  existing: SavedTranslationVersion,
  incoming: SavedTranslationVersion,
): void {
  if (existing.bookId !== incoming.bookId || existing.key !== incoming.key)
    throw new Error('saved_translation_identity_mismatch');
  if (
    existing.version !== incoming.version ||
    existing.language !== incoming.language ||
    existing.paragraphId !== incoming.paragraphId ||
    existing.kind !== incoming.kind ||
    existing.chapterIndex !== incoming.chapterIndex ||
    existing.sourceScheme !== incoming.sourceScheme ||
    existing.sourceFingerprint !== incoming.sourceFingerprint ||
    existing.textHash !== incoming.textHash ||
    existing.text !== incoming.text
  )
    throw new Error('saved_translation_immutable_conflict');
}

/** A display choice, separate from immutable saved text and note/bookmark references. */
export type SavedTranslationSelection = {
  bookId: string;
  language: string;
  paragraphId: string;
  key: string;
};

/** Versions are already validated and indexed by their exact key for this book. */
export function validateSavedTranslationSelection(
  book: Book,
  value: unknown,
  versions: ReadonlyMap<string, SavedTranslationVersion>,
): SavedTranslationSelection {
  if (!object(value) || value.bookId !== book.id) return invalid();
  const identity = resolveSavedTranslationIdentity(book, value.key);
  if (
    !identity ||
    identity.language !== value.language ||
    identity.paragraphId !== value.paragraphId
  )
    return invalid();
  const target = versions.get(identity.key);
  if (
    !target ||
    target.bookId !== book.id ||
    target.language !== identity.language ||
    target.paragraphId !== identity.paragraphId ||
    target.key !== identity.key
  )
    return invalid();
  return {
    bookId: book.id,
    language: identity.language,
    paragraphId: identity.paragraphId,
    key: identity.key,
  };
}
