import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { fetch as nativeFetch } from 'expo/fetch';
import type { Book } from '@bypage/reading-core';
import {
  downloadStoreBook,
  type StoreBook,
  type StoreCatalog,
} from '../../../../packages/reading-core/src/storefront';
import { apiOrigin } from '../adapters/server-origin';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Cover } from './book-card';
import { Button, Chip, IconButton } from './ui';

export function Storefront({
  downloaded,
  open,
  savedIds,
}: {
  downloaded: (book: Book) => Promise<void>;
  open: (id: string) => void;
  savedIds: string[];
}) {
  const { colors, preferences } = useApp(),
    zh = preferences.locale === 'zh-CN';
  const library = useLibrary();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 350 || fontScale > 1.3 ? 2 : width > 700 ? 4 : 3;
  const coverWidth = (Math.min(width, 900) - 44 - (columns - 1) * 18) / columns;
  const [data, setData] = useState<StoreCatalog | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<StoreBook | null>(null),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [collection, setCollection] = useState('');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [downloadError, setDownloadError] = useState('');
  const download = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void nativeFetch(`${apiOrigin}/api/catalog`, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
        const value = await response.json();
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error('catalog.load', error);
          setError(
            zh
              ? '暂时无法连接书城，已下载的书仍可离线阅读。'
              : 'Unable to connect. Downloaded books are still available offline.',
          );
        }
      });
    return () => controller.abort();
  }, [attempt, zh]);
  useEffect(() => () => download.current?.abort(), [library]);
  async function getBook(entry: StoreBook) {
    if (busy || !library.isCurrent()) return;
    if (savedIds.includes(entry.editionId)) {
      setSelected(null);
      open(entry.editionId);
      return;
    }
    const controller = new AbortController();
    download.current = controller;
    const abort = () => controller.abort();
    library.signal.addEventListener('abort', abort, { once: true });
    setBusy(true);
    setProgress(0);
    setDownloadError('');
    try {
      const response = await nativeFetch(
        `${apiOrigin}/api/catalog/${entry.slug}/download?edition=${entry.editionId}`,
        { signal: controller.signal, credentials: 'omit', redirect: 'error' },
      );
      const book = await downloadStoreBook(entry, response as unknown as Response, setProgress);
      if (!controller.signal.aborted && library.isCurrent()) {
        await downloaded(book);
        setSelected(null);
      }
    } catch (error) {
      console.error('catalog.download', { slug: entry.slug }, error);
      if (!controller.signal.aborted && library.isCurrent())
        setDownloadError(
          zh
            ? '下载未完成，请重试。若书目已更新，请刷新书城。'
            : 'Download failed. Retry, or refresh the bookstore if the edition changed.',
        );
    } finally {
      library.signal.removeEventListener('abort', abort);
      if (download.current === controller) {
        download.current = null;
        setBusy(false);
      }
    }
  }
  const collectionEntry = data?.collections.find((c) => c.id === collection);
  const books = (
    data?.books.filter(
      (b) =>
        (!category || b.category === category) &&
        (!collection || b.collectionIds.includes(collection)) &&
        `${b.title} ${b.author}`.toLowerCase().includes(query.trim().toLowerCase()),
    ) || []
  ).sort((a, b) =>
    collectionEntry
      ? collectionEntry.items.findIndex((i) => i.bookId === a.id) -
        collectionEntry.items.findIndex((i) => i.bookId === b.id)
      : 0,
  );
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 7 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 23, fontWeight: '600', color: colors.ink }}
        >
          {zh ? '免费经典书城' : 'The classics, yours to read'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
          {zh
            ? '完整原文 · 下载后离线阅读 · 登录即可翻译'
            : 'Complete editions · Offline reading · Sign in to translate'}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={zh ? '搜索书城' : 'Search bookstore'}
        placeholder={zh ? '搜索书名或作者' : 'Search title or author'}
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        style={{
          backgroundColor: colors.surface,
          color: colors.ink,
          borderRadius: 12,
          padding: 14,
          fontSize: 14,
        }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {['', ...new Set(data?.books.map((b) => b.category))].map((c) => (
          <Chip key={c} active={category === c} onPress={() => setCategory(c)}>
            {c || (zh ? '全部' : 'All')}
          </Chip>
        ))}
      </ScrollView>
      {!!data?.collections.length && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          <Chip active={!collection} onPress={() => setCollection('')}>
            {zh ? '全部书单' : 'All collections'}
          </Chip>
          {data.collections.map((c) => (
            <Chip key={c.id} active={collection === c.id} onPress={() => setCollection(c.id)}>
              {c.title}
            </Chip>
          ))}
        </ScrollView>
      )}
      {error ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
          <Button secondary onPress={() => setAttempt((n) => n + 1)}>
            {zh ? '重试' : 'Retry'}
          </Button>
        </View>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : !books.length ? (
        <Text style={{ color: colors.muted }}>{zh ? '没有符合条件的书' : 'No matching books'}</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 26 }}>
          {books.map((book) => (
            <Pressable
              key={book.id}
              accessibilityRole="button"
              accessibilityLabel={`${book.title}, ${zh ? '免费' : 'free'}`}
              onPress={() => {
                setSelected(book);
                setDownloadError('');
              }}
              style={{ width: coverWidth, gap: 7 }}
            >
              <Cover
                book={{ ...book, cover: book.cover ? `${apiOrigin}${book.cover}` : undefined }}
                width={coverWidth}
              />
              <Text
                numberOfLines={2}
                style={{ color: colors.ink, fontSize: 12, fontWeight: '600', lineHeight: 17 }}
              >
                {book.title}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>
                {book.author}
              </Text>
              <Text style={{ color: colors.accent, fontSize: 10 }}>
                {savedIds.includes(book.editionId)
                  ? zh
                    ? '已下载'
                    : 'Downloaded'
                  : zh
                    ? '免费 · 完整版'
                    : 'Free · Complete'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          download.current?.abort();
          setSelected(null);
        }}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ alignItems: 'flex-end', padding: 12 }}>
            <IconButton
              icon="close"
              label={zh ? '关闭' : 'Close'}
              onPress={() => {
                download.current?.abort();
                setSelected(null);
              }}
            />
          </View>
          {selected && (
            <ScrollView contentContainerStyle={{ padding: 24, gap: 20, paddingBottom: 60 }}>
              <View style={{ alignItems: 'center', gap: 16 }}>
                <Cover
                  book={{
                    ...selected,
                    cover: selected.cover ? `${apiOrigin}${selected.cover}` : undefined,
                  }}
                  width={145}
                />
                <Text
                  accessibilityRole="header"
                  style={{
                    color: colors.ink,
                    fontSize: 25,
                    textAlign: 'center',
                    fontWeight: '600',
                  }}
                >
                  {selected.title}
                </Text>
                <Text style={{ color: colors.muted }}>{selected.author}</Text>
              </View>
              <Text style={{ color: colors.ink, lineHeight: 25 }}>{selected.description}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {selected.chapterCount} {zh ? '个章节' : 'chapters'} ·{' '}
                {(selected.byteLength / 1048576).toFixed(1)} MB · {selected.language}
              </Text>
              {downloadError && (
                <Text accessibilityRole="alert" style={{ color: colors.error }}>
                  {downloadError}
                </Text>
              )}
              <Button icon="download-outline" busy={busy} onPress={() => void getBook(selected)}>
                {busy
                  ? `${zh ? '下载中' : 'Downloading'} ${Math.round(progress * 100)}%`
                  : savedIds.includes(selected.editionId)
                    ? zh
                      ? '打开书籍'
                      : 'Open book'
                    : zh
                      ? '免费下载并打开'
                      : 'Download & open'}
              </Button>
              <View
                style={{ backgroundColor: colors.surface, padding: 18, gap: 8, borderRadius: 12 }}
              >
                <Text style={{ color: colors.ink, fontWeight: '600' }}>
                  {zh ? '登录即可翻译' : 'Sign in to translate'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 22 }}>
                  {zh
                    ? '下载后，在书籍详情的「翻译准备」中开始翻译。支持双语对照，已完成的译文保存在本地。'
                    : 'After downloading, use Translation preparation in book details. Read side by side; completed translations are saved on your device.'}
                </Text>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}
