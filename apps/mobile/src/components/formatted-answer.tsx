import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../context';

// Reading answers are text, never executable HTML. Keep source IDs untouched so
// citation buttons can continue to match the original model response.
export const FormattedAnswer = memo(function FormattedAnswer({ text }: { text: string }) {
  const { colors } = useApp();
  const blocks = useMemo(() => text.split(/\n\s*\n/), [text]);
  return (
    <View style={{ gap: 12 }}>
      {blocks.map((block, index) => {
        const heading = /^#{1,6}\s+/.test(block);
        const quote = /^>\s?/.test(block);
        const content = (
          heading ? block.replace(/^#{1,6}\s+/, '') : block.replace(/^>\s?/gm, '')
        ).replace(/^(\s*)[-*+]\s+/gm, '$1• ');
        const spans = content.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
        return (
          <Text
            key={index}
            selectable
            style={{
              color: colors.ink,
              lineHeight: 27,
              fontSize: heading ? 17 : 16,
              fontWeight: heading ? '600' : '400',
              ...(quote ? { borderLeftWidth: 2, borderColor: colors.accent, paddingLeft: 12 } : {}),
            }}
          >
            {spans.map((span, part) =>
              span.startsWith('**') && span.endsWith('**') ? (
                <Text key={part} style={{ fontWeight: '600' }}>
                  {span.slice(2, -2)}
                </Text>
              ) : span.startsWith('`') && span.endsWith('`') ? (
                <Text key={part} style={{ fontFamily: 'Menlo', fontSize: 14 }}>
                  {span.slice(1, -1)}
                </Text>
              ) : (
                span
              ),
            )}
          </Text>
        );
      })}
    </View>
  );
});
