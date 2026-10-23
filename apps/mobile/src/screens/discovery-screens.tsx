import { Storefront } from '../components/storefront';
import { AccountCard, AccountSyncSummary } from '../components/account-card';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { bookContents, isPdfBook, type Book } from '@bypage/reading-core';
import { type ShelfBook } from '../adapters/database';
import { useApp } from '../context';
import { Cover } from '../components/book-card';
import { BookSourceLanguage } from '../components/book-source-language';
import { Button, Chip, IconButton, styles } from '../components/ui';
import { SettingsContent } from './library-screens';

export function HomeScreen({
  books,
  detail,
  open,
  downloaded,
}: {
  books: ShelfBook[];
  detail: (id: string) => void;
  open: (id: string) => void;
  downloaded: (book: Book) => Promise<void>;
}) {
  const { colors, t } = useApp();
  const recent = books
    .filter((book) => (book.lastOpened > 0 || book.hasPosition) && !book.finished)
    .sort((a, b) => (b.lastOpened || b.importedAt) - (a.lastOpened || a.importedAt))
    .slice(0, 4);
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 22,
        paddingTop: 16,
        paddingBottom: 30,
        maxWidth: 900,
        width: '100%',
        alignSelf: 'center',
        gap: 32,
      }}
    >
      {recent.length > 0 && (
        <View style={{ gap: 16 }}>
          <Text accessibilityRole="header" style={[styles.subtitle, { color: colors.ink }]}>
            {t('continue')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 20 }}
          >
            {recent.map((book) => (
              <Pressable
                key={book.id}
                onPress={() => open(book.id)}
                accessibilityRole="button"
                accessibilityLabel={`${t('continue')}: ${book.title}`}
                style={{ width: 105, gap: 8 }}
              >
                <Cover book={book} width={105} />
                <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 13 }}>
                  {book.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <Storefront downloaded={downloaded} open={detail} savedIds={books.map((book) => book.id)} />
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
  const skippedReferences = useMemo(
    () =>
      book.references
        ? book.references.diagnostics.skippedMissing +
          book.references.diagnostics.skippedUnanchored +
          book.references.diagnostics.skippedLimit
        : 0,
    [book.references],
  );
  const description =
    book.description ||
    book.chapters[0]?.paragraphs.find((paragraph) => paragraph.kind === 'text')?.text.slice(0, 220);
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
            <Text style={{ color: colors.muted, fontSize: 14 }}>{book.author}</Text>
            {book.subtitle && (
              <Text style={{ color: colors.muted, lineHeight: 21, fontSize: 12 }}>
                {book.subtitle}
              </Text>
            )}
          </View>
        </View>
        <BookSourceLanguage book={book} update={onShelf ? updateSourceLanguage : undefined} />
        {(description || skippedReferences > 0) && (
          <View style={{ gap: 14 }}>
            {!!description && (
              <Text style={{ fontSize: 15, lineHeight: 26, color: colors.ink }}>{description}</Text>
            )}
            {skippedReferences > 0 && (
              <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
                {t('bookReferenceSkipped', { n: skippedReferences })}
              </Text>
            )}
          </View>
        )}
        <View style={{ gap: 15 }}>
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
        {onShelf && (
          <IconButton
            icon="create-outline"
            label={`${t('notes')} · ${noteCount}`}
            onPress={notes}
          />
        )}
        {!onShelf && (
          <View style={{ flex: 1 }}>
            <Button
              secondary
              busy={busy}
              onPress={() => {
                setBusy(true);
                void add()
                  .catch(() => notify(t('error')))
                  .finally(() => setBusy(false));
              }}
            >
              {t('addShelf')}
            </Button>
          </View>
        )}
        <View style={{ flex: 1.1 }}>
          <Button onPress={() => open()}>{t('read')}</Button>
        </View>
      </View>
    </View>
  );
}
export function ProfileScreen({ importBook }: { importBook: () => void }) {
  const { colors, t, openAccount } = useApp();
  return (
    <ScrollView contentContainerStyle={[styles.page, { gap: 18 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('profile')}
      </Text>
      <AccountCard manage={openAccount} />
      <AccountSyncSummary open={openAccount} />
      <SettingsContent importBook={importBook} />
    </ScrollView>
  );
}
