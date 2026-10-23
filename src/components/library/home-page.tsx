'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { ArrowRight, BookOpen, ChevronRight, NotebookPen } from 'lucide-react';
import { catalog, categories } from '@/lib/catalog';
import { Storefront } from './storefront';
import { useLibrary } from './library-provider';
import { BookCard, BookCover, LibraryShell, SearchBar } from './library-ui';

export function HomePage({ discover = false }: { discover?: boolean }) {
  const { t, text: localize, locale } = useI18n();
  const { books, notes, state, readBook, openImport } = useLibrary();
  const recent = [...books].sort(
    (a, b) => (state.books[b.id]?.lastOpenedAt || 0) - (state.books[a.id]?.lastOpenedAt || 0),
  );
  return (
    <LibraryShell>
      <section className="library-home-hero">
        <div className="home-wordmark">
          <span className="brand-mark">
            <BookOpen size={25} strokeWidth={1.6} />
          </span>
          <h1>{t('ByPage · 逐页')}</h1>
        </div>
        <SearchBar large />
        <div className="home-category-pills">
          {[
            { label: t('分类'), href: '/categories' },
            { label: t('书单'), href: '/collections' },
            { label: t('笔记'), href: '/notes' },
            { label: t('书城'), href: '/discover' },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
              <ChevronRight size={13} />
            </Link>
          ))}
          <button onClick={openImport}>
            {t('导入')}
            <ChevronRight size={13} />
          </button>
        </div>
      </section>
      <main className="library-container home-content">
        {!discover && (
          <section className="home-recent-strip" aria-label={t('最近阅读')}>
            <Link href="/library?filter=reading" className="reading-summary-card">
              <span className="text-xs text-[#a18b61]">{t('我的阅读')}</span>
              <strong>
                {books.length.toLocaleString(locale)}{' '}
                <small>{books.length === 1 && !locale.startsWith('zh') ? 'Book' : t('本书')}</small>
              </strong>
              <div className="flex gap-1.5" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <i key={i} className={i < Math.min(books.length, 7) ? 'filled' : ''} />
                ))}
              </div>
              <span className="mt-2 text-[10px] text-[#b0a18a]">{t('在书页间，留一点时间')}</span>
            </Link>
            {recent.slice(0, 5).map((book) => (
              <button key={book.id} onClick={() => void readBook(book)} className="recent-book">
                <BookCover book={book} />
                <span>{t('继续阅读')}</span>
              </button>
            ))}
          </section>
        )}
        <Storefront />
        {notes.length > 0 && (
          <section className="mt-12">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('最近的想法')}</h2>
              <Link href="/notes" className="text-sm text-muted-foreground">
                {t('全部笔记')}
                <span aria-hidden="true">›</span>
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[...notes]
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 2)
                .map((note) => (
                  <Link
                    key={note.id}
                    href={`/notes/${note.bookId}`}
                    className="rounded-2xl bg-white p-6"
                  >
                    <NotebookPen size={18} className="mb-4 text-primary" />
                    <p className="line-clamp-3 text-sm leading-7">{note.text || note.quote}</p>
                    <p className="mt-4 text-xs text-muted-foreground">
                      《{books.find((b) => b.id === note.bookId)?.title || t('书中笔记')}》
                    </p>
                  </Link>
                ))}
            </div>
          </section>
        )}
        <footer className="library-footer flex-wrap">
          <span className="inline-flex items-center gap-2">
            <BookOpen size={15} />
            {t('让阅读回到阅读本身')}
          </span>
          <span aria-hidden="true">·</span>
          <span>© 2026 LeafRead</span>
          <a href="https://leafread.ai" target="_blank" rel="noreferrer">
            leafread.ai
          </a>
          <Link href="/privacy">{locale.startsWith('zh') ? '隐私政策' : 'Privacy Policy'}</Link>
          <Link href="/terms">{locale.startsWith('zh') ? '服务条款' : 'Terms of Service'}</Link>
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
          <Link href="/me/about">{t('关于 ByPage · 逐页')}</Link>
        </footer>
      </main>
    </LibraryShell>
  );
}
