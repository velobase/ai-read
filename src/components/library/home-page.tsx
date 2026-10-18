'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, BookOpen, ChevronRight, RefreshCw, NotebookPen } from 'lucide-react';
import { catalog, categories } from '@/lib/catalog';
import { useLibrary } from './library-provider';
import { BookCard, BookCover, LibraryShell, SearchBar } from './library-ui';

export function HomePage({ discover = false }: { discover?: boolean }) {
  const { t, text: localize, locale } = useI18n();
  const { books, notes, state, readBook, openImport } = useLibrary();
  const [offset, setOffset] = useState(0);
  const recent = [...books].sort(
    (a, b) => (state.books[b.id]?.lastOpenedAt || 0) - (state.books[a.id]?.lastOpenedAt || 0),
  );
  const display = [...catalog.slice(offset), ...catalog.slice(0, offset)];
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
            { label: t('原创'), href: '/discover' },
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
        <div className="desktop-search-hints">
          <span>{t('探索阅读')}</span>
          {categories.slice(1).map((category) => (
            <Link href={`/categories?category=${encodeURIComponent(category)}`} key={category}>
              {localize(category)}
            </Link>
          ))}
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
        <section className="home-recommendations">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold sm:text-[22px]">
                {discover ? t('原创书城') : t('为你推荐')}
              </h2>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t('从一篇好文章开始')}
              </span>
            </div>
            <button
              className="hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-primary sm:flex"
              onClick={() => setOffset((offset + 1) % catalog.length)}
            >
              <RefreshCw size={13} />
              {t('换一批')}
            </button>
          </div>
          <div className="home-recommendation-grid">
            {display.map((book) => (
              <div key={book.id} className="home-recommendation-card">
                <BookCard book={book} showAuthor />
                <p className="mt-3 hidden text-center text-xs text-muted-foreground sm:block">
                  {t('{value0} · 原创短文', { value0: localize(book.category || '') })}
                </p>
              </div>
            ))}
          </div>
          <button onClick={() => setOffset((offset + 1) % catalog.length)} className="home-refresh">
            <RefreshCw size={14} />
            {t('换一批')}
          </button>
          <p className="mt-4 text-xs text-muted-foreground">
            {t('精选 ByPage · 逐页 原创内容，可直接阅读或加入书架。')}
          </p>
        </section>
        <section className="home-topic-grid">
          {categories.slice(1).map((category, i) => (
            <Link
              key={category}
              href={`/categories?category=${encodeURIComponent(category)}`}
              className="home-topic-card"
            >
              <span className="text-[10px] tracking-[.15em] text-muted-foreground">
                {t('书单')} · {(i + 1).toLocaleString(locale, { minimumIntegerDigits: 2 })}
              </span>
              <h3>{localize(category)}</h3>
              <p>
                {
                  [
                    t('把问题留在页边'),
                    t('越过语言的边界'),
                    t('记录每一次发现'),
                    t('在日常里慢下来'),
                  ][i]
                }
              </p>
              <span className="mt-5 flex items-center gap-1 text-xs text-primary">
                {t('去看看')}
                <ArrowRight size={14} />
              </span>
            </Link>
          ))}
        </section>
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
          <a href="mailto:support@leafread.ai">support@leafread.ai</a>
          <Link href="/me/about">{t('关于 ByPage · 逐页')}</Link>
        </footer>
      </main>
    </LibraryShell>
  );
}
