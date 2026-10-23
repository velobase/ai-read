import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  bookSourceLanguages,
  excerptMatch,
  readingChapterNavigation,
  type Book,
  type NoteAnchor,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { searchSavedBookTranslations } from '../adapters/saved-translation-search';
import { subscribeTranslationStore } from '../adapters/translation-store';
import { Button, Chip, Sheet, styles } from './ui';

type Match = NonNullable<ReturnType<typeof excerptMatch>> & {
  chapter: number;
  title: string;
  paragraph: string;
  source: 'original' | 'translation';
  language?: string;
  translationKey?: string;
  quote: string;
};
const PAGE_SIZE = 60;
export function BookSearchSheet({
  book,
  language,
  visible,
  close,
  onShow,
  onDismiss,
  open,
  returnToReading,
  returning = false,
}: {
  book: Book;
  translations: Record<string, string>;
  translationKeys: Record<string, string>;
  /** The actual reader version, which may temporarily differ from preferences. */
  language: string;
  visible: boolean;
  close: () => void;
  onShow?: () => void;
  onDismiss?: () => void;
  open: (
    chapter: number,
    paragraph: string,
    anchor: NoteAnchor,
    quote: string,
    isCurrent: () => boolean,
  ) => Promise<boolean>;
  returnToReading?: () => void;
  returning?: boolean;
}) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'original' | 'translation'>('original');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    matches: Match[];
    more: boolean;
    hasTranslations: boolean;
    failed: boolean;
  }>();
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const scope = JSON.stringify([
    library.handle.key,
    library.epoch,
    book.id,
    query,
    source,
    language,
    page,
    revision,
    attempt,
  ]);
  const activeScope = useRef({ scope, visible });
  activeScope.current = { scope, visible };
  const request = useRef(0);
  useEffect(
    () =>
      subscribeTranslationStore((handle, bookId) => {
        if (library.isCurrent() && handle.key === library.handle.key && bookId === book.id)
          setRevision((value) => value + 1);
      }),
    [library, book.id],
  );
  useEffect(() => {
    request.current++;
    setOpening(false);
    return () => {
      request.current++;
    };
  }, [scope, visible]);
  const searching = visible && !!query.trim() && result?.scope !== scope;
  const matches = result?.scope === scope ? result.matches : [];
  const hasMore = result?.scope === scope && result.more;
  const failed = result?.scope === scope && result.failed;
  const noSavedTranslations = result?.scope === scope && !result.failed && !result.hasTranslations;
  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (!visible || !query.trim()) return;
    library.signal.addEventListener('abort', abort, { once: true });
    const check = () => {
      library.assertCurrent();
      if (controller.signal.aborted)
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    };
    setResult(undefined);
    const timer = setTimeout(
      () =>
        void (async () => {
          check();
          if (source === 'translation') {
            const saved = await searchSavedBookTranslations(
              library.handle,
              book.id,
              language,
              query,
              { offset: page * PAGE_SIZE, limit: PAGE_SIZE, signal: controller.signal },
            );
            check();
            setResult({
              scope,
              matches: saved.matches.map((match) => ({
                ...match,
                chapter: match.chapterIndex,
                paragraph: match.paragraphId,
                source: 'translation',
                title:
                  readingChapterNavigation(book, {
                    chapter: match.chapterIndex,
                    paragraph: match.paragraphId,
                  }).current?.title || match.chapterTitle,
              })),
              more: saved.hasMore,
              hasTranslations: saved.hasTranslations,
              failed: false,
            });
            return;
          }
          const found: Match[] = [];
          let scanned = 0,
            characters = 0,
            skipped = 0,
            more = false;
          outer: for (const [chapter, item] of book.chapters.entries()) {
            for (const paragraph of item.paragraphs) {
              check();
              const text = paragraph.text;
              const match = text ? excerptMatch(text, query) : null;
              if (match) {
                if (skipped++ >= page * PAGE_SIZE) {
                  if (found.length === PAGE_SIZE) {
                    more = true;
                    break outer;
                  }
                  found.push({
                    ...match,
                    chapter,
                    paragraph: paragraph.id,
                    source: 'original',
                    title:
                      readingChapterNavigation(book, { chapter, paragraph: paragraph.id }).current
                        ?.title || item.title,
                    quote: text!.slice(match.sourceStart, match.sourceEnd),
                  });
                }
              }
              characters += text?.length || 0;
              if (++scanned % 80 === 0 || characters >= 64000) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                check();
                characters = 0;
              }
            }
          }
          check();
          setResult({ scope, matches: found, more, hasTranslations: false, failed: false });
        })().catch(() => {
          if (!controller.signal.aborted && library.isCurrent())
            setResult({ scope, matches: [], more: false, hasTranslations: false, failed: true });
        }),
      220,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
      library.signal.removeEventListener('abort', abort);
    };
  }, [library, book, query, source, language, page, scope, visible]);
  const changePage = (next: number) => {
    if (returning) return;
    setPage(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  return (
    <Sheet
      visible={visible}
      title={t('searchBook')}
      close={close}
      onShow={onShow}
      onDismiss={onDismiss}
      tall
      scrollRef={scroll}
    >
      {returnToReading && (
        <Button
          secondary
          busy={returning}
          disabled={opening || returning}
          onPress={returnToReading}
        >
          {t('searchReturnReading')}
        </Button>
      )}
      <TextInput
        accessibilityLabel={t('searchBook')}
        editable={!returning}
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setPage(0);
        }}
        placeholder={t('searchBookHint')}
        placeholderTextColor={colors.muted}
        maxLength={160}
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip
          disabled={returning}
          active={source === 'original'}
          onPress={() => {
            setSource('original');
            setPage(0);
          }}
        >
          {t('original')}
        </Chip>
        <Chip
          disabled={returning}
          active={source === 'translation'}
          onPress={() => {
            setSource('translation');
            setPage(0);
          }}
        >
          {t('searchSavedTranslations')}
        </Chip>
      </View>
      {source === 'translation' && (
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
          {bookSourceLanguages.find(([code]) => code === language)?.[1] || language}
          {' · '}
          {noSavedTranslations ? t('searchNoSavedTranslations') : t('searchSavedTranslationsHint')}
        </Text>
      )}
      {searching ? (
        <ActivityIndicator color={colors.accent} />
      ) : failed ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.muted }}>{t('storageError')}</Text>
          <Button secondary disabled={returning} onPress={() => setAttempt((value) => value + 1)}>
            {t('retry')}
          </Button>
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {query.trim()
            ? matches.length
              ? t('searchResultsPage', { page: page + 1, count: matches.length })
              : t('noResults')
            : t('searchPrivacy')}
        </Text>
      )}
      {matches.map((match) => (
        <Pressable
          accessibilityRole="button"
          key={JSON.stringify([match.paragraph, match.translationKey || 'original'])}
          disabled={opening || returning}
          accessibilityState={{ disabled: opening || returning }}
          onPress={() => {
            if (returning) return;
            if (match.source !== source || (match.language && match.language !== language)) return;
            Keyboard.dismiss();
            setOpening(true);
            const sequence = ++request.current;
            void open(
              match.chapter,
              match.paragraph,
              {
                source: match.source,
                start: match.sourceStart,
                end: match.sourceEnd,
                ...(match.source === 'translation' ? { translationKey: match.translationKey } : {}),
              },
              match.quote,
              () =>
                request.current === sequence &&
                activeScope.current.visible &&
                activeScope.current.scope === scope,
            ).finally(() => {
              if (request.current === sequence) setOpening(false);
            });
          }}
          style={{
            paddingVertical: 13,
            borderBottomWidth: 0.5,
            borderColor: colors.border,
            gap: 8,
          }}
        >
          <Text style={{ color: colors.accent, fontSize: 12 }}>{match.title}</Text>
          <Text style={{ color: colors.ink, lineHeight: 25, fontSize: 15 }}>
            {match.excerpt.slice(0, match.matchStart)}
            <Text style={{ backgroundColor: colors.highlight }}>
              {match.excerpt.slice(match.matchStart, match.matchEnd)}
            </Text>
            {match.excerpt.slice(match.matchEnd)}
          </Text>
        </Pressable>
      ))}
      {(page > 0 || hasMore) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {page > 0 && (
            <Button
              secondary
              disabled={searching || opening || returning}
              onPress={() => changePage(page - 1)}
            >
              {t('searchPreviousPage')}
            </Button>
          )}
          {hasMore && (
            <Button
              secondary
              disabled={searching || opening || returning}
              onPress={() => changePage(page + 1)}
            >
              {t('searchNextPage')}
            </Button>
          )}
        </View>
      )}
    </Sheet>
  );
}
