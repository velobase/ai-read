import { Text } from 'react-native';
import type { Note, Paragraph } from '@bypage/reading-core';
import { useApp } from '../context';

export type PassageSelection = {
  paragraph: Paragraph;
  source: 'original' | 'translation';
  text: string;
  start: number;
  end: number;
  language?: string;
  translationKey?: string;
};
export type PassageRange = { start: number; end: number };
export type PassageLink = PassageRange & { id: string; label: string };

export function passageRanges(
  notes: Note[],
  paragraph: string,
  text: string,
  source: PassageSelection['source'],
  translationKey?: string,
): PassageRange[] {
  const ranges: PassageRange[] = [];
  for (const note of notes) {
    if (note.paragraphId !== paragraph || !note.quote) continue;
    const anchor = note.anchor;
    if (anchor) {
      if (anchor.source !== source || text.slice(anchor.start, anchor.end) !== note.quote) continue;
      if (source === 'translation' && (!translationKey || anchor.translationKey !== translationKey))
        continue;
      ranges.push({ start: anchor.start, end: anchor.end });
    } else {
      const start = text.indexOf(note.quote);
      if (start >= 0 && text.indexOf(note.quote, start + 1) < 0)
        ranges.push({ start, end: start + note.quote.length });
    }
  }
  return ranges;
}

export function HighlightedPassage({
  text,
  ranges,
  offset = 0,
  links = [],
  onLink,
  onLinkLongPress,
}: {
  text: string;
  ranges: PassageRange[];
  offset?: number;
  links?: PassageLink[];
  onLink?: (link: PassageLink) => void;
  onLinkLongPress?: () => void;
}) {
  const { colors } = useApp();
  const merged: PassageRange[] = [];
  for (const range of ranges
    .map(({ start, end }) => ({
      start: Math.max(0, start - offset),
      end: Math.min(text.length, end - offset),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  const visibleLinks = links
    .map((link) => ({
      link,
      start: Math.max(0, link.start - offset),
      end: Math.min(text.length, link.end - offset),
    }))
    .filter(({ start, end }) => end > start);
  if (visibleLinks.length && onLink) {
    const boundaries = [
      ...new Set([
        0,
        text.length,
        ...merged.flatMap((range) => [range.start, range.end]),
        ...visibleLinks.flatMap((link) => [link.start, link.end]),
      ]),
    ].sort((a, b) => a - b);
    return (
      <>
        {boundaries.slice(0, -1).map((start, index) => {
          const end = boundaries[index + 1];
          const link = visibleLinks.find((entry) => entry.start <= start && entry.end >= end)?.link;
          const highlighted = merged.some((range) => range.start <= start && range.end >= end);
          return (
            <Text
              key={start}
              style={{
                ...(highlighted ? { backgroundColor: colors.highlight } : {}),
                ...(link ? { color: colors.accent, textDecorationLine: 'underline' as const } : {}),
              }}
              accessibilityRole={link ? 'link' : undefined}
              onPress={
                link
                  ? (event) => {
                      event.stopPropagation();
                      onLink(link);
                    }
                  : undefined
              }
              onLongPress={
                link
                  ? (event) => {
                      event.stopPropagation();
                      onLinkLongPress?.();
                    }
                  : undefined
              }
            >
              {text.slice(start, end)}
            </Text>
          );
        })}
      </>
    );
  }
  if (!merged.length) return <>{text}</>;
  const pieces = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) pieces.push(text.slice(cursor, range.start));
    pieces.push(
      <Text key={range.start} style={{ backgroundColor: colors.highlight }}>
        {text.slice(range.start, range.end)}
      </Text>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}
