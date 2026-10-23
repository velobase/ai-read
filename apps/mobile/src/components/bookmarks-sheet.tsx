import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import type { Book, Bookmark } from '@bypage/reading-core';
import { useApp } from '../context';
import { Button, Chip, IconButton, Sheet, styles } from './ui';
export type BookmarkFeedback = { message: string; error?: boolean };

export function BookmarksSheet({
  book,
  bookmarks,
  visible,
  onShow,
  onDismiss,
  loading,
  saving,
  close,
  add,
  open,
  rename,
  remove,
}: {
  book: Book;
  bookmarks: Bookmark[];
  visible: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  loading: boolean;
  saving: boolean;
  close: () => void;
  add: () => Promise<BookmarkFeedback | undefined>;
  open: (bookmark: Bookmark) => void;
  rename: (bookmark: Bookmark, label: string) => Promise<void>;
  remove: (bookmark: Bookmark) => Promise<void>;
}) {
  const { colors, t } = useApp();
  const [order, setOrder] = useState<'position' | 'newest'>('position');
  const [limit, setLimit] = useState(60);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<(BookmarkFeedback & { id?: string }) | null>(null);
  const visibility = useRef(0);
  useEffect(() => {
    visibility.current++;
    if (!visible) {
      setEditing(null);
      setLimit(60);
      setStatus(null);
    }
  }, [visible]);
  const paragraphOrder = useMemo(
    () =>
      new Map(
        book.chapters
          .flatMap((chapter) => chapter.paragraphs)
          .map((paragraph, index) => [paragraph.id, index]),
      ),
    [book],
  );
  const sorted = useMemo(
    () =>
      [...bookmarks].sort((a, b) =>
        order === 'newest'
          ? b.createdAt - a.createdAt || a.id.localeCompare(b.id)
          : (paragraphOrder.get(a.position.paragraph) || 0) -
              (paragraphOrder.get(b.position.paragraph) || 0) ||
            (a.position.textOffset || 0) - (b.position.textOffset || 0) ||
            a.createdAt - b.createdAt,
      ),
    [bookmarks, order, paragraphOrder],
  );
  const errorMessage = (error: unknown) =>
    t(
      error instanceof Error &&
        (error.message === 'bookmark_changed' || error.message === 'bookmark_missing')
        ? 'bookmarkChanged'
        : 'error',
    );
  const change = async (id: string, action: () => Promise<void>, success: string) => {
    if (busy) return;
    const token = visibility.current;
    setBusy(id);
    setStatus(null);
    try {
      await action();
      if (token === visibility.current) {
        setEditing(null);
        setStatus({ message: success });
      }
    } catch (error) {
      if (token === visibility.current)
        setStatus({ message: errorMessage(error), error: true, id });
    } finally {
      setBusy(null);
    }
  };
  const feedback = (value: BookmarkFeedback) => (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        color: value.error ? colors.error : colors.accent,
        backgroundColor: colors.soft,
        borderRadius: 10,
        padding: 12,
        fontSize: 13,
        lineHeight: 20,
      }}
    >
      {value.message}
    </Text>
  );
  const addCurrent = async () => {
    const token = visibility.current;
    setStatus(null);
    try {
      const result = await add();
      if (result && token === visibility.current) setStatus(result);
    } catch (error) {
      if (token === visibility.current) setStatus({ message: errorMessage(error), error: true });
    }
  };
  return (
    <Sheet
      tall
      visible={visible}
      onShow={onShow}
      onDismiss={onDismiss}
      title={t('bookmarks')}
      close={close}
    >
      <Button
        icon="bookmark-outline"
        busy={saving}
        disabled={loading || !!busy}
        onPress={() => void addCurrent()}
      >
        {t('bookmarkAdd')}
      </Button>
      {status &&
        (!status.id || !bookmarks.some((bookmark) => bookmark.id === status.id)) &&
        feedback(status)}
      {bookmarks.length > 1 && (
      <View style={{ flexDirection: 'row' }}>
        <Chip
          active={order === 'position'}
          onPress={() => {
            setOrder('position');
            setLimit(60);
          }}
        >
          {t('bookmarkSortPosition')}
        </Chip>
        <Chip
          active={order === 'newest'}
          onPress={() => {
            setOrder('newest');
            setLimit(60);
          }}
        >
          {t('bookmarkSortNewest')}
        </Chip>
      </View>
      )}
      {loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : !bookmarks.length ? (
        <Text style={{ color: colors.muted, paddingVertical: 28, textAlign: 'center' }}>
          {t('bookmarksEmpty')}
        </Text>
      ) : null}
      {sorted.slice(0, limit).map((bookmark) => (
        <View
          key={bookmark.id}
          style={{
            borderBottomWidth: 0.5,
            borderColor: colors.border,
            paddingVertical: 12,
            gap: 8,
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={!!busy || saving}
            onPress={() => open(bookmark)}
            style={{ gap: 6, minHeight: 44 }}
          >
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>
              {bookmark.label || book.chapters[bookmark.position.chapter]?.title || book.title}
            </Text>
            {!!bookmark.quote && (
              <Text numberOfLines={3} style={{ color: colors.ink, fontSize: 14, lineHeight: 21 }}>
                {bookmark.quote}
              </Text>
            )}
            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {book.chapters[bookmark.position.chapter]?.title} ·{' '}
              {t(bookmark.position.textSource === 'translation' ? 'translation' : 'original')}
              {bookmark.translationKey ? ` · ${bookmark.translationKey.split(':')[0]}` : ''}
            </Text>
          </Pressable>
          {editing?.id === bookmark.id ? (
            <View style={{ gap: 8 }}>
              <TextInput
                autoFocus
                accessibilityLabel={t('bookmarkLabel')}
                placeholder={t('bookmarkLabel')}
                placeholderTextColor={colors.muted}
                value={label}
                maxLength={120}
                onChangeText={setLabel}
                style={[styles.input, { color: colors.ink, backgroundColor: colors.soft }]}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  busy={busy === bookmark.id}
                  onPress={() =>
                    void change(bookmark.id, () => rename(editing, label.trim()), t('saved'))
                  }
                >
                  {t('save')}
                </Button>
                <Button secondary disabled={!!busy} onPress={() => setEditing(null)}>
                  {t('cancel')}
                </Button>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <IconButton
                icon="pencil-outline"
                label={t('bookmarkRename')}
                disabled={!!busy || saving}
                onPress={() => {
                  setLabel(bookmark.label);
                  setEditing(bookmark);
                  setStatus(null);
                }}
              />
              <IconButton
                icon="trash-outline"
                label={t('bookmarkDelete')}
                disabled={!!busy || saving}
                onPress={() =>
                  Alert.alert(t('bookmarkDelete'), bookmark.label || bookmark.quote, [
                    { text: t('cancel'), style: 'cancel' },
                    {
                      text: t('delete'),
                      style: 'destructive',
                      onPress: () =>
                        void change(bookmark.id, () => remove(bookmark), t('bookmarkDeleted')),
                    },
                  ])
                }
              />
            </View>
          )}
          {status?.id === bookmark.id && feedback(status)}
        </View>
      ))}
      {sorted.length > limit && (
        <Button secondary onPress={() => setLimit((count) => count + 60)}>
          {t('more')}
        </Button>
      )}
    </Sheet>
  );
}
