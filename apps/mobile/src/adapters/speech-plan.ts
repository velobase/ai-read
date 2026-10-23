import { readingScopeParagraphs, type Book, type Position } from '@bypage/reading-core';
import type { PassageSelection } from '../components/passage';

export type SpeechScope = 'selection' | 'paragraph' | 'chapter';
export type SpeechSource = 'original' | 'translation';
export type SpeechChunk = {
  text: string;
  /** Absolute UTF-16 offsets in the segment's full source text. */
  start: number;
  end: number;
};
export type SpeechSegment = {
  paragraphId: string;
  chapterIndex: number;
  chapterTitle: string;
  /** Full original or cached translated text; never normalized for speech. */
  text: string;
  source: SpeechSource;
  language?: string;
  translationKey?: string;
  startOffset: number;
  /** Exclusive UTF-16 boundary, including when speech resumes after backgrounding. */
  endOffset: number;
  chunks: SpeechChunk[];
};
export type SpeechMissing = Pick<SpeechSegment, 'paragraphId' | 'chapterIndex' | 'chapterTitle'>;
export type SpeechPlan = {
  /** Only the uninterrupted readable prefix, stopping before the first missing translation. */
  segments: SpeechSegment[];
  totalParagraphs: number;
  /** Missing translations in the entire requested suffix, not just the first gap. */
  missingCount: number;
  firstMissing: SpeechMissing | null;
  /** An explicit selection no longer matches the requested source or saved text. */
  selectionUnavailable?: boolean;
};
export type SpeechPlanOptions = {
  book: Book;
  position: Pick<Position, 'chapter' | 'paragraph' | 'textOffset' | 'textSource'>;
  scope: SpeechScope;
  source: SpeechSource;
  translations: Record<string, string>;
  translationKeys: Record<string, string>;
  sourceLanguage: string;
  targetLanguage: string;
  /** Only applied by the explicit selection scope, never by paragraph/chapter scopes. */
  selection?: PassageSelection | null;
};

export const MAX_SPEECH_CHUNK = 3000;
const highSurrogate = (value: number) => value >= 0xd800 && value <= 0xdbff;
const lowSurrogate = (value: number) => value >= 0xdc00 && value <= 0xdfff;

function safeOffset(text: string, offset: number): number {
  let at = Number.isSafeInteger(offset) ? Math.max(0, Math.min(text.length, offset)) : 0;
  // An anchor inside a surrogate pair includes the whole character rather than
  // dropping its leading half or sending malformed UTF-16 to the system voice.
  if (at > 0 && lowSurrogate(text.charCodeAt(at)) && highSurrogate(text.charCodeAt(at - 1))) at--;
  return at;
}

/** Preserve every source character; only choose boundaries, never trim or replace text. */
export function speechChunks(
  text: string,
  startOffset = 0,
  endOffset = text.length,
): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const limit = safeOffset(text, endOffset);
  let start = safeOffset(text, startOffset);
  while (start < limit) {
    let end = safeOffset(text, Math.min(limit, start + MAX_SPEECH_CHUNK));
    if (end < limit) {
      const window = text.slice(start, end);
      // Prefer a nearby sentence boundary. The lower bound prevents a very
      // early full stop from turning a long passage into many tiny utterances.
      const minimum = Math.floor(window.length / 2);
      let boundary = 0;
      const sentence = /[。！？]+[”’"'」』）》】]*\s*|[.!?]+[”’"')\]]*(?:\s+|$)/gu;
      for (const match of window.matchAll(sentence)) {
        const next = match.index + match[0].length;
        if (next >= minimum) boundary = next;
      }
      if (!boundary)
        for (const match of window.matchAll(/\s+/gu)) {
          const next = match.index + match[0].length;
          if (next >= minimum) boundary = next;
        }
      if (boundary) end = start + boundary;
    }
    chunks.push({ text: text.slice(start, end), start, end });
    start = end;
  }
  return chunks;
}

function speechLanguage(value: string): string | undefined {
  const tag = value.trim().replace(/_/g, '-');
  if (!tag || ['auto', 'und'].includes(tag.toLowerCase())) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/** Freeze a reading range without changing book text, reading progress or translation state. */
export function buildSpeechPlan({
  book,
  position,
  scope,
  source,
  translations,
  translationKeys,
  sourceLanguage,
  targetLanguage,
  selection,
}: SpeechPlanOptions): SpeechPlan {
  const result: SpeechPlan = {
    segments: [],
    totalParagraphs: 0,
    missingCount: 0,
    firstMissing: null,
    ...(scope === 'selection' ? { selectionUnavailable: true } : {}),
  };
  // Never guess a chapter start for a stale or foreign paragraph anchor.
  if (
    !Number.isInteger(position.chapter) ||
    !book.chapters[position.chapter]?.paragraphs.some((p) => p.id === position.paragraph)
  )
    return result;
  const chapter = readingScopeParagraphs(
    book,
    { chapter: position.chapter, paragraph: position.paragraph, farthest: position.chapter },
    'chapter',
  );
  const start = chapter.findIndex(
    (entry) => entry.chapterIndex === position.chapter && entry.paragraph.id === position.paragraph,
  );
  if (start < 0) return result;
  if (scope === 'selection') {
    const paragraph = chapter[start].paragraph;
    const text = source === 'translation' ? translations[paragraph.id] : paragraph.text;
    // A selection belongs to one exact source snapshot. Do not use its offsets
    // with a replacement translation, another language or a different paragraph.
    if (
      !selection ||
      selection.paragraph.id !== paragraph.id ||
      selection.paragraph.text !== paragraph.text ||
      selection.source !== source ||
      (source === 'translation' &&
        (selection.language !== targetLanguage ||
          !selection.translationKey ||
          selection.translationKey !== translationKeys[paragraph.id])) ||
      typeof text !== 'string' ||
      selection.text !== text ||
      !Number.isSafeInteger(selection.start) ||
      !Number.isSafeInteger(selection.end) ||
      selection.start < 0 ||
      selection.end <= selection.start ||
      selection.end > text.length ||
      safeOffset(text, selection.start) !== selection.start ||
      safeOffset(text, selection.end) !== selection.end
    )
      return result;
    result.selectionUnavailable = false;
  }
  const entries = scope === 'chapter' ? chapter.slice(start) : chapter.slice(start, start + 1);
  const language = speechLanguage(source === 'translation' ? targetLanguage : sourceLanguage);
  result.totalParagraphs = entries.length;
  for (const [index, entry] of entries.entries()) {
    const location: SpeechMissing = {
      paragraphId: entry.paragraph.id,
      chapterIndex: entry.chapterIndex,
      chapterTitle: entry.chapter,
    };
    const text = source === 'translation' ? translations[entry.paragraph.id] : entry.paragraph.text;
    if (
      source === 'translation' &&
      (typeof text !== 'string' || !text.trim() || !translationKeys[entry.paragraph.id])
    ) {
      result.missingCount++;
      result.firstMissing ??= location;
      continue;
    }
    if (result.firstMissing) continue;
    const startOffset = safeOffset(
      text,
      scope === 'selection'
        ? selection!.start
        : index === 0 && (position.textSource || 'original') === source
          ? (position.textOffset ?? 0)
          : 0,
    );
    const endOffset = scope === 'selection' ? selection!.end : text.length;
    result.segments.push({
      ...location,
      text,
      source,
      ...(language ? { language } : {}),
      ...(source === 'translation' ? { translationKey: translationKeys[entry.paragraph.id] } : {}),
      startOffset,
      endOffset,
      chunks: speechChunks(text, startOffset, endOffset),
    });
  }
  return result;
}
