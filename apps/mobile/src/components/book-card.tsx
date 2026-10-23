import { useEffect, useState } from 'react';
import { getBookCover } from '../adapters/database';
import { Image, Pressable, Text, View } from 'react-native';
import { catalog, effectiveBookLanguage, type Book } from '@bypage/reading-core';
import type { ShelfBook } from '../adapters/database';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Icon, IconButton } from './ui';

type CoverBook = Pick<Book, 'id' | 'title'> &
  Partial<Pick<Book, 'author' | 'subtitle' | 'cover' | 'language' | 'sourceLanguage' | 'sample'>>;
const coverColors = [
  ['#263f45', '#eee8d5'],
  ['#e9a74a', '#473d2b'],
  ['#b94837', '#ffebd4'],
  ['#dedcd3', '#354442'],
  ['#d7dcbf', '#385c4f'],
  ['#8da9b7', '#f8f2de'],
];
/** The same six cover treatments and original catalog as the mobile web library. */
export function Cover({
  book,
  large = false,
  width: suppliedWidth,
}: {
  book: CoverBook;
  large?: boolean;
  width?: number;
}) {
  const { t } = useApp();
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
  const width = suppliedWidth || (large ? 104 : 64);
  const known = catalog.findIndex((b) => b.id === book.id);
  const variant =
    known >= 0 ? known : Array.from(book.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 6;
  const [background, ink] = coverColors[variant];
  const height = width * 1.45;
  return (
    <View
      accessible={false}
      style={{
        width,
        height,
        borderRadius: 2,
        backgroundColor: background,
        shadowColor: '#172030',
        shadowOpacity: 0.16,
        shadowOffset: { width: 1, height: 3 },
        shadowRadius: 4,
      }}
    >
      <View
        style={{
          flex: 1,
          overflow: 'hidden',
          borderRadius: 2,
          borderLeftWidth: 3,
          borderLeftColor: '#00000015',
        }}
      >
        {cover && /^data:image\/(png|jpeg|webp);base64,/.test(cover) ? (
          <Image
            source={{ uri: cover }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <>
            {variant === 0 &&
              [0, 1].map((i) => (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    width: width * 1.6,
                    height: height * 0.44,
                    borderWidth: 0.7,
                    borderColor: i ? '#e4c78e55' : '#e4c78e99',
                    borderRadius: width,
                    bottom: height * (0.06 + i * 0.06),
                    left: -width * 0.3,
                    transform: [{ rotate: '-25deg' }],
                  }}
                />
              ))}
            {variant === 1 && (
              <View
                style={{
                  position: 'absolute',
                  width: width * 0.9,
                  height: height * 0.45,
                  borderRadius: width / 2,
                  backgroundColor: '#f9e5bb',
                  bottom: -height * 0.05,
                  left: width * 0.15,
                  transform: [{ rotate: '-20deg' }],
                }}
              />
            )}
            {variant === 2 && (
              <View
                style={{
                  position: 'absolute',
                  width: width * 0.65,
                  height: height * 0.26,
                  borderRadius: width,
                  borderWidth: width * 0.1,
                  borderColor: '#f5d4a930',
                  bottom: height * 0.08,
                  right: -width * 0.04,
                }}
              />
            )}
            {variant === 3 &&
              [0, 1].map((i) => (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    width: width * 1.1,
                    height: height * 0.15,
                    backgroundColor: i ? '#a4bbb1' : '#5e8d8b',
                    bottom: height * (0.13 + i * 0.12),
                    left: -width * 0.1,
                    transform: [{ rotate: i ? '10deg' : '-12deg' }],
                  }}
                />
              ))}
            {variant === 4 &&
              Array.from({ length: 9 }, (_, i) => (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    top: (i * height) / 9,
                    width: '100%',
                    height: 1,
                    backgroundColor: '#64794d19',
                  }}
                />
              ))}
            {variant === 5 && (
              <View
                style={{
                  position: 'absolute',
                  width: width * 0.55,
                  height: width * 0.55,
                  borderRadius: width,
                  backgroundColor: '#e7d28c',
                  bottom: height * 0.13,
                  right: -width * 0.1,
                }}
              />
            )}
            <View
              style={{
                flex: 1,
                paddingHorizontal: width * 0.1,
                paddingTop: height * 0.08,
                paddingBottom: height * 0.15,
              }}
            >
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={{
                  color: ink,
                  opacity: 0.6,
                  fontSize: width * 0.043,
                  letterSpacing: width * 0.009,
                }}
              >
                {book.sample
                  ? 'BYPAGE ORIGINALS'
                  : book.language
                    ? effectiveBookLanguage({
                        language: book.language,
                        sourceLanguage: book.sourceLanguage,
                      }).toUpperCase()
                    : 'BYPAGE'}
              </Text>
              <Text
                allowFontScaling={false}
                numberOfLines={5}
                style={{
                  color: ink,
                  fontFamily: /[\u3400-\u9fff]/.test(book.title) ? 'SongtiSC-Regular' : 'Georgia',
                  fontSize:
                    width * (book.title.length > 40 ? 0.115 : book.title.length > 22 ? 0.14 : 0.18),
                  lineHeight: width * (book.title.length > 22 ? 0.18 : 0.25),
                  marginTop: height * 0.09,
                }}
              >
                {book.title}
              </Text>
              {!!book.subtitle && (
                <Text
                  allowFontScaling={false}
                  numberOfLines={2}
                  style={{
                    color: ink,
                    opacity: 0.8,
                    fontSize: width * 0.055,
                    lineHeight: width * 0.09,
                    marginTop: height * 0.06,
                  }}
                >
                  {book.subtitle}
                </Text>
              )}
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={{ color: ink, opacity: 0.7, fontSize: width * 0.05, marginTop: 'auto' }}
              >
                {book.sample ? t('originals') : book.author}
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              style={{
                position: 'absolute',
                bottom: height * 0.04,
                width: '100%',
                textAlign: 'center',
                color: ink,
                opacity: 0.5,
                fontSize: width * 0.038,
                letterSpacing: 1,
              }}
            >
              B Y P A G E
            </Text>
          </>
        )}
      </View>
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
        {book.finished && (
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: 0,
              backgroundColor: '#00000080',
              padding: 4,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 9 }}>{t('finished')}</Text>
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
        {book.lastOpened || book.hasPosition
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
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {t('progress', { n: Math.round(book.progress * 100) })}
          </Text>
        </View>
      </Pressable>
      <IconButton icon="ellipsis-horizontal" label={t('more')} onPress={more} />
    </View>
  );
}
