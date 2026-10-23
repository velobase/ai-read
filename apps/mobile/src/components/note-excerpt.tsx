import { useMemo } from 'react';
import { Text } from 'react-native';
import { excerptMatch, safeReadingQuote } from '@bypage/reading-core';
import { useApp } from '../context';

/** A bounded preview shared by the reader notebook and the library's notes. */
export function NoteExcerpt({
  text,
  query,
  thought = false,
}: {
  text: string;
  query: string;
  thought?: boolean;
}) {
  const { colors } = useApp();
  const match = useMemo(() => excerptMatch(text, query), [text, query]);
  const preview = match?.excerpt || safeReadingQuote(text, 0, 240);
  return (
    <Text
      numberOfLines={match ? undefined : thought ? 3 : 4}
      style={{
        color: thought ? colors.muted : colors.ink,
        fontSize: thought ? 14 : 15,
        lineHeight: 24,
      }}
    >
      {match ? (
        <>
          {preview.slice(0, match.matchStart)}
          <Text style={{ backgroundColor: colors.highlight, color: colors.ink, fontWeight: '600' }}>
            {preview.slice(match.matchStart, match.matchEnd)}
          </Text>
          {preview.slice(match.matchEnd)}
        </>
      ) : (
        preview + (preview.length < text.length ? '…' : '')
      )}
    </Text>
  );
}
