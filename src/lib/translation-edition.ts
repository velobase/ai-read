import type { Book, Chapter, Settings } from './types';
import { effectiveTranslationPrompt } from './translation-prompt';

export const TRANSLATION_PIPELINE = 'chapter-v1';
export type TranslationProfile = Pick<Settings, 'baseUrl' | 'model' | 'translationPrompt'>;
export type Term = { source: string; target: string };
export type TranslationSegment = { id: string; paragraphId: string; text: string; kind: string };
export type TranslationChunk = { segments: TranslationSegment[]; context: string };
export type ChunkResult = { segments: { id: string; text: string }[]; terms: Term[] };
export type ChapterState = 'missing' | 'queued' | 'running' | 'ready' | 'error';
export type ChapterProgress = {
  index: number;
  sourceHash: string;
  state: ChapterState;
  completedChunks: number;
  totalChunks: number;
  error?: string;
};
export type TranslationEdition = {
  id: string;
  bookId: string;
  language: string;
  sourceHash: string;
  profile: TranslationProfile;
  state: 'idle' | 'active' | 'paused' | 'error';
  chapters: ChapterProgress[];
  createdAt: number;
  error?: string;
};
export type TranslationManifest = { selectedId: string | null; editions: TranslationEdition[] };
export type ChapterTranslation = {
  editionId: string;
  bookId: string;
  index: number;
  sourceHash: string;
  paragraphs: Record<string, string>;
};
export type TranslationInput = {
  title: string;
  chapter: string;
  language: string;
  bookLanguage: string;
  outline: string;
  chunk: TranslationChunk;
  terms: Term[];
  previous: string;
};

export function translationProfile(settings: TranslationProfile): TranslationProfile {
  return {
    baseUrl: settings.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
    model: settings.model,
    translationPrompt: effectiveTranslationPrompt(settings.translationPrompt),
  };
}
export async function contentHash(value: unknown) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function translationSource(book: Book) {
  const chapters = await Promise.all(book.chapters.map((c) => contentHash(c)));
  return { chapters, hash: await contentHash([TRANSLATION_PIPELINE, book.language, chapters]) };
}

// Split only exceptionally long paragraphs. Every UTF-16 character belongs to
// exactly one segment; only reference context is bounded/truncated.
function splitText(text: string, limit = 5000) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const prefix = rest.slice(0, limit);
    let end = Math.max(
      prefix.lastIndexOf('\n'),
      prefix.lastIndexOf('. '),
      prefix.lastIndexOf('。'),
    );
    if (end < limit / 2) end = prefix.lastIndexOf(' ');
    end = end < limit / 2 ? limit : end + 1;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) parts.push(rest);
  return parts;
}
export function planChapter(chapter: Chapter): TranslationChunk[] {
  const segments = chapter.paragraphs.flatMap((p) =>
    splitText(p.text).map((text, index) => ({
      id: `${p.id}~${index}`,
      paragraphId: p.id,
      text,
      kind: p.kind,
    })),
  );
  const groups: TranslationSegment[][] = [];
  let group: TranslationSegment[] = [],
    size = 0;
  for (const segment of segments) {
    // Prefer section boundaries; keep normal paragraphs together in one call.
    if (
      group.length &&
      (size + segment.text.length > 12000 ||
        (segment.kind === 'heading' && size >= 4000) ||
        group.length >= 80)
    ) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(segment);
    size += segment.text.length;
  }
  if (group.length) groups.push(group);
  const entire = chapter.paragraphs.map((p) => p.text).join('\n\n');
  return groups.map((segments, index) => ({
    segments,
    context:
      entire.length <= 28000
        ? entire
        : [
            chapter.paragraphs
              .filter((p) => p.kind === 'heading')
              .map((p) => p.text)
              .join('\n')
              .slice(0, 3000),
            groups[index - 1]
              ?.map((p) => p.text)
              .join('\n')
              .slice(-4000) || '',
            groups[index + 1]
              ?.map((p) => p.text)
              .join('\n')
              .slice(0, 4000) || '',
          ].join('\n\n'),
  }));
}
export function validateChunk(value: unknown, chunk: TranslationChunk): ChunkResult {
  if (!value || typeof value !== 'object') throw new Error('译文格式不完整，请重试。');
  const raw = value as ChunkResult;
  if (!Array.isArray(raw.segments) || raw.segments.length !== chunk.segments.length)
    throw new Error('译文缺少段落，尚未发布。');
  const segments = chunk.segments.map((source, i) => {
    const result = raw.segments[i];
    if (
      !result ||
      result.id !== source.id ||
      typeof result.text !== 'string' ||
      !result.text.trim() ||
      result.text.length > 100000
    )
      throw new Error('译文段落顺序或内容不完整，尚未发布。');
    return { id: source.id, text: source.kind === 'code' ? source.text : result.text.trim() };
  });
  const terms = Array.isArray(raw.terms)
    ? raw.terms
        .filter(
          (t) =>
            t &&
            typeof t.source === 'string' &&
            typeof t.target === 'string' &&
            t.source.trim() &&
            t.target.trim() &&
            t.source.length < 120 &&
            t.target.length < 160,
        )
        .slice(0, 20)
    : [];
  return { segments, terms };
}
export function mergeTerms(existing: Term[], added: Term[]) {
  const map = new Map(existing.map((t) => [t.source.toLowerCase(), t]));
  for (const t of added) if (!map.has(t.source.toLowerCase())) map.set(t.source.toLowerCase(), t);
  return [...map.values()].slice(0, 120);
}
export function assembleChapter(
  chapter: Chapter,
  chunks: TranslationChunk[],
  results: ChunkResult[],
) {
  if (results.length !== chunks.length) throw new Error('章节尚未完整翻译。');
  const pieces = new Map<string, string[]>();
  chunks.forEach((chunk, i) => {
    const result = validateChunk(results[i], chunk);
    chunk.segments.forEach((segment, n) => {
      const values = pieces.get(segment.paragraphId) || [];
      values.push(result.segments[n].text);
      pieces.set(segment.paragraphId, values);
    });
  });
  return Object.fromEntries(
    chapter.paragraphs.map((p) => {
      const text = pieces.get(p.id)?.join('\n');
      if (!text?.trim()) throw new Error('译文缺少段落，尚未发布。');
      return [p.id, text];
    }),
  );
}
export function chunkInput(
  book: Book,
  index: number,
  language: string,
  chunk: TranslationChunk,
  terms: Term[],
  previous?: ChunkResult,
): TranslationInput {
  return {
    title: book.title,
    chapter: book.chapters[index].title,
    language,
    bookLanguage: book.language,
    outline: book.chapters
      .map((c) => c.title)
      .join('\n')
      .slice(0, 4000),
    chunk,
    terms,
    previous:
      previous?.segments
        .map((p) => p.text)
        .join('\n')
        .slice(-4000) || '',
  };
}
export const editionNoteKey = (language: string, paragraph: string, edition: string) =>
  `${language}:${paragraph}:edition-${edition}`;
