// Data-only recovery support: existing drafts remain exportable, but never execute.
import {
  effectiveBookLanguage,
  sha256,
  utf8,
  validSyncId,
  type Book,
  type Paragraph,
} from '@bypage/reading-core';
import { normalizeServerOrigin } from './server-origin';

export type TranslationDraftScope = {
  origin: string;
  accountId: string | null;
  contextKey: string;
  language: string;
  sourceLanguage: string;
};
export type TranslationDraftPart = { start: number; end: number; text: string };
export type TranslationDraft = {
  version: 1;
  bookId: string;
  paragraphId: string;
  scope: TranslationDraftScope;
  sourceHash: string;
  sourceLength: number;
  parts: TranslationDraftPart[];
  updatedAt: number;
};
const MAX_TRANSLATION = 100000;
const MAX_CHUNK = 8000;
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const languageTag = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z-]{2,20}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new Error('invalid_translation_draft');
};
function cleanScope(book: Book, value: unknown): TranslationDraftScope {
  if (
    !object(value) ||
    typeof value.origin !== 'string' ||
    value.origin.length > 2048 ||
    (value.accountId !== null && !validSyncId(value.accountId)) ||
    !digest(value.contextKey) ||
    !languageTag(value.language) ||
    typeof value.sourceLanguage !== 'string' ||
    value.sourceLanguage.length > 200 ||
    value.sourceLanguage !== effectiveBookLanguage(book)
  )
    return invalid();
  let origin: string;
  try {
    origin = normalizeServerOrigin(value.origin);
  } catch {
    return invalid();
  }
  if (!origin || origin !== value.origin) return invalid();
  return {
    origin,
    accountId: value.accountId as string | null,
    contextKey: value.contextKey,
    language: value.language,
    sourceLanguage: value.sourceLanguage,
  };
}

type Source = {
  paragraph: Paragraph;
  chapterIndex: number;
  path: string;
  hash: string;
};
const sourceIndexes = new WeakMap<Book, Map<string, Omit<Source, 'hash'> & { hash?: string }>>();
function sourceOf(book: Book, paragraphId: string): Source {
  let index = sourceIndexes.get(book);
  if (!index) {
    index = new Map();
    book.chapters.forEach((chapter, chapterIndex) => {
      chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
        index!.set(paragraph.id, {
          paragraph,
          chapterIndex,
          path: `$.chapters[${chapterIndex}].paragraphs[${paragraphIndex}]`,
        });
      });
    });
    sourceIndexes.set(book, index);
  }
  const source = index.get(paragraphId);
  if (!source?.paragraph.text.trim()) return invalid();
  source.hash ??= sha256(utf8(source.paragraph.text));
  return { ...source, hash: source.hash };
}

const scopeKey = (scope: TranslationDraftScope) =>
  sha256(
    utf8(
      JSON.stringify([
        scope.origin,
        scope.accountId,
        scope.contextKey,
        scope.language,
        scope.sourceLanguage,
      ]),
    ),
  );

/** Storage identity only; this does not authorize a request or resume a draft. */
export const translationDraftScopeKey = scopeKey;

function cleanParts(value: unknown, source: Source): TranslationDraftPart[] {
  if (!Array.isArray(value) || value.length > MAX_TRANSLATION) return invalid();
  let end = 0;
  let characters = 0;
  return value.map((part, index) => {
    if (
      !object(part) ||
      !Number.isSafeInteger(part.start) ||
      !Number.isSafeInteger(part.end) ||
      part.start !== end ||
      (part.end as number) <= end ||
      (part.end as number) > source.paragraph.text.length ||
      (part.end as number) - end > MAX_CHUNK ||
      typeof part.text !== 'string' ||
      !part.text.trim()
    )
      return invalid();
    end = part.end as number;
    // Chunk boundaries must not split a Unicode surrogate pair.
    if (
      end < source.paragraph.text.length &&
      /[\uD800-\uDBFF]/.test(source.paragraph.text[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(source.paragraph.text[end])
    )
      return invalid();
    characters += part.text.length + (index ? 2 : 0);
    if (characters > MAX_TRANSLATION) throw new Error('translation_too_large');
    return { start: part.start as number, end, text: part.text };
  });
}

function readDraft(
  value: unknown,
  book: Book,
  source: Source,
  scope: TranslationDraftScope,
): TranslationDraft {
  if (
    !object(value) ||
    value.version !== 1 ||
    value.bookId !== book.id ||
    value.paragraphId !== source.paragraph.id ||
    value.sourceHash !== source.hash ||
    value.sourceLength !== source.paragraph.text.length ||
    !Number.isSafeInteger(value.updatedAt) ||
    (value.updatedAt as number) < 0 ||
    scopeKey(cleanScope(book, value.scope)) !== scopeKey(scope)
  )
    return invalid();
  return {
    version: 1,
    bookId: book.id,
    paragraphId: source.paragraph.id,
    scope,
    sourceHash: source.hash,
    sourceLength: source.paragraph.text.length,
    parts: cleanParts(value.parts, source),
    updatedAt: value.updatedAt as number,
  };
}

/** Validate a recovery snapshot without consulting the current login or starting work. */
export function validateTranslationDraft(book: Book, value: unknown): TranslationDraft {
  if (!object(value) || typeof value.paragraphId !== 'string') return invalid();
  return readDraft(value, book, sourceOf(book, value.paragraphId), cleanScope(book, value.scope));
}

/** Drafts are deliberately separate from completed translations and portable exports. */
