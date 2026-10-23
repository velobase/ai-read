import type { NoteAnchor, Paragraph } from './types';
import { validSyncId } from './reading-validation';

export type SavedPassageTarget = { anchor?: NoteAnchor; quote?: string };
export type ResolvedSavedPassage = {
  source: 'original' | 'translation';
  start: number;
  end: number;
  quote: string;
  language?: string;
  translationKey?: string;
  /** The requested source could not be verified; the result is the original paragraph start. */
  fallback?: 'original' | 'translation';
};

const splitsSurrogatePair = (text: string, offset: number) =>
  offset > 0 &&
  offset < text.length &&
  text.charCodeAt(offset - 1) >= 0xd800 &&
  text.charCodeAt(offset - 1) <= 0xdbff &&
  text.charCodeAt(offset) >= 0xdc00 &&
  text.charCodeAt(offset) <= 0xdfff;

function safeOffset(text: string, offset: number, end = false): number {
  const bounded = Number.isSafeInteger(offset) ? Math.max(0, Math.min(text.length, offset)) : 0;
  return splitsSurrogatePair(text, bounded) ? bounded + (end ? 1 : -1) : bounded;
}

/** A short exact source quote, bounded in UTF-16 units without cutting a surrogate pair. */
export function safeReadingQuote(text: string, start: number, maxLength = 64): string {
  const at = safeOffset(text, start);
  const length = Number.isSafeInteger(maxLength) && maxLength >= 0 ? maxLength : 64;
  return text.slice(at, safeOffset(text, Math.min(text.length, at + length)));
}

/** Match an exact saved range, or relocate it only when the quote occurs once. */
export function resolveQuotedRange(
  text: string,
  quote: string,
  preferredStart?: number,
): { start: number; end: number; quote: string } | null {
  if (!quote.length) return null;
  const matches = (start: number) => {
    const end = start + quote.length;
    return (
      Number.isSafeInteger(start) &&
      start >= 0 &&
      end <= text.length &&
      !splitsSurrogatePair(text, start) &&
      !splitsSurrogatePair(text, end) &&
      text.slice(start, end) === quote
    );
  };
  if (preferredStart !== undefined && matches(preferredStart))
    return { start: preferredStart, end: preferredStart + quote.length, quote };
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + 1) >= 0 || !matches(start)) return null;
  return { start, end: start + quote.length, quote };
}

/**
 * Resolve a saved passage against immutable original text or an exact cached
 * translation key. The caller scopes that cache to this book; a language-only
 * lookup must not be used to impersonate another translation edition.
 */
export function resolveSavedPassage(
  paragraph: Pick<Paragraph, 'id' | 'text'>,
  target: SavedPassageTarget,
  readTranslation: (exactKey: string) => string | null | undefined = () => undefined,
): ResolvedSavedPassage {
  const anchor = target.anchor;
  const source = anchor?.source || 'original';
  const fallback = (): ResolvedSavedPassage => {
    const quote = safeReadingQuote(paragraph.text, 0);
    return { source: 'original', start: 0, end: quote.length, quote, fallback: source };
  };
  if (source === 'translation') {
    const key = anchor?.translationKey;
    const language = key?.split(':')[0];
    if (
      !validSyncId(key) ||
      !language ||
      !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language) ||
      !key.startsWith(`${language}:${paragraph.id}:`) ||
      !target.quote
    )
      return fallback();
    const text = readTranslation(key);
    const range =
      typeof text === 'string' ? resolveQuotedRange(text, target.quote, anchor?.start) : null;
    return range ? { source, ...range, language, translationKey: key } : fallback();
  }
  if (target.quote) {
    const range = resolveQuotedRange(paragraph.text, target.quote, anchor?.start);
    return range ? { source, ...range } : fallback();
  }
  // Explicit original-text search ranges have no saved quote. Clamp only those
  // trusted source offsets; missing translation evidence never takes this path.
  const start = safeOffset(paragraph.text, anchor?.start ?? 0);
  const end = Math.max(start, safeOffset(paragraph.text, anchor?.end ?? start, true));
  return { source: 'original', start, end, quote: paragraph.text.slice(start, end) };
}
