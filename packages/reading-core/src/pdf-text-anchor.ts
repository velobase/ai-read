import type { Book } from './types';
import { isPdfBook } from './pdf-toc';

/** Original PDF text, not the query. Empty context means the actual page boundary. */
export type PdfTextEvidence = { quote: string; before: string; after: string };
export type PdfTextAnchor = {
  chapter: number;
  paragraph: string;
  start: number;
  end: number;
  /** Exact UTF-16 slice of the first matched reflowed paragraph, at most 280 units. */
  quote: string;
};

const MAX_PAGE_TEXT = 1024 * 1024;
const MAX_NORMALIZED_TEXT = MAX_PAGE_TEXT * 2;
const MAX_PARAGRAPHS = 4096;
const MAX_CANDIDATES = 1024;
const canonical = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/\u00ad/gu, '')
    .replace(/\s+/gu, ' ');
const splitsPair = (text: string, at: number) =>
  at > 0 &&
  at < text.length &&
  text.charCodeAt(at - 1) >= 0xd800 &&
  text.charCodeAt(at - 1) <= 0xdbff &&
  text.charCodeAt(at) >= 0xdc00 &&
  text.charCodeAt(at) <= 0xdfff;
function wellFormed(text: string) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
type MappedText = { text: string; starts: Int32Array; ends: Int32Array };

/** Bounded typed arrays avoid one JS object for every UTF-16 unit on a large page. */
function mappedText(raw: string): MappedText | null {
  let capacity = Math.max(32, raw.length);
  let starts = new Int32Array(capacity),
    ends = new Int32Array(capacity),
    length = 0,
    whitespace = false,
    chunk = '';
  const chunks: string[] = [];
  // Keep combining marks with their base when NFKC composes or reorders them.
  // Any composition spanning these conservative clusters is rejected below.
  for (const match of raw.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const start = match.index!;
    const end = start + match[0].length;
    for (const unit of match[0].normalize('NFKC').replace(/\u00ad/gu, '')) {
      const space = /\s/u.test(unit);
      if (space && whitespace) {
        ends[length - 1] = end;
        continue;
      }
      const value = space ? ' ' : unit;
      const required = length + value.length;
      if (required > MAX_NORMALIZED_TEXT) return null;
      if (required > capacity) {
        capacity = Math.min(MAX_NORMALIZED_TEXT, Math.max(required, capacity * 2));
        const nextStarts = new Int32Array(capacity),
          nextEnds = new Int32Array(capacity);
        nextStarts.set(starts);
        nextEnds.set(ends);
        starts = nextStarts;
        ends = nextEnds;
      }
      for (let index = 0; index < value.length; index++) {
        starts[length] = start;
        ends[length++] = end;
      }
      chunk += value;
      if (chunk.length >= 4096) {
        chunks.push(chunk);
        chunk = '';
      }
      whitespace = space;
    }
  }
  chunks.push(chunk);
  const text = chunks.join('');
  // For example, unusual Hangul Jamo composition can span two base clusters.
  // Never invent offsets when the mapping differs from whole-string NFKC.
  return text === canonical(raw) ? { text, starts, ends } : null;
}

function wholeBoundary(mapped: MappedText, start: number, end: number) {
  return (
    start >= 0 &&
    end > start &&
    end <= mapped.text.length &&
    (start === 0 || mapped.ends[start - 1] <= mapped.starts[start]) &&
    (end === mapped.text.length || mapped.ends[end - 1] <= mapped.starts[end])
  );
}

/**
 * Match complete, adjacent evidence only on its physical PDF page. This is not
 * fuzzy search: removed headers, reordered columns, missing context or ambiguous
 * matches return null so callers can retain their explicit page-start fallback.
 */
export function resolvePdfTextEvidence(
  book: Book,
  physicalPage: number,
  evidence: PdfTextEvidence,
): PdfTextAnchor | null {
  if (
    !isPdfBook(book) ||
    !Number.isSafeInteger(physicalPage) ||
    physicalPage < 1 ||
    physicalPage > 1000 ||
    !evidence ||
    typeof evidence.quote !== 'string' ||
    !evidence.quote.trim() ||
    evidence.quote.length > 640 ||
    typeof evidence.before !== 'string' ||
    evidence.before.length > 80 ||
    typeof evidence.after !== 'string' ||
    evidence.after.length > 80 ||
    ![evidence.quote, evidence.before, evidence.after].every(wellFormed)
  )
    return null;

  const evidenceText = evidence.before + evidence.quote + evidence.after;
  const proof = mappedText(evidenceText);
  if (!proof?.text.trim()) return null;
  const quoteStart = evidence.before.length,
    quoteEnd = quoteStart + evidence.quote.length;
  let from = -1,
    to = -1;
  for (let index = 0; index < proof.text.length; index++) {
    if (proof.ends[index] <= quoteStart || proof.starts[index] >= quoteEnd) continue;
    // A match cannot claim only part of a composed character/ligature or a
    // whitespace span shared with context outside the selected original range.
    if (proof.starts[index] < quoteStart || proof.ends[index] > quoteEnd) return null;
    if (from < 0) from = index;
    to = index + 1;
  }
  if (from < 0 || !proof.text.slice(from, to).trim() || !wholeBoundary(proof, from, to))
    return null;

  const spans: { chapter: number; paragraph: string; text: string; start: number; end: number }[] =
    [];
  const pieces: string[] = [];
  let length = 0;
  for (const [chapter, item] of book.chapters.entries()) {
    if (item.sourcePage !== physicalPage) continue;
    for (const paragraph of item.paragraphs) {
      if (spans.length >= MAX_PARAGRAPHS || typeof paragraph.text !== 'string') return null;
      if (pieces.length) length++;
      const start = length;
      length += paragraph.text.length;
      if (length > MAX_PAGE_TEXT || !wellFormed(paragraph.text)) return null;
      spans.push({ chapter, paragraph: paragraph.id, text: paragraph.text, start, end: length });
      pieces.push(paragraph.text);
    }
  }
  if (!pieces.length) return null;
  const page = mappedText(pieces.join('\n'));
  if (!page) return null;
  let selected: { start: number; end: number } | null = null,
    candidates = 0;
  for (
    let index = page.text.indexOf(proof.text);
    index >= 0;
    index = page.text.indexOf(proof.text, index + 1)
  ) {
    if (++candidates > MAX_CANDIDATES) return null;
    const start = index + from,
      end = index + to;
    if (
      (!evidence.before && index !== 0) ||
      (!evidence.after && index + proof.text.length !== page.text.length) ||
      !wholeBoundary(page, index, index + proof.text.length) ||
      !wholeBoundary(page, start, end)
    )
      continue;
    if (selected) return null;
    selected = { start: page.starts[start], end: page.ends[end - 1] };
  }
  if (!selected) return null;
  for (const span of spans) {
    const start = Math.max(selected.start, span.start) - span.start;
    let end = Math.min(selected.end, span.end) - span.start;
    if (start >= end || !span.text.slice(start, end).trim()) continue;
    end = Math.min(end, start + 280);
    if (splitsPair(span.text, end)) end--;
    if (end <= start || splitsPair(span.text, start)) return null;
    return {
      chapter: span.chapter,
      paragraph: span.paragraph,
      start,
      end,
      quote: span.text.slice(start, end),
    };
  }
  return null;
}
