import {
  resolveQuotedRange,
  resolveSavedTranslationIdentity,
  safeReadingQuote,
  validateSavedTranslationVersion,
  type Book,
  type Paragraph,
  type Position,
} from '@bypage/reading-core';
import { readExactTranslation } from './database';
import type { LibraryLease } from './library-scope';

export type ReaderLocationReveal = {
  language: string;
  paragraph: string;
  key: string;
  text: string;
};
export type ReaderLocationOverride = {
  language: string;
  mode: 'original' | 'bilingual' | 'translation';
};
/** In-memory departure evidence. The caller also keeps its own preference/activation fence. */
export type ReaderLocationSnapshot = {
  bookId: string;
  position: Position;
  original: boolean;
  reveal: ReaderLocationReveal | null;
  /** Capture the actual display mode, including when it follows the global preferences. */
  readingOverride?: ReaderLocationOverride | null;
  language: string;
  /** Exact displayed identity, including for the default selected translation. */
  translationKey?: string;
};
export type ReaderLocationFallback =
  'preferences-changed' | 'translation-unavailable' | 'translation-changed' | 'invalid-anchor';
export type ResolvedReaderLocation = {
  position: Position;
  original: boolean;
  reveal: ReaderLocationReveal | null;
  readingOverride: ReaderLocationOverride | null;
  fallback?: ReaderLocationFallback;
};

const locations = new WeakMap<Book, Map<string, { chapter: number; paragraph: Paragraph }>>();
function paragraphLocation(book: Book, id: string) {
  let index = locations.get(book);
  if (!index) {
    index = new Map();
    book.chapters.forEach((chapter, chapterIndex) => {
      for (const paragraph of chapter.paragraphs)
        index!.set(paragraph.id, { chapter: chapterIndex, paragraph });
    });
    locations.set(book, index);
  }
  return index.get(id);
}

/**
 * Resolve a return point without selecting a translation or changing preferences.
 * Every exact lookup remains scoped to the caller's current library lease. IO
 * errors are left to the caller, so a failed read need not consume its return point.
 */
export async function resolveReaderLocation(
  library: LibraryLease,
  book: Book,
  snapshot: ReaderLocationSnapshot,
  options: {
    /** False after an explicit global language/mode change; old overrides must not win. */
    allowTranslation: boolean;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
  },
): Promise<ResolvedReaderLocation | null> {
  const check = () => {
    library.assertCurrent();
    if (options.signal?.aborted || (options.isCurrent && !options.isCurrent()))
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  if (snapshot.bookId !== book.id) return null;
  const entry = paragraphLocation(book, snapshot.position.paragraph);
  if (!entry) return null;
  const { chapter, paragraph } = entry;
  const farthest = Math.max(
    chapter,
    Number.isSafeInteger(snapshot.position.farthest)
      ? Math.min(book.chapters.length - 1, Math.max(0, snapshot.position.farthest))
      : chapter,
  );
  const positionAt = (
    text: string,
    start: number,
    source: 'original' | 'translation',
  ): Position => ({
    chapter,
    paragraph: paragraph.id,
    farthest,
    textSource: source,
    textOffset: start,
    textQuote: safeReadingQuote(text, start),
    offset: text.length ? start / text.length : 0,
  });
  const fallback = (reason: ReaderLocationFallback): ResolvedReaderLocation => ({
    position: positionAt(paragraph.text, 0, 'original'),
    original: true,
    reveal: null,
    readingOverride: null,
    fallback: reason,
  });
  const readReveal = async (
    key: string | undefined,
    paragraphId: string,
    capturedText?: string,
  ): Promise<{ reveal: ReaderLocationReveal | null; failure?: ReaderLocationFallback }> => {
    const identity = resolveSavedTranslationIdentity(book, key);
    if (
      !identity ||
      identity.paragraphId !== paragraphId ||
      identity.language !== snapshot.language
    )
      return { reveal: null, failure: 'translation-changed' };
    check();
    let exact: Awaited<ReturnType<typeof readExactTranslation>>;
    try {
      exact = await readExactTranslation(library.handle, book.id, identity.key);
      check();
      // The database validates against its current book. Also verify against the
      // immutable Book rendered by this reader before using its source identity.
      if (exact) exact = validateSavedTranslationVersion(book, exact);
    } catch (error) {
      check();
      if (error instanceof Error && error.message === 'invalid_saved_translation')
        return { reveal: null, failure: 'translation-changed' };
      throw error;
    }
    if (!exact) return { reveal: null, failure: 'translation-unavailable' };
    if (
      exact.bookId !== book.id ||
      exact.key !== identity.key ||
      exact.paragraphId !== paragraphId ||
      exact.language !== snapshot.language ||
      (capturedText !== undefined && capturedText !== exact.text)
    )
      return { reveal: null, failure: 'translation-changed' };
    check();
    return {
      reveal: {
        language: exact.language,
        paragraph: paragraphId,
        key: exact.key,
        text: exact.text,
      },
    };
  };

  const source = snapshot.position.textSource || 'original';
  const offset = snapshot.position.textOffset ?? 0;
  const quote = snapshot.position.textQuote;
  if (source === 'original') {
    const range = quote ? resolveQuotedRange(paragraph.text, quote, offset) : null;
    // A paragraph-start anchor also covers empty original paragraphs. Nonzero
    // offsets without evidence are never applied to potentially changed text.
    if (!range && (quote || offset !== 0)) return fallback('invalid-anchor');
    const resolved: ResolvedReaderLocation = {
      position: positionAt(paragraph.text, range?.start || 0, 'original'),
      original: options.allowTranslation ? snapshot.original : true,
      reveal: null,
      // A translation-only reader may have shown this original as a missing-text
      // fallback. Newly completed text must not hide the original return anchor.
      readingOverride: options.allowTranslation
        ? snapshot.readingOverride?.mode === 'translation'
          ? { language: snapshot.language, mode: 'bilingual' }
          : snapshot.readingOverride || null
        : null,
    };
    if (
      !options.allowTranslation ||
      snapshot.original ||
      snapshot.readingOverride?.mode === 'original'
    )
      return resolved;
    // The viewport can start in the original while showing an older translation
    // beside it, including one further down the same page. Restore that one
    // explicit override first; otherwise retain this paragraph's displayed key.
    // No translated offsets are involved in restoring the original anchor.
    const retained = snapshot.reveal?.language === snapshot.language ? snapshot.reveal : null;
    const key = retained?.key || snapshot.translationKey;
    if (!key) return resolved;
    const restored = await readReveal(key, retained?.paragraph || paragraph.id, retained?.text);
    if (!restored.reveal)
      return {
        ...resolved,
        original: true,
        readingOverride: null,
        fallback: restored.failure,
      };
    return {
      ...resolved,
      reveal: restored.reveal,
      readingOverride: {
        language: snapshot.language,
        mode: 'bilingual',
      },
    };
  }
  if (!options.allowTranslation) return fallback('preferences-changed');
  if (snapshot.original) return fallback('invalid-anchor');
  if (!quote || quote.length > 280) return fallback('invalid-anchor');
  const restored = await readReveal(snapshot.translationKey, paragraph.id);
  if (!restored.reveal) return fallback(restored.failure || 'translation-unavailable');
  const reveal = restored.reveal;
  const range = resolveQuotedRange(reveal.text, quote, offset);
  if (!range) return fallback('invalid-anchor');
  check();
  return {
    position: positionAt(reveal.text, range.start, 'translation'),
    original: false,
    reveal,
    readingOverride: {
      language: reveal.language,
      mode: snapshot.readingOverride?.mode === 'translation' ? 'translation' : 'bilingual',
    },
  };
}
