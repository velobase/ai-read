'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { searchBookPassages, type PassageMatch, type PassageSearch } from '@/lib/book-search';
import { displayLanguage } from '@/lib/i18n/config';
import type { Book } from '@/lib/types';

export type ReaderSearchSource = 'original' | 'translation';
export const READER_SEARCH_PAGE_SIZE = 60;

export function useReaderBookSearch({
  book,
  query,
  source,
  language,
  page,
  enabled,
}: {
  book: Book;
  query: string;
  source: ReaderSearchSource;
  language: string;
  page: number;
  enabled: boolean;
}) {
  const text = query.trim().slice(0, 160);
  const identity = JSON.stringify([book.id, text, source, language, page]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    book: Book;
    identity: string;
    revision: number;
    status: 'loading' | 'ready' | 'failed';
    data?: PassageSearch;
  }>();
  useEffect(() => {
    if (!enabled || source !== 'translation') return;
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener('bypage-translations', changed);
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bypage-translations') : null;
    if (channel) channel.onmessage = changed;
    return () => {
      window.removeEventListener('bypage-translations', changed);
      channel?.close();
    };
  }, [enabled, source]);
  useEffect(() => {
    if (!enabled || !text) return;
    const controller = new AbortController();
    const request = { book, identity, revision };
    setResult({ ...request, status: 'loading' });
    const timer = setTimeout(() => {
      void searchBookPassages([book], text, {
        source,
        language: source === 'translation' ? language || undefined : undefined,
        signal: controller.signal,
        limit: READER_SEARCH_PAGE_SIZE,
        offset: page * READER_SEARCH_PAGE_SIZE,
      })
        .then((data) => {
          if (!controller.signal.aborted) setResult({ ...request, status: 'ready', data });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ ...request, status: 'failed' });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [book, text, source, language, page, identity, enabled, revision]);
  const current =
    result?.book === book && result.identity === identity && result.revision === revision
      ? result
      : undefined;
  return {
    identity,
    data: current?.status === 'ready' ? current.data : undefined,
    loading: enabled && !!text && (!current || current.status === 'loading'),
    failed: current?.status === 'failed',
    retry: () => setRevision((value) => value + 1),
  };
}

export function ReaderSearchMatches({
  state,
  source,
  locale,
  open,
  onReady,
  page,
  changePage,
  opening,
}: {
  state: ReturnType<typeof useReaderBookSearch>;
  source: ReaderSearchSource;
  locale: string;
  open: (match: PassageMatch) => Promise<void>;
  onReady: () => void;
  page: number;
  changePage: (page: number) => void;
  opening: boolean;
}) {
  const zh = locale.startsWith('zh');
  const [openFailed, setOpenFailed] = useState(false);
  const alive = useRef(true);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state.data && !state.loading) ready.current();
  }, [state.data, state.loading]);
  useEffect(() => setOpenFailed(false), [state.identity]);
  let body;
  if (state.failed)
    body = (
      <div className="space-y-3 px-3 py-6 text-sm" role="status">
        <p>
          {zh
            ? '无法读取本机搜索内容，请重试。'
            : 'Could not read local search content. Try again.'}
        </p>
        <Button variant="outline" size="sm" disabled={opening} onClick={state.retry}>
          {zh ? '重试' : 'Retry'}
        </Button>
      </div>
    );
  else if (state.loading || !state.data)
    body = (
      <div
        className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="size-4 animate-spin" />
        {zh ? '正在搜索本机内容…' : 'Searching local content…'}
      </div>
    );
  else if (!state.data.matches.length)
    body = (
      <p className="px-3 py-8 text-sm text-muted-foreground" role="status">
        {source === 'translation'
          ? zh
            ? '本机已保存译文中没有匹配。只搜索已下载内容，不会生成译文。'
            : 'No match in saved translations. Only downloaded text is searched; no translation is generated.'
          : zh
            ? '没有找到匹配的内容'
            : 'No matching content found'}
      </p>
    );
  else
    body = (
      <>
        {openFailed && (
          <p className="px-3 py-3 text-sm text-destructive" role="alert">
            {zh ? '暂时无法打开这处内容，请重试。' : 'Could not open this passage. Try again.'}
          </p>
        )}
        {state.data.matches.map((match) => (
          <Button
            variant="plain"
            size="plain"
            key={`${match.paragraphId}:${match.source === 'translation' ? match.translationKey : 'original'}`}
            disabled={opening}
            className="block w-full border-b px-3 py-4 text-start text-sm leading-7 hover:bg-muted"
            onClick={() => {
              setOpenFailed(false);
              void open(match).catch(() => {
                if (alive.current) setOpenFailed(true);
              });
            }}
          >
            <span className="mb-1 block text-xs text-muted-foreground">
              {match.chapterTitle}
              {match.source === 'translation' && (
                <span className="ms-2">
                  {displayLanguage(match.language || '', locale) || match.language}
                  {match.editionLabel ? ` · ${match.editionLabel}` : ''}
                </span>
              )}
            </span>
            <span dir="auto">
              {match.excerpt.slice(0, match.matchStart)}
              <mark>{match.excerpt.slice(match.matchStart, match.matchEnd)}</mark>
              {match.excerpt.slice(match.matchEnd)}
            </span>
          </Button>
        ))}
      </>
    );
  const count = state.data?.matches.length || 0;
  const first = page * READER_SEARCH_PAGE_SIZE + 1;
  return (
    <>
      <div className="sticky top-0 z-10 space-y-2 border-b bg-background px-3 py-3">
        <p className="text-xs text-muted-foreground" role="status">
          {zh ? `第 ${page + 1} 页` : `Page ${page + 1}`}
          {count
            ? zh
              ? ` · 第 ${first}–${first + count - 1} 处匹配`
              : ` · Matches ${first}–${first + count - 1}`
            : ''}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || state.loading || opening}
            onClick={() => changePage(page - 1)}
          >
            {zh ? '上一页' : 'Previous page'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!state.data?.limited || state.loading || opening}
            onClick={() => changePage(page + 1)}
          >
            {zh ? '下一页' : 'Next page'}
          </Button>
        </div>
      </div>
      {body}
    </>
  );
}
