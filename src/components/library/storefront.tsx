'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/provider';
import { useLibrary } from './library-provider';
import { BookCover, LibraryShell, PageHeading } from './library-ui';
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
export function Storefront({
  initialCategory = '',
  collectionMode = false,
}: {
  initialCategory?: string;
  collectionMode?: boolean;
}) {
  const { locale } = useI18n(),
    zh = locale.startsWith('zh');
  const { data, error, retry } = useStoreCatalog();
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(initialCategory),
    [collection, setCollection] = useState('');
  const chosenCollection = data?.collections.find((c) => c.id === collection);
  let books =
    data?.books.filter(
      (b) =>
        (!category || b.category === category) &&
        (!collection || b.collectionIds.includes(collection)) &&
        `${b.title} ${b.author} ${b.description}`
          .toLowerCase()
          .includes(query.toLowerCase().trim()),
    ) || [];
  if (chosenCollection)
    books = [...books].sort(
      (a, b) =>
        chosenCollection.items.findIndex((i) => i.bookId === a.id) -
        chosenCollection.items.findIndex((i) => i.bookId === b.id),
    );
  return (
    <section className="my-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[.18em] text-primary">LeafRead Library</p>
          <h2 className="text-2xl font-semibold">
            {zh ? '值得重读的经典' : 'Classics to return to'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {zh
              ? '完整原文 · 免费下载 · 离线阅读。登录后可翻译，边读边对照。'
              : 'Complete books, free to download and read offline. Sign in to translate as you read.'}
          </p>
        </div>
        <input
          aria-label={zh ? '搜索书城' : 'Search bookstore'}
          className="rounded-full border bg-white px-5 py-3 text-sm"
          placeholder={zh ? '书名、作者…' : 'Title or author…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {['', ...new Set(data?.books.map((b) => b.category))].map((c) => (
          <button
            key={c}
            className={`rounded-full border px-4 py-2 text-sm ${category === c ? 'border-primary bg-primary/10 text-primary' : 'bg-white'}`}
            onClick={() => setCategory(c)}
          >
            {c || (zh ? '全部' : 'All')}
          </button>
        ))}
      </div>
      {!!data?.collections.length && (
        <div className="flex flex-wrap gap-2">
          <button
            className={`text-sm ${!collection ? 'font-semibold' : 'text-muted-foreground'}`}
            onClick={() => setCollection('')}
          >
            {zh ? '全部书单' : 'All collections'}
          </button>
          {data.collections.map((c) => (
            <button
              key={c.id}
              className={`rounded-lg px-3 py-2 text-sm ${collection === c.id ? 'bg-primary/10 text-primary' : 'bg-white'}`}
              onClick={() => setCollection(c.id)}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}
      {(chosenCollection?.description || collectionMode) && (
        <p className="text-sm text-muted-foreground">
          {chosenCollection?.description ||
            (zh ? '挑一本书，开始新的阅读旅程。' : 'Find your next reading journey.')}
        </p>
      )}
      {error ? (
        <div role="alert" className="rounded-2xl bg-white p-8">
          <p>
            {zh
              ? '书城暂时无法连接，已下载的书仍可从书架阅读。'
              : 'The bookstore is unavailable. Downloaded books are still on your shelf.'}
          </p>
          <button className="library-primary mt-4" onClick={retry}>
            {zh ? '重试' : 'Retry'}
          </button>
        </div>
      ) : !data ? (
        <p role="status">{zh ? '正在打开书城…' : 'Opening bookstore…'}</p>
      ) : !books.length ? (
        <p>{zh ? '暂时没有符合条件的书。' : 'No books match your search.'}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
          {books.map((b) => (
            <Link href={`/store/${b.slug}`} key={b.id} className="group">
              <div className="max-w-[180px] transition-transform group-hover:-translate-y-1">
                <BookCover book={b} />
              </div>
              <h3 className="mt-4 font-semibold leading-6">{b.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{b.author}</p>
              <p className="mt-3 text-xs text-primary">
                {zh ? '免费 · 完整原文' : 'Free · Complete edition'}
              </p>
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
    <LibraryShell>
      <main className="library-container">
        <PageHeading title={zh ? '书籍详情' : 'Book details'} back="/discover" />
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
                <p className="mb-3 text-xs uppercase tracking-widest text-primary">
                  {book.category} · {book.language}
                </p>
                <h1 className="text-3xl font-semibold leading-tight">{book.title}</h1>
                <p className="mt-3 text-muted-foreground">{book.author}</p>
                <p className="my-5 max-w-2xl whitespace-pre-line text-sm leading-7">
                  {book.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {book.chapterCount} {zh ? '个章节' : 'chapters'} ·{' '}
                  {(book.byteLength / 1048576).toFixed(1)} MB ·{' '}
                  {zh ? '完整原文' : 'Complete edition'}
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
                  <button
                    className="library-secondary"
                    disabled={busy || !!saved}
                    onClick={() => void download(book, false)}
                  >
                    {saved ? (zh ? '已在书架' : 'On your shelf') : zh ? '加入书架' : 'Add to shelf'}
                  </button>
                </div>
                <p role="status" className="mt-4 text-sm">
                  {message}
                </p>
              </div>
            </section>
            <section className="my-8 rounded-2xl bg-white p-6 text-sm leading-7">
              <h2 className="font-semibold">
                {zh ? '用你熟悉的语言阅读' : 'Read in your language'}
              </h2>
              <p className="mt-2 text-muted-foreground">
                {zh
                  ? '下载后打开书籍，在翻译准备中选择目标语言并开始翻译。登录即可使用 LeafRead 翻译服务；完成的译文保存在本地，可用双语模式阅读。'
                  : 'Open the downloaded book and prepare a translation in your preferred language. Sign in to use LeafRead translation. Completed translations stay on your device for bilingual reading.'}
              </p>
              {book.sourceUrl && (
                <a
                  href={book.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-block text-primary underline"
                >
                  {zh ? '查看原文来源 ↗' : 'View source edition ↗'}
                </a>
              )}
            </section>
          </>
        )}
      </main>
    </LibraryShell>
  );
}
