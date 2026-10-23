'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { useLibrary } from './library-provider';
import { BookCover, LibraryShell } from './library-ui';
import {
  downloadStoreBook,
  type StoreBook,
  type StoreCatalog,
} from '../../../packages/reading-core/src/storefront';

export function useStoreCatalog() {
  const [data, setData] = useState<StoreCatalog | null>(null),
    [error, setError] = useState(false),
    [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch('/api/catalog', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
        const data = await response.json();
        if (!controller.signal.aborted) setData(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error('catalog.load', error);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [attempt]);
  return { data, error, retry: () => retry((n) => n + 1) };
}
export function Storefront({ preview = false }: { preview?: boolean }) {
  const { t, locale } = useI18n();
  const zh = locale.startsWith('zh');
  const { data, error, retry } = useStoreCatalog();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [collection, setCollection] = useState('');
  const chosenCollection = data?.collections.find((entry) => entry.id === collection);
  let books =
    data?.books.filter(
      (book) =>
        (!category || book.category === category) &&
        (!collection || book.collectionIds.includes(collection)) &&
        `${book.title} ${book.author} ${book.description}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    ) || [];
  if (chosenCollection) {
    books = [...books].sort(
      (a, b) =>
        chosenCollection.items.findIndex((item) => item.bookId === a.id) -
        chosenCollection.items.findIndex((item) => item.bookId === b.id),
    );
  }
  if (preview) books = books.slice(0, 4);

  return (
    <section className="my-8 space-y-6" aria-label={t('书城')}>
      {preview ? (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{t('书城')}</h2>
          <Link href="/discover" className="text-sm text-primary">
            {t('全部书籍')}
          </Link>
        </div>
      ) : (
        <>
          <input
            type="search"
            aria-label={zh ? '搜索书城' : 'Search bookstore'}
            className="w-full rounded-xl border bg-transparent px-4 py-3 text-sm"
            placeholder={zh ? '书名、作者' : 'Title or author'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!!data && (
            <div className="flex flex-wrap gap-4">
              <select
                aria-label={t('分类')}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="min-h-11 max-w-full bg-transparent pe-5 text-sm"
              >
                <option value="">{t('全部')}</option>
                {[...new Set(data.books.map((book) => book.category))].map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
              {!!data.collections.length && (
                <select
                  aria-label={t('书单')}
                  value={collection}
                  onChange={(event) => setCollection(event.target.value)}
                  className="min-h-11 max-w-full bg-transparent pe-5 text-sm"
                >
                  <option value="">{zh ? '全部书单' : 'All collections'}</option>
                  {data.collections.map((entry) => (
                    <option value={entry.id} key={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </>
      )}
      {error ? (
        <div role="alert" className="py-6 text-sm">
          <p>
            {zh
              ? '书城暂时无法连接，已下载的书仍可从书架阅读。'
              : 'The bookstore is unavailable. Downloaded books are still on your shelf.'}
          </p>
          <button className="library-primary mt-4" onClick={retry}>
            {t('重试')}
          </button>
        </div>
      ) : !data ? (
        <p role="status">{zh ? '正在打开书城…' : 'Opening bookstore…'}</p>
      ) : !books.length ? (
        <p>{zh ? '暂时没有符合条件的书。' : 'No books match your search.'}</p>
      ) : (
        <div
          className={`grid grid-cols-2 gap-x-6 gap-y-10 ${preview ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-4'}`}
        >
          {books.map((book) => (
            <Link href={`/store/${book.slug}`} key={book.id}>
              <div className="max-w-[180px]">
                <BookCover book={book} />
              </div>
              <h3 className="mt-4 font-medium leading-6">{book.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{book.author}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
export function StoreBookPage({ slug }: { slug: string }) {
  const { locale } = useI18n(),
    zh = locale.startsWith('zh');
  const { data, error, retry } = useStoreCatalog();
  const { allBooks, readBook, addBook } = useLibrary();
  const book = data?.books.find((b) => b.slug === slug);
  const saved = allBooks.find((b) => b.id === book?.editionId);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [message, setMessage] = useState('');
  useEffect(() => {
    setMessage('');
  }, [slug]);
  async function download(entry: StoreBook, read: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setProgress(0);
    try {
      const full =
        saved ||
        (await downloadStoreBook(
          entry,
          await fetch(`/api/catalog/${entry.slug}/download?edition=${entry.editionId}`),
          setProgress,
        ));
      if (read) await readBook(full);
      else {
        await addBook(full);
        setMessage(
          zh ? '已下载，可从书架离线阅读。' : 'Downloaded. Read it offline from your shelf.',
        );
      }
    } catch (e) {
      console.error('catalog.download', { slug }, e);
      setMessage(
        zh
          ? '下载未完成，请重试。若书目有更新，请刷新页面。'
          : 'Download failed. Please retry, or refresh if the edition has changed.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <LibraryShell hideNavigation>
      <main className="library-container">
        <Link
          href="/discover"
          aria-label={zh ? '返回书城' : 'Back to bookstore'}
          className="-ms-2 flex size-11 items-center justify-center rounded-full hover:bg-black/5"
        >
          <ChevronLeft size={25} />
        </Link>
        {error ? (
          <button onClick={retry}>{zh ? '书城连接失败，点击重试' : 'Unable to load. Retry'}</button>
        ) : !data ? (
          <p>{zh ? '加载中…' : 'Loading…'}</p>
        ) : !book ? (
          <p>
            {zh
              ? '这本书已下架。已下载的副本仍在你的书架中。'
              : 'This book is no longer listed. Your downloaded copy remains on your shelf.'}
          </p>
        ) : (
          <>
            <section className="grid gap-8 py-6 sm:grid-cols-[180px_1fr]">
              <BookCover book={book} />
              <div>
                <p className="mb-3 text-xs text-muted-foreground">
                  {book.category} · {book.language}
                </p>
                <h1 className="text-3xl font-semibold leading-tight">{book.title}</h1>
                <p className="mt-3 text-muted-foreground">{book.author}</p>
                <p className="my-5 max-w-2xl whitespace-pre-line text-sm leading-7">
                  {book.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {book.chapterCount} {zh ? '个章节' : 'chapters'} ·{' '}
                  {(book.byteLength / 1048576).toFixed(1)} MB
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    className="library-primary"
                    disabled={busy}
                    onClick={() => void download(book, true)}
                  >
                    {busy
                      ? `${zh ? '下载中' : 'Downloading'} ${Math.round(progress * 100)}%`
                      : saved
                        ? zh
                          ? '继续阅读'
                          : 'Continue reading'
                        : zh
                          ? '下载并阅读'
                          : 'Download & read'}
                  </button>
                  {!saved && (
                    <button
                      className="library-secondary"
                      disabled={busy}
                      onClick={() => void download(book, false)}
                    >
                      {zh ? '加入书架' : 'Add to shelf'}
                    </button>
                  )}
                </div>
                {message && (
                  <p role="status" className="mt-4 text-sm">
                    {message}
                  </p>
                )}
                {book.sourceUrl && (
                  <a
                    href={book.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-6 inline-block text-sm text-primary"
                  >
                    {zh ? '原文来源' : 'Source edition'}
                  </a>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </LibraryShell>
  );
}
