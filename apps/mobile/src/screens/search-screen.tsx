import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { bookSourceLanguages, normalizeSearch } from '@bypage/reading-core';
import type { ShelfBook } from '../adapters/database';
import { subscribeTranslationStore } from '../adapters/translation-store';
import {
  savedSearchLanguages,
  searchBookOrder,
  searchLibraryPassages,
  type LibrarySearchMatch,
  type SearchRoute,
} from '../adapters/global-search';
import type { ReadingTarget } from './library-screens';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { BookCard } from '../components/book-card';
import { Button, Chip, Empty, Icon, IconButton, Sheet, styles } from '../components/ui';

export type { SearchRoute } from '../adapters/global-search';

export function SearchScreen({
  books,
  open,
  more,
  route,
  onRouteChange,
  revision,
}: {
  books: ShelfBook[];
  open: (id: string, paragraph?: string, target?: ReadingTarget) => void;
  more: (book: ShelfBook) => void;
  route: SearchRoute;
  onRouteChange: (route: SearchRoute) => void;
  revision: number;
}) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const [result, setResult] = useState<{
    key: string;
    matches: LibrarySearchMatch[];
    hasMore: boolean;
    hasTranslations: boolean;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const [savedLanguages, setSavedLanguages] = useState<string[]>([]);
  const [languagesFailed, setLanguagesFailed] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [bookQuery, setBookQuery] = useState('');
  const [bookLimit, setBookLimit] = useState(60);
  const list = useRef<FlatList<LibrarySearchMatch>>(null);
  const orderedBooks = useMemo(() => searchBookOrder(books), [books]);
  // Reader progress refreshes the shelf array. Its lastOpened/progress changes
  // must not reorder or restart a mounted search.
  const booksKey = JSON.stringify(
    orderedBooks.map(({ id, title, author, importedAt }) => [id, title, author, importedAt]),
  );
  const needle = normalizeSearch(route.query.trim());
  const requestKey = JSON.stringify([
    library.handle.key,
    library.epoch,
    route,
    booksKey,
    revision,
    savedRevision,
    attempt,
  ]);
  const current = result?.key === requestKey ? result : null;
  const matches = current?.matches || [];
  const searching = !!needle && !current;
  const change = (patch: Partial<SearchRoute>) => {
    if (library.isCurrent()) onRouteChange({ ...route, ...patch, page: 0 });
  };
  const scopeBooks = orderedBooks.filter((book) => !route.bookId || book.id === route.bookId);
  const metadata =
    needle && route.page === 0
      ? scopeBooks
          .filter((book) => normalizeSearch(`${book.title} ${book.author}`).includes(needle))
          .slice(0, 40)
      : [];

  useEffect(
    () =>
      subscribeTranslationStore((handle, bookId) => {
        if (
          library.isCurrent() &&
          handle.key === library.handle.key &&
          (!route.bookId || route.bookId === bookId)
        )
          setSavedRevision((value) => value + 1);
      }),
    [library, route.bookId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    library.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      if (!needle || !library.isCurrent()) return;
      void searchLibraryPassages(library.handle, books, route, controller.signal).then(
        (value) => {
          if (library.isCurrent() && !controller.signal.aborted)
            setResult({ key: requestKey, ...value, failed: false });
        },
        () => {
          if (library.isCurrent() && !controller.signal.aborted)
            setResult({
              key: requestKey,
              matches: [],
              hasMore: false,
              hasTranslations: false,
              failed: true,
            });
        },
      );
    }, 220);
    list.current?.scrollToOffset({ offset: 0, animated: false });
    return () => {
      clearTimeout(timer);
      controller.abort();
      library.signal.removeEventListener('abort', abort);
    };
    // requestKey includes all immutable search inputs, without shelf progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    setSavedLanguages([]);
    setLanguagesFailed(false);
    if (route.source !== 'translation' || !library.isCurrent()) return () => controller.abort();
    const abort = () => controller.abort();
    library.signal.addEventListener('abort', abort, { once: true });
    void savedSearchLanguages(library.handle, route.bookId, controller.signal).then(
      (languages) => {
        if (library.isCurrent() && !controller.signal.aborted) setSavedLanguages(languages);
      },
      () => {
        if (library.isCurrent() && !controller.signal.aborted) setLanguagesFailed(true);
      },
    );
    return () => {
      controller.abort();
      library.signal.removeEventListener('abort', abort);
    };
  }, [library, route.source, route.bookId, booksKey, revision, savedRevision, attempt]);
  const languages = [...new Set([route.language, ...savedLanguages])];
  const languageName = (language: string) =>
    bookSourceLanguages.find(([code]) => code === language)?.[1] || language;
  const filteredBooks = orderedBooks.filter((book) =>
    normalizeSearch(`${book.title} ${book.author}`).includes(normalizeSearch(bookQuery.trim())),
  );
  const pagination = () =>
    needle && (route.page > 0 || current?.hasMore) ? (
      <View style={{ gap: 10, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <Button
            secondary
            disabled={route.page === 0 || searching}
            onPress={() => onRouteChange({ ...route, page: route.page - 1 })}
          >
            {t('searchPreviousPage')}
          </Button>
          <Button
            secondary
            disabled={!current?.hasMore || searching}
            onPress={() => onRouteChange({ ...route, page: route.page + 1 })}
          >
            {t('searchNextPage')}
          </Button>
        </View>
      </View>
    ) : null;

  return (
    <>
      <FlatList
        ref={list}
        data={matches}
        keyExtractor={(match) =>
          JSON.stringify([match.bookId, match.paragraph, match.anchor.translationKey || 'original'])
        }
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <View
              style={[
                styles.row,
                {
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 15,
                  paddingLeft: 14,
                },
              ]}
            >
              <Icon name="search-outline" color={colors.muted} />
              <TextInput
                accessibilityLabel={t('searchHint')}
                value={route.query}
                onChangeText={(query) => change({ query })}
                maxLength={160}
                autoCorrect={false}
                returnKeyType="search"
                placeholder={t('searchHint')}
                placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.ink, fontSize: 15, minHeight: 52 }}
              />
              {!!route.query && (
                <IconButton
                  icon="close-circle"
                  label={t('close')}
                  onPress={() => change({ query: '' })}
                />
              )}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip
                active={route.source === 'original'}
                onPress={() => change({ source: 'original' })}
              >
                {t('original')}
              </Chip>
              <Chip
                active={route.source === 'translation'}
                onPress={() => change({ source: 'translation' })}
              >
                {t('searchSavedTranslations')}
              </Chip>
            </View>
            <Button
              secondary
              icon="filter-outline"
              onPress={() => {
                setBookQuery('');
                setBookLimit(60);
                setFilterOpen(true);
              }}
            >
              {route.bookId
                ? books.find((book) => book.id === route.bookId)?.title || t('searchBookFilter')
                : t('searchAllBooks')}
            </Button>
            {route.source === 'translation' && (
              <>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {t('translationLanguage')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {languages.map((language) => (
                    <Chip
                      key={language}
                      active={language === route.language}
                      onPress={() => change({ language })}
                    >
                      {languageName(language)}
                    </Chip>
                  ))}
                </ScrollView>
                {languagesFailed && (
                  <Button secondary onPress={() => setAttempt((value) => value + 1)}>
                    {t('retry')}
                  </Button>
                )}
              </>
            )}
            {metadata.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                open={() => open(book.id)}
                more={() => more(book)}
              />
            ))}
            {searching && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.accent} />
                <Text style={{ color: colors.muted }}>{t('searching')}</Text>
              </View>
            )}
            {current?.failed && (
              <Button secondary onPress={() => setAttempt((value) => value + 1)}>
                {t('retry')}
              </Button>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (
                !library.isCurrent() ||
                !current ||
                item.anchor.source !== route.source ||
                (item.language && item.language !== route.language)
              )
                return;
              Keyboard.dismiss();
              open(item.bookId, item.paragraph, { anchor: item.anchor, quote: item.quote });
            }}
            style={{
              paddingVertical: 20,
              borderBottomWidth: 0.5,
              borderColor: colors.border,
              marginBottom: 12,
              gap: 9,
            }}
          >
            <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13, fontWeight: '600' }}>
              {item.title}
            </Text>
            <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 11 }}>
              {item.chapter} ·{' '}
              {t(item.anchor.source === 'translation' ? 'translation' : 'original')}
              {item.language ? ` · ${languageName(item.language)}` : ''}
            </Text>
            <Text style={{ color: colors.ink, lineHeight: 24, fontSize: 14 }}>
              {item.excerpt.slice(0, item.matchStart)}
              <Text style={{ backgroundColor: colors.highlight, color: colors.ink }}>
                {item.excerpt.slice(item.matchStart, item.matchEnd)}
              </Text>
              {item.excerpt.slice(item.matchEnd)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          !searching && needle && current && !current.failed ? (
            <Empty
              title={t(
                route.source === 'translation' && !current.hasTranslations
                  ? 'searchNoSavedTranslations'
                  : 'noResults',
              )}
            />
          ) : null
        }
        ListFooterComponent={pagination()}
      />
      <Sheet
        visible={filterOpen}
        title={t('searchBookFilter')}
        close={() => setFilterOpen(false)}
        tall
      >
        <TextInput
          accessibilityLabel={t('searchBookFilter')}
          value={bookQuery}
          onChangeText={(value) => {
            setBookQuery(value);
            setBookLimit(60);
          }}
          maxLength={160}
          placeholder={t('searchBookFilter')}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
        />
        <Button
          secondary
          onPress={() => {
            change({ bookId: undefined });
            setFilterOpen(false);
          }}
        >
          {t('searchAllBooks')}
        </Button>
        {filteredBooks.slice(0, bookLimit).map((book) => (
          <Pressable
            key={book.id}
            accessibilityRole="button"
            accessibilityState={{ selected: book.id === route.bookId }}
            onPress={() => {
              change({ bookId: book.id });
              setFilterOpen(false);
            }}
            style={{
              paddingVertical: 14,
              borderBottomWidth: 0.5,
              borderColor: colors.border,
              gap: 6,
            }}
          >
            <Text
              style={{ color: book.id === route.bookId ? colors.accent : colors.ink, fontSize: 15 }}
            >
              {book.title}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{book.author}</Text>
          </Pressable>
        ))}
        {!filteredBooks.length && <Text style={{ color: colors.muted }}>{t('noResults')}</Text>}
        {filteredBooks.length > bookLimit && (
          <Button secondary onPress={() => setBookLimit((value) => value + 60)}>
            {t('more')}
          </Button>
        )}
      </Sheet>
    </>
  );
}
