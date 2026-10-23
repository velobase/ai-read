import { AccountCard, AccountSyncSummary } from '../components/account-card';
import { useLibrary } from '../library-context';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  catalog,
  categories,
  bookDescription,
  bookContents,
  isPdfBook,
  type Book,
} from '@bypage/reading-core';
import { type ShelfBook } from '../adapters/database';
import { useApp } from '../context';
import { Cover } from '../components/book-card';
import { BookSourceLanguage } from '../components/book-source-language';
import { BookTranslationPreparation } from '../components/translation-preparation';
import { Button, Chip, Icon, IconButton, styles, type IconName } from '../components/ui';
import { SearchEntry } from './library-screens';

export function HomeScreen({
  books,
  search,
  detail,
  open,
  importBook,
  notes,
  discover = false,
}: {
  books: ShelfBook[];
  search: () => void;
  detail: (id: string) => void;
  open: (id: string) => void;
  importBook: () => void;
  notes: () => void;
  discover?: boolean;
}) {
  const { colors, t } = useApp();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 350 || fontScale > 1.3 ? 2 : width > 700 ? 5 : 3;
  const coverWidth = (Math.min(width, 900) - 44 - (columns - 1) * 22) / columns;
  const [category, setCategory] = useState('全部');
  const [showCategories, setShowCategories] = useState(false);
  const recent = books
    .filter((b) => (b.lastOpened > 0 || b.hasPosition) && !b.finished)
    // Restored progress can be continued immediately; its import date is real,
    // while its last-reading time on another device is deliberately unknown.
    .sort((a, b) => (b.lastOpened || b.importedAt) - (a.lastOpened || a.importedAt))
    .slice(0, 4);
  const visible = catalog.filter((b) => category === '全部' || b.category === category);
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 22,
        paddingTop: 16,
        paddingBottom: 30,
        maxWidth: 900,
        width: '100%',
        alignSelf: 'center',
        gap: 24,
      }}
    >
      <SearchEntry
        search={search}
        discover={() => {
          setShowCategories(true);
          setCategory('全部');
        }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
      >
        {[
          { label: t('categories'), action: () => setShowCategories(!showCategories) },
          {
            label: t('originals'),
            action: () => {
              setCategory('全部');
              setShowCategories(true);
            },
          },
          { label: t('notes'), action: notes },
          { label: t('import'), action: importBook },
        ].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={item.action}
            style={{
              backgroundColor: colors.surface,
              paddingVertical: 11,
              paddingHorizontal: 18,
              borderRadius: 24,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Text style={{ color: colors.ink, fontSize: 13 }}>{item.label}</Text>
            <Icon name="chevron-forward" size={11} color={colors.muted} />
          </Pressable>
        ))}
      </ScrollView>
      {showCategories && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {categories
            .filter((c) => c !== '经济学' && c !== '商业管理')
            .map((c) => (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={{
                  padding: 10,
                  borderRadius: 16,
                  backgroundColor: category === c ? colors.soft : colors.surface,
                }}
              >
                <Text
                  style={{ color: category === c ? colors.accent : colors.muted, fontSize: 12 }}
                >
                  {c === '全部' ? t('all') : c}
                </Text>
              </Pressable>
            ))}
        </View>
      )}
      {!discover && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 16 }}
        >
          <View
            style={{
              width: 145,
              height: 166,
              padding: 16,
              backgroundColor: colors.surface,
              borderRadius: 8,
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ fontSize: 12, color: '#A29678' }}>{t('myReading')}</Text>
            <Text style={{ color: '#A29678', fontSize: 30, fontWeight: '600' }}>
              {books.length}
              <Text style={{ fontSize: 12 }}> {t('bookCount', { n: '' }).trim()}</Text>
            </Text>
            <View style={{ gap: 7 }}>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                {Array.from({ length: 7 }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      width: 11,
                      height: 13,
                      borderRadius: 2,
                      backgroundColor: i < Math.min(7, recent.length) ? '#C8BA95' : '#F0EEE8',
                    }}
                  />
                ))}
              </View>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10 }}>
                {t('shelfIntro')}
              </Text>
            </View>
          </View>
          {(recent.length ? recent : books.slice(0, 2)).map((book) => (
            <Pressable
              key={book.id}
              onPress={() => open(book.id)}
              accessibilityRole="button"
              accessibilityLabel={`${t('continue')}: ${book.title}`}
            >
              <Cover book={book} width={105} />
              <View
                style={{
                  backgroundColor: '#00000070',
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: 5,
                }}
              >
                <Text style={{ textAlign: 'center', fontSize: 9, color: '#fff' }}>
                  {t('continue')}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text
        accessibilityRole="header"
        style={{ color: colors.ink, fontSize: 23, fontWeight: '600' }}
      >
        {t(discover ? 'bookstore' : 'recommendations')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 22 }}>
        {visible.map((book) => (
          <Pressable
            key={book.id}
            onPress={() => detail(book.id)}
            accessibilityRole="button"
            accessibilityLabel={book.title}
          >
            <Cover book={book} width={coverWidth} />
          </Pressable>
        ))}
      </View>
      <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 18 }}>
        {t('recommendHint')}
      </Text>
    </ScrollView>
  );
}
export function PageHeader({
  title,
  back,
  more,
}: {
  title: string;
  back: () => void;
  more?: () => void;
}) {
  const { colors, t } = useApp();
  return (
    <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
      <IconButton icon="chevron-back" label={t('back')} onPress={back} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, textAlign: 'center', color: colors.ink, fontSize: 16, fontWeight: '600' }}
      >
        {title}
      </Text>
      {more ? (
        <IconButton icon="ellipsis-horizontal" label={t('more')} onPress={more} />
      ) : (
        <View style={{ width: 44 }} />
      )}
    </View>
  );
}
export function BookDetailScreen({
  book,
  onShelf,
  noteCount,
  close,
  open,
  add,
  more,
  notes,
  updateSourceLanguage,
}: {
  book: Book;
  onShelf: boolean;
  noteCount: number;
  close: () => void;
  open: (paragraph?: string) => void;
  add: () => Promise<void>;
  more?: () => void;
  notes: () => void;
  updateSourceLanguage?: (language: string) => Promise<void>;
}) {
  const { colors, t, notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [contentsPage, setContentsPage] = useState({ bookId: book.id, limit: 12, pdfPages: false });
  const contentsLimit = contentsPage.bookId === book.id ? contentsPage.limit : 12;
  const pdfPages = contentsPage.bookId === book.id && contentsPage.pdfPages;
  const pdfBook = isPdfBook(book);
  const chapterContents = useMemo(() => bookContents(book), [book]);
  const pageContents = useMemo(() => bookContents(book, { pdfPages: true }), [book]);
  const hasPdfContents =
    pdfBook &&
    (chapterContents.length !== pageContents.length ||
      chapterContents.some(
        (entry, index) =>
          entry.title !== pageContents[index]?.title ||
          entry.paragraphId !== pageContents[index]?.paragraphId,
      ));
  const contents = hasPdfContents && pdfPages ? pageContents : chapterContents;
  const referenceCounts = useMemo(
    () => ({
      footnotes: book.references?.links.filter((link) => link.kind === 'footnote').length || 0,
      links: book.references?.links.filter((link) => link.kind === 'internal').length || 0,
      skipped: book.references
        ? book.references.diagnostics.skippedMissing +
          book.references.diagnostics.skippedUnanchored +
          book.references.diagnostics.skippedLimit
        : 0,
    }),
    [book.references],
  );
  const sourcePages = useMemo(
    () => new Map(book.chapters.map((chapter) => [chapter.id, chapter.sourcePage])),
    [book],
  );
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="" back={close} more={more} />
      <ScrollView contentContainerStyle={{ padding: 22, gap: 28, paddingBottom: 35 }}>
        <View style={{ flexDirection: 'row', gap: 22 }}>
          <Cover book={book} width={110} />
          <View style={{ flex: 1, gap: 12, paddingTop: 5 }}>
            <Text style={{ fontSize: 23, lineHeight: 31, fontWeight: '600', color: colors.ink }}>
              {book.title}
            </Text>
            <Text style={{ color: colors.accent, fontSize: 13 }}>{book.author}</Text>
            {book.subtitle && (
              <Text style={{ color: colors.muted, lineHeight: 21, fontSize: 12 }}>
                {book.subtitle}
              </Text>
            )}
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          {[
            [
              t(pdfBook ? (hasPdfContents ? 'pdfChapterContents' : 'pdfPageContents') : 'chapters'),
              pdfBook ? chapterContents.length : book.chapters.length,
            ],
            [t('notes'), noteCount],
          ].map(([label, value]) => (
            <View key={label} style={{ alignItems: 'center', gap: 9 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>{label}</Text>
              <Text style={{ fontSize: 21, color: colors.ink }}>{value}</Text>
            </View>
          ))}
          <BookSourceLanguage book={book} update={onShelf ? updateSourceLanguage : undefined} />
        </View>
        {onShelf && <BookTranslationPreparation book={book} />}
        <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 14, gap: 14 }}>
          <Text style={[styles.subtitle, { color: colors.ink }]}>{t('intro')}</Text>
          <Text style={{ fontSize: 15, lineHeight: 26, color: colors.ink }}>
            {bookDescription(book)}
          </Text>
          {!!book.references && (
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
              {t('bookReferenceCount', referenceCounts)}
            </Text>
          )}
          {!!referenceCounts.skipped && (
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
              {t('bookReferenceSkipped', { n: referenceCounts.skipped })}
            </Text>
          )}
        </View>
        <View style={{ backgroundColor: colors.surface, padding: 20, borderRadius: 14, gap: 15 }}>
          <Text style={[styles.subtitle, { color: colors.ink }]}>{t('chapters')}</Text>
          {hasPdfContents && (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {[false, true].map((pages) => (
                <Chip
                  key={String(pages)}
                  active={pdfPages === pages}
                  onPress={() => setContentsPage({ bookId: book.id, limit: 12, pdfPages: pages })}
                >
                  {t(pages ? 'pdfPageContents' : 'pdfChapterContents')}
                </Chip>
              ))}
            </View>
          )}
          {contents.slice(0, contentsLimit).map((entry, i) => (
            <Pressable
              key={`${entry.chapterId}:${entry.paragraphId}:${i}`}
              accessibilityRole="button"
              onPress={() => open(entry.paragraphId)}
              style={{
                paddingVertical: 12,
                paddingLeft: Math.min(entry.depth, 5) * 12,
                borderBottomWidth: 0.5,
                borderColor: colors.border,
                flexDirection: 'row',
                gap: 13,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 12 }}>{i + 1}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{
                    color: colors.ink,
                    fontSize: 14,
                    lineHeight: 22,
                    fontWeight: entry.depth === 0 ? '600' : '400',
                  }}
                >
                  {entry.title}
                </Text>
                {hasPdfContents && !pdfPages && sourcePages.get(entry.chapterId) !== undefined && (
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {t('pdfPage', { n: sourcePages.get(entry.chapterId)! })}
                  </Text>
                )}
              </View>
              <Icon name="chevron-forward" size={14} color={colors.muted} />
            </Pressable>
          ))}
          {contents.length > contentsLimit && (
            <Button
              secondary
              onPress={() =>
                setContentsPage({ bookId: book.id, limit: contentsLimit + 24, pdfPages })
              }
            >
              {t('more')}
            </Button>
          )}
        </View>
      </ScrollView>
      <View
        style={{
          padding: 14,
          paddingHorizontal: 20,
          backgroundColor: colors.surface,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderTopWidth: 0.5,
          borderColor: colors.border,
        }}
      >
        <IconButton icon="create-outline" label={t('notes')} onPress={notes} />
        <View style={{ flex: 1 }}>
          <Button
            secondary
            busy={busy}
            disabled={onShelf}
            onPress={() => {
              setBusy(true);
              void add()
                .catch(() => notify(t('error')))
                .finally(() => setBusy(false));
            }}
          >
            {t(onShelf ? 'onShelf' : 'addShelf')}
          </Button>
        </View>
        <View style={{ flex: 1.1 }}>
          <Button onPress={() => open()}>{t('read')}</Button>
        </View>
      </View>
    </View>
  );
}
export function ProfileScreen({
  books,
  settings,
  notes,
  library,
  importBook,
}: {
  books: ShelfBook[];
  settings: () => void;
  notes: () => void;
  library: () => void;
  importBook: () => void;
}) {
  const { colors, t, openAccount } = useApp();
  const currentLibrary = useLibrary();
  const rows: { label: string; icon: IconName; action: () => void }[] = [
    { label: t('library'), icon: 'library-outline', action: library },
    { label: t('notes'), icon: 'create-outline', action: notes },
    { label: t('import'), icon: 'add-circle-outline', action: importBook },
    { label: t('settings'), icon: 'settings-outline', action: settings },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 22, gap: 28, paddingTop: 26 }}>
      <View style={styles.spread}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 23, fontWeight: '600', color: colors.ink }}
        >
          {t('profile')}
        </Text>
        <IconButton icon="settings-outline" label={t('settings')} onPress={settings} />
      </View>
      <AccountCard manage={openAccount} />
      <AccountSyncSummary open={openAccount} />
      <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 22, gap: 22 }}>
        <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>
          {t(currentLibrary.handle.kind === 'device' ? 'accountDeviceStats' : 'readStats')}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          {[
            {
              label: t('reading'),
              n: books.filter((b) => (b.lastOpened > 0 || b.hasPosition) && !b.finished).length,
              action: library,
            },
            { label: t('finished'), n: books.filter((b) => b.finished).length, action: library },
            { label: t('notes'), n: books.reduce((n, b) => n + b.noteCount, 0), action: notes },
          ].map((item) => (
            <Pressable
              key={item.label}
              onPress={item.action}
              style={{ gap: 8, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 27, fontWeight: '600', color: colors.ink }}>{item.n}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 18 }}>
        {rows.map((row, i) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            onPress={row.action}
            style={{
              flexDirection: 'row',
              gap: 15,
              alignItems: 'center',
              paddingVertical: 20,
              borderBottomWidth: i < rows.length - 1 ? 0.5 : 0,
              borderColor: colors.border,
            }}
          >
            <Icon name={row.icon} size={21} />
            <Text style={{ flex: 1, color: colors.ink, fontSize: 15 }}>{row.label}</Text>
            <Icon name="chevron-forward" color={colors.muted} size={15} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
