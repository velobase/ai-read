import { normalizeSearch, type Position, type ReadingScopeParagraph } from '@bypage/reading-core';
import type { ReadingSource } from '@bypage/api-client';
import type { PassageSelection } from '../components/passage';

export type EvidenceSource = ReadingSource & { chapterIndex: number; start: number };
export type ReadingEvidence = {
  sources: EvidenceSource[];
  totalParagraphs: number;
  partial: boolean;
};
const MAX_CHARACTERS = 16000;
const MAX_PARAGRAPH_CHARACTERS = 4000;
const MAX_SOURCES = 200;

const splitsSurrogate = (text: string, offset: number) =>
  offset > 0 &&
  offset < text.length &&
  text.charCodeAt(offset - 1) >= 0xd800 &&
  text.charCodeAt(offset - 1) <= 0xdbff &&
  text.charCodeAt(offset) >= 0xdc00 &&
  text.charCodeAt(offset) <= 0xdfff;

export function validEvidenceSelection(selection: PassageSelection): boolean {
  return (
    Number.isSafeInteger(selection.start) &&
    Number.isSafeInteger(selection.end) &&
    selection.start >= 0 &&
    selection.end > selection.start &&
    selection.end <= selection.text.length &&
    !splitsSurrogate(selection.text, selection.start) &&
    !splitsSurrogate(selection.text, selection.end)
  );
}

/** Keep a complete original selection inside the bounded source, without changing its offsets. */
export function originalEvidenceWindow(
  text: string,
  selection?: Pick<PassageSelection, 'start' | 'end'>,
  limit = MAX_PARAGRAPH_CHARACTERS,
): { start: number; text: string } {
  let start = 0;
  if (selection && selection.end - selection.start <= limit) {
    const leading = Math.min(800, limit - (selection.end - selection.start));
    start = Math.max(0, Math.min(text.length - limit, selection.start - leading));
    // Drop one context character rather than include half of it. A valid selection
    // itself starts at a UTF-16 boundary, so this never advances past its start.
    if (splitsSurrogate(text, start)) start++;
  }
  let end = Math.min(text.length, start + limit);
  if (splitsSurrogate(text, end)) end--;
  if (selection && end < selection.end) {
    start = selection.start;
    end = Math.min(text.length, start + limit);
    if (splitsSurrogate(text, end)) end--;
  }
  return { start, text: text.slice(start, end) };
}

function queryTerms(value: string) {
  const text = normalizeSearch(value);
  const words = text.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  const stop = new Set([
    'the',
    'and',
    'that',
    'this',
    'with',
    'from',
    'what',
    'does',
    'here',
    'have',
    'about',
    'which',
  ]);
  return [
    ...new Set([
      ...words.filter((word) => !stop.has(word)),
      ...cjk.flatMap((word) => {
        const chars = Array.from(word);
        return chars.slice(1).map((char, index) => chars[index] + char);
      }),
    ]),
  ].slice(0, 120);
}

/** Scope has already been resolved at real paragraph boundaries, including PDF chapters. */
export async function readingEvidence(
  entries: ReadingScopeParagraph[],
  position: Position,
  focus: PassageSelection,
  question: string,
  signal: AbortSignal,
): Promise<ReadingEvidence> {
  const check = () => {
    if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  const fullSize = entries.reduce((sum, entry) => sum + entry.paragraph.text.length, 0);
  const fits =
    fullSize <= MAX_CHARACTERS &&
    entries.length <= MAX_SOURCES &&
    entries.every((entry) => entry.paragraph.text.length <= MAX_PARAGRAPH_CHARACTERS);
  let ranked = entries.map((entry) => ({ ...entry, score: 0 }));
  if (!fits) {
    const terms = queryTerms(question);
    const selected = entries.findIndex((entry) => entry.paragraph.id === focus.paragraph.id);
    let characters = 0;
    for (const [index, entry] of ranked.entries()) {
      check();
      const text = normalizeSearch(entry.paragraph.text);
      entry.score =
        (index === selected ? 10000 : selected >= 0 && Math.abs(index - selected) <= 2 ? 60 : 0) +
        (entry.chapterIndex === position.chapter ? 2 : 0) +
        terms.reduce((sum, term) => sum + Number(text.includes(term)) * 5, 0);
      characters += text.length;
      if (index % 80 === 79 || characters >= 64000) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        characters = 0;
      }
    }
    ranked.sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);
  }
  let remaining = MAX_CHARACTERS;
  const chosen: { source: EvidenceSource; ordinal: number; complete: boolean }[] = [];
  for (const entry of ranked) {
    check();
    if (remaining <= 0 || chosen.length >= MAX_SOURCES) break;
    const paragraph = entry.paragraph;
    const { start, text } = originalEvidenceWindow(
      paragraph.text,
      paragraph.id === focus.paragraph.id && focus.source === 'original' ? focus : undefined,
      Math.min(remaining, MAX_PARAGRAPH_CHARACTERS),
    );
    if (!text) continue;
    remaining -= text.length;
    chosen.push({
      source: {
        id: paragraph.id,
        chapter: entry.chapter.slice(0, 200),
        chapterIndex: entry.chapterIndex,
        start,
        text,
      },
      ordinal: entry.ordinal,
      complete: start === 0 && text.length === paragraph.text.length,
    });
  }
  chosen.sort((a, b) => a.ordinal - b.ordinal);
  return {
    sources: chosen.map((item) => item.source),
    totalParagraphs: entries.length,
    partial: chosen.length < entries.length || chosen.some((item) => !item.complete),
  };
}
