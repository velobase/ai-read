import { Pressable, Text, View } from 'react-native';
import type { Book, BookReferenceLink, BookReferenceTarget } from '@bypage/reading-core';
import { referencePreview, type ReadingReference } from '../adapters/book-references';
import { useApp } from '../context';
import { Button, Sheet } from './ui';

export function ReferenceListSheet({
  references,
  visible = true,
  onShow,
  onDismiss,
  open,
  close,
}: {
  references: ReadingReference[];
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  open: (reference: ReadingReference) => void;
  close: () => void;
}) {
  const { colors, t } = useApp();
  return (
    <Sheet
      visible={visible}
      onShow={onShow}
      onDismiss={onDismiss}
      title={t('bookReferences')}
      close={close}
    >
      {references.map((reference, index) => (
        <Pressable
          key={`${reference.id}:${reference.origin.paragraph}`}
          accessibilityRole="button"
          onPress={() => open(reference)}
          style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderColor: colors.border }}
        >
          <Text style={{ color: colors.accent, fontSize: 16, lineHeight: 24 }}>
            {index + 1}. {reference.label}
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

export function ReferencePreviewSheet({
  book,
  target,
  label,
  kind,
  visible = true,
  onShow,
  onDismiss,
  read,
  close,
}: {
  book: Book;
  target: BookReferenceTarget;
  label: string;
  kind: BookReferenceLink['kind'];
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  read?: () => void;
  close: () => void;
}) {
  const { colors, preferences, t } = useApp();
  return (
    <Sheet
      visible={visible}
      onShow={onShow}
      onDismiss={onDismiss}
      title={t(kind === 'footnote' ? 'bookFootnote' : 'bookReferences')}
      close={close}
      tall
    >
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <View style={{ gap: 16 }}>
        {referencePreview(book, target).map((paragraph, index) => (
          <Text
            key={index}
            style={{
              color: colors.ink,
              fontSize: preferences.fontSize,
              lineHeight: preferences.fontSize * preferences.lineHeight,
              fontFamily:
                paragraph.kind === 'code' ? 'Menlo' : preferences.serif ? 'Georgia' : undefined,
              fontWeight: paragraph.kind === 'heading' ? '600' : '400',
              fontStyle: paragraph.kind === 'quote' ? 'italic' : 'normal',
              writingDirection: book.pageDirection === 'rtl' ? 'rtl' : 'auto',
            }}
          >
            {paragraph.text}
          </Text>
        ))}
      </View>
      {read && (
        <Button secondary icon="book-outline" onPress={read}>
          {t('bookReferenceRead')}
        </Button>
      )}
    </Sheet>
  );
}
