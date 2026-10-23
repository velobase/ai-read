'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { ArrowRight, BookOpen, ChevronRight, NotebookPen } from 'lucide-react';
import { catalog, categories } from '@/lib/catalog';
import { recommendedBooks, recommendationCopy } from '@/lib/recommended-books';
import { useLibrary } from './library-provider';
import { BookCard, BookCover, LibraryShell, SearchBar } from './library-ui';
import { readingProgress } from '@/lib/reading-progress';

export function HomePage({ discover = false }: { discover?: boolean }) {
  const { t, text: localize, locale } = useI18n();
  const { books, notes, state, positions, readBook, openImport } = useLibrary();
  const recent = [...books].sort(
    (a, b) => (state.books[b.id]?.lastOpenedAt || 0) - (state.books[a.id]?.lastOpenedAt || 0),
  );
  const continuing = recent.find(
    (book) => positions[book.id] && state.books[book.id]?.status !== 'finished',
  );
  const currentPosition = continuing ? positions[continuing.id] : undefined;
  const progress = continuing ? readingProgress(continuing.chapters, currentPosition) : 0;
  const topicCopy: Record<string, string> = {
    经济学: t('理解市场与经济协作'),
    商业管理: t('竞争、组织与经营'),
    阅读与思考: t('把问题留在页边'),
    语言与表达: t('越过语言的边界'),
    写作与记录: t('记录每一次发现'),
    生活与观察: t('在日常里慢下来'),
  };
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
        {!discover && continuing && (
          <section className="home-continue" aria-label={t('继续阅读')}>
            <BookCover book={continuing} />
            <div className="home-continue-content">
              <span className="home-continue-eyebrow">{t('继续阅读')}</span>
              <h2>{continuing.title}</h2>
              <p>{continuing.chapters[currentPosition?.chapter || 0]?.title}</p>
              <div className="home-continue-progress">
                <span aria-hidden="true">
                  <i style={{ width: `${progress * 100}%` }} />
                </span>
                <b>
                  {progress.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 })}
                </b>
              </div>
            </div>
            <button
              className="home-continue-button"
              onClick={() => void readBook(continuing)}
              aria-label={t('阅读《{value0}》', { value0: continuing.title })}
            >
              <BookOpen size={18} />
              <span>{t('继续阅读')}</span>
              <ArrowRight size={16} />
            </button>
          </section>
        )}
        {!discover && (
          <section className="home-recent-strip" aria-label={t('最近阅读')}>
            <Link href="/library" className="reading-summary-card">
              <span className="text-xs text-[#a18b61]">{t('我的阅读')}</span>
              <strong>
                {books.length.toLocaleString(locale)} <small>{t('本书')}</small>
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
        <section className="home-recommendations catalog-recommendations">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="text-xl font-semibold sm:text-[22px]">
                {discover ? t('精选书城') : t('为你推荐')}
              </h2>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t('经济学与商业管理 · 英文原版')}
              </span>
            </div>
          </div>
          <div className="home-recommendation-grid">
            {recommendedBooks.map((book) => (
              <div key={book.id} className="home-recommendation-card">
                <BookCard book={book} showAuthor />
                <p className="mt-3 line-clamp-3 text-xs leading-6 text-muted-foreground">
                  {recommendationCopy(book, locale).reason}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {t('精选英文原版书目，附版本信息与官方来源；站内全文暂未开放。')}
          </p>
        </section>
        <section className="mt-12">
          <h2 className="mb-5 text-xl font-semibold">{t('可直接阅读的原创')}</h2>
          <div className="home-recommendation-grid">
            {catalog.map((book) => (
              <BookCard key={book.id} book={book} showAuthor />
            ))}
          </div>
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
              <p>{topicCopy[category]}</p>
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
          <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>
          <Link href="/me/about">{t('关于 ByPage · 逐页')}</Link>
        </footer>
      </main>
    </LibraryShell>
  );
}
