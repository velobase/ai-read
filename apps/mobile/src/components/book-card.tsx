import { useEffect, useState } from 'react';
import { getBookCover } from '../adapters/database';
import { Image, Pressable, Text, View } from 'react-native';
import type { Book } from '@bypage/reading-core';
import type { ShelfBook } from '../adapters/database';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Icon, IconButton } from './ui';

type CoverBook = Pick<Book, 'id' | 'title'> & Partial<Pick<Book, 'author' | 'cover' | 'sample'>>;
/** Use book metadata when the edition has no cover image. */
export function Cover({ book, width = 64 }: { book: CoverBook; width?: number }) {
  const { colors } = useApp();
  const library = useLibrary();
  const identity = JSON.stringify([library.handle.key, library.epoch, book.id]);
  const [loadedCover, setLoadedCover] = useState<{ identity: string; uri: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (library.isCurrent() && !book.cover && !book.sample)
      void getBookCover(library.handle, book.id)
        .then((uri) => {
          if (active && library.isCurrent() && uri) setLoadedCover({ identity, uri });
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [library, identity, book.id, book.cover, book.sample]);
  const cover = book.cover || (loadedCover?.identity === identity ? loadedCover.uri : undefined);
  const height = width * 1.45;
  return (
    <View
      accessible={false}
      style={{
        width,
        height,
        borderRadius: 3,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      {cover && /^data:image\/(png|jpeg|webp);base64,/.test(cover) ? (
        <Image
          source={{ uri: cover }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <View style={{ flex: 1, paddingHorizontal: width * 0.12, paddingVertical: height * 0.12 }}>
          <Text
            allowFontScaling={false}
            numberOfLines={6}
            style={{
              color: colors.ink,
              fontFamily: /[\u3400-\u9fff]/.test(book.title) ? 'SongtiSC-Regular' : 'Georgia',
              fontSize:
                width * (book.title.length > 40 ? 0.115 : book.title.length > 22 ? 0.14 : 0.18),
              lineHeight: width * (book.title.length > 22 ? 0.19 : 0.25),
            }}
          >
            {book.title}
          </Text>
          {!!book.author && (
            <Text
              allowFontScaling={false}
              numberOfLines={2}
              style={{ color: colors.muted, fontSize: width * 0.07, marginTop: 'auto' }}
            >
              {book.author}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
export function BookTile({
  book,
  width,
  open,
  more,
  selection,
  selected,
}: {
  book: ShelfBook;
  width: number;
  open: () => void;
  more: () => void;
  selection?: boolean;
  selected?: boolean;
}) {
  const { colors, t } = useApp();
  return (
    <View style={{ width, marginBottom: 26 }}>
      <Pressable
        onPress={open}
        onLongPress={more}
        accessibilityRole="button"
        accessibilityLabel={`${book.title}, ${t('progress', { n: Math.round(book.progress * 100) })}`}
        accessibilityState={{ selected }}
      >
        <Cover book={book} width={width} />
        {selection && (
          <View
            style={{
              position: 'absolute',
              right: 7,
              top: 7,
              backgroundColor: colors.surface,
              borderRadius: 15,
            }}
          >
            <Icon
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              color={selected ? colors.accent : colors.muted}
              size={24}
            />
          </View>
        )}
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: colors.ink, fontSize: 12 }}>
          {book.title}
        </Text>
        {!selection && (
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${t('more')}: ${book.title}`}
            onPress={more}
            style={{ paddingLeft: 4, paddingVertical: 5 }}
          >
            <Icon name="ellipsis-horizontal" size={15} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
        {book.finished
          ? t('finished')
          : book.lastOpened || book.hasPosition
            ? t('progress', { n: Math.round(book.progress * 100) })
            : book.author}
      </Text>
    </View>
  );
}
export function BookCard({
  book,
  open,
  more,
}: {
  book: ShelfBook;
  open: () => void;
  more: () => void;
}) {
  const { colors, t } = useApp();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 15,
        gap: 14,
        borderBottomWidth: 0.5,
        borderColor: colors.border,
      }}
    >
      <Pressable
        onPress={open}
        accessibilityRole="button"
        style={{ flex: 1, flexDirection: 'row', gap: 14, alignItems: 'center' }}
      >
        <Cover book={book} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 16, fontWeight: '500' }}>
            {book.title}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{book.author}</Text>
        </View>
      </Pressable>
      <IconButton icon="ellipsis-horizontal" label={t('more')} onPress={more} />
    </View>
  );
}
