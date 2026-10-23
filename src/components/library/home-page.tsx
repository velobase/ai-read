'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { readingProgress } from '@/lib/reading-progress';
import { Storefront } from './storefront';
import { useLibrary } from './library-provider';
import {
  BookCard,
  BookCover,
  ImportButton,
  LibraryShell,
  PageHeading,
  SearchBar,
} from './library-ui';

export function HomePage({ discover = false }: { discover?: boolean }) {
  const { t, locale } = useI18n();
  const { books, state, positions, readBook } = useLibrary();
  const recent = books
    .filter((book) => state.books[book.id]?.lastOpenedAt || positions[book.id])
    .sort(
      (a, b) => (state.books[b.id]?.lastOpenedAt || 0) - (state.books[a.id]?.lastOpenedAt || 0),
    );
  const continuing = recent.find(
    (book) => positions[book.id] && state.books[book.id]?.status !== 'finished',
  );
  const currentPosition = continuing ? positions[continuing.id] : undefined;
  const progress = continuing ? readingProgress(continuing.chapters, currentPosition) : 0;
  const otherRecent = recent.filter((book) => book.id !== continuing?.id).slice(0, 4);

  return (
    <LibraryShell>
      <main className="library-container">
        <PageHeading title={t(discover ? '书城' : '阅读')}>
          {!discover && <ImportButton />}
        </PageHeading>
        {!discover && (
          <>
            <SearchBar className="mb-8" />
            {continuing && (
              <section aria-label={t('继续阅读')}>
                <button
                  className="home-continue w-full text-start"
                  onClick={() => void readBook(continuing)}
                  aria-label={t('阅读《{value0}》', { value0: continuing.title })}
                >
                  <BookCover book={continuing} />
                  <div className="home-continue-content">
                    <span className="home-continue-eyebrow">{t('继续阅读')}</span>
                    <h2>{continuing.title}</h2>
                    <p>
                      {continuing.chapters[currentPosition?.chapter || 0]?.title}
                      {' · '}
                      {progress.toLocaleString(locale, {
                        style: 'percent',
                        maximumFractionDigits: 0,
                      })}
                    </p>
                  </div>
                  <ChevronRight
                    size={20}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </section>
            )}
            {otherRecent.length > 0 && (
              <section className="my-10" aria-label={t('最近阅读')}>
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">{t('最近阅读')}</h2>
                  <Link href="/library" className="text-sm text-primary">
                    {t('书架')}
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
                  {otherRecent.map((book) => (
                    <BookCard key={book.id} book={book} onClick={() => void readBook(book)} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        <Storefront preview={!discover} />
      </main>
    </LibraryShell>
  );
}
