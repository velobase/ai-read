'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { BookOpen, ChevronRight, FileText, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import { catalog, categories, bookDescription } from '@/lib/catalog';
import type { Book } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  normalizeSearch,
  searchBookPassages,
  type PassageMatch,
  type PassageSearch,
} from '@/lib/book-search';
import { measureClient } from '@/lib/observability/client';
import { useI18n } from '@/lib/i18n/provider';
import { readingLanguages, displayLanguage } from '@/lib/i18n/config';
import { useLibrary } from './library-provider';
import { BookCover, Empty, LibraryShell, PageHeading } from './library-ui';

type SearchTab = 'all' | 'books' | 'passages' | 'notes';
const emptySearch: PassageSearch = { matches: [], limited: false, scannedBooks: 0 };
const PAGE_SIZE = 60;

function searchPage(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE)
    ? page
    : 1;
}

export function SearchPage() {
  const { t, text, locale } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const [routing, startTransition] = useTransition();
  const page = searchPage(params.get('page'));
  const offset = (page - 1) * PAGE_SIZE;
  const query = (params.get('q') || '').trim().slice(0, 160);
  const source = params.get('source') === 'translation' ? 'translation' : 'original';
  const language = readingLanguages.some(([code]) => code === params.get('lang'))
    ? params.get('lang')!
    : '';
  const zh = locale.startsWith('zh');
  const copy = {
    original: zh ? '原文' : 'Original',
    saved: zh ? '已保存译文' : 'Saved translations',
    allLanguages: zh ? '所有译文语言' : 'All saved languages',
    language: zh ? '译文语言' : 'Translation language',
    local: zh
      ? '仅搜索本机已保存的译文，不下载或生成新译文。'
      : 'Searches translations saved on this device. Nothing is downloaded or generated.',
    searching: zh ? '正在本机检索已保存译文…' : 'Searching saved translations on this device…',
    empty: zh
      ? '换一个语言或关键词。这里仅搜索本机已经保存的译文。'
      : 'Try another language or query. Only translations already saved on this device are searched.',
  };
  const { allBooks, notes, readBook, ready } = useLibrary();
  const tab = (
    ['books', 'passages', 'notes'].includes(params.get('tab') || '') ? params.get('tab') : 'all'
  ) as SearchTab;
  const bookFilter = params.get('book') || '';
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const passageHeading = useRef<HTMLHeadingElement>(null);
  const focusPage = useRef<string | null>(null);
  const changeScope = (key: 'tab' | 'book' | 'source' | 'lang', value: string) => {
    if (openingRef.current) return;
    const next = new URLSearchParams(params.toString());
    if (!value || (key === 'tab' && value === 'all') || (key === 'source' && value === 'original'))
      next.delete(key);
    else next.set(key, value);
    if (key !== 'tab') next.delete('page');
    focusPage.current = null;
    startTransition(() => router.replace(`/search?${next}`, { scroll: false }));
  };
  const [passageResult, setPassages] = useState<PassageSearch>(emptySearch);
  const [resultScope, setResultScope] = useState('');
  const baseScope = JSON.stringify([query, source, language, bookFilter]);
  const searchScope = JSON.stringify([baseScope, page]);
  const activeScope = useRef(searchScope);
  activeScope.current = searchScope;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const passages = resultScope === searchScope ? passageResult : emptySearch;
  const [searching, setSearching] = useState(false);
  const [failedScope, setFailedScope] = useState('');
  const failed = failedScope === searchScope;
  const [scannedBooks, setScannedBooks] = useState(0);
  const [retry, setRetry] = useState(0);
  const [bookLimit, setBookLimit] = useState(40);
  const [noteLimit, setNoteLimit] = useState(40);
  const all = useMemo(
    () =>
      Array.from(
        new Map<string, Book>([...catalog, ...allBooks].map((book) => [book.id, book])).values(),
      ),
    [allBooks],
  );
  const booksById = useMemo(() => new Map(allBooks.map((book) => [book.id, book])), [allBooks]);
  const needle = normalizeSearch(query);
  const found = useMemo(
    () =>
      query
        ? all.filter((book) =>
            normalizeSearch(
              `${book.title} ${book.subtitle || ''} ${book.author} ${book.category || ''}`,
            ).includes(needle),
          )
        : [],
    [all, needle, query],
  );
  const foundNotes = useMemo(
    () =>
      query
        ? notes.filter(
            (note) =>
              (!bookFilter || note.bookId === bookFilter) &&
              normalizeSearch(`${note.quote} ${note.text}`).includes(needle),
          )
        : [],
    [notes, needle, query, bookFilter],
  );
  const visibleBooks = bookFilter ? found.filter((book) => book.id === bookFilter) : found;
  const changePage = (nextPage: number) => {
    if (
      openingRef.current ||
      routing ||
      !Number.isSafeInteger(nextPage) ||
      nextPage < 1 ||
      nextPage > Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZE)
    )
      return;
    const next = new URLSearchParams(params.toString());
    if (nextPage === 1) next.delete('page');
    else next.set('page', String(nextPage));
    focusPage.current = JSON.stringify([baseScope, nextPage]);
    startTransition(() => router.push(`/search?${next}`, { scroll: false }));
  };
  const openPassage = async (match: PassageMatch) => {
    const book = booksById.get(match.bookId);
    if (!book || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setOpenFailed(false);
    const startedScope = searchScope;
    const origin = window.location.pathname + window.location.search;
    const isCurrent = () =>
      mounted.current &&
      activeScope.current === startedScope &&
      window.location.pathname + window.location.search === origin;
    try {
      await readBook(
        book,
        match.paragraphId,
        undefined,
        match.sourceStart,
        match.source === 'translation'
          ? {
              language: match.language,
              translationKey: match.translationKey,
              textHash: match.textHash,
              sourceEnd: match.sourceEnd,
            }
          : undefined,
        isCurrent,
      );
    } catch {
      if (isCurrent()) setOpenFailed(true);
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  };
  useEffect(() => {
    setBookLimit(40);
    setNoteLimit(40);
    setOpenFailed(false);
  }, [baseScope]);
  useEffect(() => {
    const controller = new AbortController();
    setPassages(emptySearch);
    setScannedBooks(0);
    setFailedScope('');
    if (!query || !ready) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const measured = measureClient('search');
    // Give the submitted query and loading state a paint before scanning large books.
    const timer = setTimeout(() => {
      void searchBookPassages(
        bookFilter ? allBooks.filter((book) => book.id === bookFilter) : allBooks,
        query,
        {
          signal: controller.signal,
          onProgress: setScannedBooks,
          source,
          language: language || undefined,
          offset,
          limit: PAGE_SIZE,
        },
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setPassages(result);
          setResultScope(searchScope);
          setSearching(false);
          measured('ok', { count: result.matches.length });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFailedScope(searchScope);
          setSearching(false);
          measured('error');
        });
    }, 80);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, ready, allBooks, bookFilter, source, language, searchScope, offset, retry]);
  useEffect(() => {
    if (focusPage.current !== searchScope || resultScope !== searchScope || searching) return;
    focusPage.current = null;
    passageHeading.current?.focus({ preventScroll: true });
    passageHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [searchScope, resultScope, searching]);
  useEffect(() => {
    if (source !== 'translation') return;
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener('bypage-translations', refresh);
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bypage-translations');
    channel?.addEventListener('message', refresh);
    return () => {
      window.removeEventListener('bypage-translations', refresh);
      channel?.close();
    };
  }, [source]);
  const showBooks = tab === 'all' || tab === 'books';
  const showNotes = tab === 'all' || tab === 'notes';
  const showPassages = tab === 'all' || tab === 'passages';
  const pending =
    routing || searching || (!!query && (!ready || (resultScope !== searchScope && !failed)));
  return (
    <LibraryShell>
      <main className="library-container search-page">
        <PageHeading title={t('搜索')} back="/" />
        <form
          role="search"
          className="library-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (openingRef.current) return;
            const next = new URLSearchParams(params.toString());
            const value = String(new FormData(event.currentTarget).get('q') || '')
              .trim()
              .slice(0, 160);
            if (value) next.set('q', value);
            else next.delete('q');
            next.delete('page');
            focusPage.current = null;
            startTransition(() => router.push(`/search?${next}`));
          }}
        >
          <Search size={20} className="shrink-0 text-muted-foreground" />
          <input
            key={query}
            name="q"
            defaultValue={query}
            aria-label={t('搜索')}
            placeholder={source === 'translation' ? copy.saved : text('搜索书名、作者、正文或笔记')}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={160}
            disabled={opening}
          />
          <button
            type="submit"
            disabled={opening}
            className="shrink-0 border-s border-black/10 ps-3 text-sm disabled:opacity-50"
          >
            {t('搜索')}
          </button>
        </form>
        <div className="search-tools">
          <div className="search-tabs" role="group" aria-label={text('搜索范围')}>
            {(['original', 'translation'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={source === value ? 'active' : ''}
                aria-pressed={source === value}
                disabled={opening}
                onClick={() => changeScope('source', value)}
              >
                {value === 'original' ? copy.original : copy.saved}
              </button>
            ))}
          </div>
          {source === 'translation' && (
            <label className="search-book-filter">
              <span>{copy.language}</span>
              <select
                value={language}
                aria-label={copy.language}
                disabled={opening}
                onChange={(event) => changeScope('lang', event.target.value)}
              >
                <option value="">{copy.allLanguages}</option>
                {readingLanguages.map(([code, label]) => (
                  <option key={code} value={code}>
                    {displayLanguage(code, locale) || label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {source === 'translation' && <p className="search-local-status">{copy.local}</p>}
        {!query ? (
          <>
            <div className="search-local-intro">
              <Search size={23} />
              <h2>{text('在书页间找到答案')}</h2>
              <p>{text('搜索书名、作者、正文或笔记。正文检索在当前设备完成，无需 AI。')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {categories.slice(1).map((category) => (
                <Link
                  href={`/categories?category=${encodeURIComponent(category)}`}
                  key={category}
                  className="rounded-full bg-white px-5 py-3 text-sm"
                >
                  {text(category)}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="search-tools">
              <div className="search-tabs" role="group" aria-label={text('搜索范围')}>
                {(
                  [
                    ['all', text('全部'), undefined],
                    ['books', text('书籍'), visibleBooks.length],
                    ['passages', source === 'translation' ? copy.saved : text('正文'), undefined],
                    ['notes', text('笔记'), foundNotes.length],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={tab === value}
                    className={tab === value ? 'active' : ''}
                    disabled={opening}
                    onClick={() => changeScope('tab', value)}
                  >
                    {label}
                    {count !== undefined && <span>{count.toLocaleString(locale)}</span>}
                  </button>
                ))}
              </div>
              <label className="search-book-filter">
                <BookOpen size={15} />
                <select
                  value={bookFilter}
                  aria-label={text('限定书籍')}
                  disabled={opening}
                  onChange={(event) => changeScope('book', event.target.value)}
                >
                  <option value="">{text('所有书籍')}</option>
                  {allBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="search-local-status" role="status" aria-live="polite">
              {pending ? (
                <>
                  <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />
                  {source === 'translation'
                    ? `${copy.searching} ${scannedBooks}`
                    : text('正在本机检索正文…已查看 {count} 本书', { count: scannedBooks })}
                </>
              ) : (
                <>
                  <ShieldCheck size={14} />
                  {source === 'translation'
                    ? copy.local
                    : text('正文仅在本机搜索，搜索词不会用于统计。')}
                </>
              )}
            </p>
            {showBooks && visibleBooks.length > 0 && (
              <section className="search-result-group">
                <h2>{t('书籍')}</h2>
                {visibleBooks.slice(0, bookLimit).map((book) => (
                  <Link className="search-book-row" href={`/books/${book.id}`} key={book.id}>
                    <BookCover book={book} />
                    <div className="min-w-0 flex-1">
                      <h3>{book.title}</h3>
                      <p className="mt-2 text-xs text-muted-foreground">{book.author}</p>
                      <p className="mt-3 line-clamp-2 text-xs leading-6 text-muted-foreground">
                        {bookDescription(book)}
                      </p>
                    </div>
                    <ChevronRight size={18} className="hidden text-muted-foreground sm:block" />
                  </Link>
                ))}
                {visibleBooks.length > bookLimit && (
                  <button
                    className="search-more"
                    onClick={() => setBookLimit((value) => value + 40)}
                  >
                    {text('显示更多结果')}
                  </button>
                )}
              </section>
            )}
            {showPassages && (passages.matches.length > 0 || failed || page > 1 || pending) && (
              <section className="search-result-group search-passages">
                <h2 ref={passageHeading} tabIndex={-1} className="scroll-mt-6 focus:outline-none">
                  <FileText size={17} />
                  {source === 'translation' ? copy.saved : text('正文')}
                </h2>
                <PassagePagination
                  page={page}
                  count={passages.matches.length}
                  hasNext={passages.limited}
                  pending={pending}
                  disabled={opening || routing}
                  failed={failed}
                  locale={locale}
                  change={changePage}
                />
                {failed && (
                  <div role="alert" className="py-5 text-sm">
                    <p>{text('正文搜索未能完成，请重试。')}</p>
                    <button
                      className="mt-3 text-primary"
                      disabled={opening}
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      {t('重试')}
                    </button>
                  </div>
                )}
                {openFailed && (
                  <p role="alert" className="py-3 text-sm text-destructive">
                    {zh
                      ? '暂时无法打开这处内容，请重试。'
                      : 'Could not open this passage. Try again.'}
                  </p>
                )}
                {!pending && !failed && page > 1 && !passages.matches.length && (
                  <div role="status" className="space-y-3 py-6 text-sm text-muted-foreground">
                    <p>
                      {zh
                        ? '这一页已没有匹配。可以返回上一页，或从第一页重新查看。'
                        : 'No matches remain on this page. Go back one page or start again from the first page.'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={opening}
                      onClick={() => changePage(1)}
                    >
                      {zh ? '返回第一页' : 'First page'}
                    </Button>
                  </div>
                )}
                {passages.matches.map((match) => (
                  <button
                    type="button"
                    className="search-passage-row"
                    key={`${match.bookId}:${match.paragraphId}:${match.source === 'translation' ? match.translationKey : 'original'}`}
                    disabled={opening || pending}
                    onClick={() => void openPassage(match)}
                  >
                    <span className="search-passage-source">
                      {booksById.get(match.bookId)?.title}
                      <ChevronRight size={12} />
                      <span>{match.chapterTitle}</span>
                      {match.source === 'translation' && (
                        <span>
                          {' '}
                          · {displayLanguage(match.language, locale) || match.language}
                          {match.editionLabel ? ` · ${match.editionLabel}` : ''}
                        </span>
                      )}
                    </span>
                    <p>
                      {match.excerpt.slice(0, match.matchStart)}
                      <mark>{match.excerpt.slice(match.matchStart, match.matchEnd)}</mark>
                      {match.excerpt.slice(match.matchEnd)}
                    </p>
                    <span className="search-passage-jump">
                      {text('阅读这一段')}
                      <ChevronRight size={13} />
                    </span>
                  </button>
                ))}
                {passages.matches.length > 0 && (
                  <PassagePagination
                    page={page}
                    count={passages.matches.length}
                    hasNext={passages.limited}
                    pending={pending}
                    disabled={opening || routing}
                    failed={failed}
                    locale={locale}
                    change={changePage}
                  />
                )}
              </section>
            )}
            {showNotes && foundNotes.length > 0 && (
              <section className="search-result-group">
                <h2>{t('笔记与划线')}</h2>
                {foundNotes.slice(0, noteLimit).map((note) => (
                  <button
                    className="search-note-row"
                    key={JSON.stringify([note.bookId, note.id])}
                    onClick={() => {
                      const book = booksById.get(note.bookId);
                      if (book) void readBook(book, note.paragraphId, note.id);
                    }}
                  >
                    <p className="line-clamp-3 text-sm leading-7">{note.text || note.quote}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('《{value0}》 · 回到原文', {
                        value0: booksById.get(note.bookId)?.title || t('书中笔记'),
                      })}
                    </p>
                  </button>
                ))}
                {foundNotes.length > noteLimit && (
                  <button
                    className="search-more"
                    onClick={() => setNoteLimit((value) => value + 40)}
                  >
                    {text('显示更多结果')}
                  </button>
                )}
              </section>
            )}
            {!pending &&
              !failed &&
              !(showPassages && page > 1) &&
              !(
                (showBooks && visibleBooks.length) ||
                (showPassages && passages.matches.length) ||
                (showNotes && foundNotes.length)
              ) && (
                <Empty
                  title={t('没有找到相关内容')}
                  description={
                    source === 'translation'
                      ? copy.empty
                      : t('换一个关键词，或先把这本书导入书架。')
                  }
                />
              )}
          </>
        )}
      </main>
    </LibraryShell>
  );
}

function PassagePagination({
  page,
  count,
  hasNext,
  pending,
  disabled,
  failed,
  locale,
  change,
}: {
  page: number;
  count: number;
  hasNext: boolean;
  pending: boolean;
  disabled: boolean;
  failed: boolean;
  locale: string;
  change: (page: number) => void;
}) {
  const zh = locale.startsWith('zh');
  if (page === 1 && !count && !pending && !failed) return null;
  const number = (value: number) => value.toLocaleString(locale);
  const range = count
    ? `${number((page - 1) * PAGE_SIZE + 1)}–${number((page - 1) * PAGE_SIZE + count)}`
    : '';
  return (
    <nav
      aria-label={zh ? '正文搜索分页' : 'Passage search pages'}
      className="my-4 flex flex-wrap items-center gap-3"
    >
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || page === 1}
        onClick={() => change(page - 1)}
      >
        {zh ? '上一页' : 'Previous'}
      </Button>
      <p role="status" className="min-w-24 flex-1 text-center text-xs text-muted-foreground">
        {zh ? `第 ${number(page)} 页` : `Page ${number(page)}`}
        {!pending && !failed && range ? (zh ? ` · 第 ${range} 处匹配` : ` · Matches ${range}`) : ''}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending || failed || !hasNext}
        onClick={() => change(page + 1)}
      >
        {zh ? '下一页' : 'Next'}
      </Button>
    </nav>
  );
}
