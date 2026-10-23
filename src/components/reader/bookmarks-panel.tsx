'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkPlus, LoaderCircle, PencilLine, Search, Trash2 } from 'lucide-react';
import type { Book, Bookmark as ReadingBookmark } from '../../../packages/reading-core/src';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReadingPanel } from './reading-controls';

export function BookmarksPanel({
  book,
  bookmarks,
  open,
  onOpenChange,
  add,
  visit,
  change,
}: {
  book: Book;
  bookmarks: ReadingBookmark[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  add: () => Promise<void>;
  visit: (bookmark: ReadingBookmark) => Promise<void>;
  change: (bookmark: ReadingBookmark, label: string | null) => Promise<void>;
}) {
  const { t, text: localize } = useI18n();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const [editing, setEditing] = useState<ReadingBookmark | null>(null);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setQuery('');
    setLimit(50);
    setEditing(null);
    setPending(null);
    pendingRef.current = false;
    setError('');
  }, [book.id, open]);
  const ordered = useMemo(() => {
    const order = new Map(book.chapters.flatMap((c) => c.paragraphs).map((p, i) => [p.id, i]));
    return [...bookmarks].sort(
      (a, b) =>
        (order.get(a.position.paragraph) ?? 0) - (order.get(b.position.paragraph) ?? 0) ||
        (a.position.textOffset ?? 0) - (b.position.textOffset ?? 0) ||
        a.createdAt - b.createdAt,
    );
  }, [book.chapters, bookmarks]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term
      ? ordered.filter((item) =>
          [item.label, item.quote, book.chapters[item.position.chapter]?.title || ''].some((text) =>
            text.toLocaleLowerCase().includes(term),
          ),
        )
      : ordered;
  }, [ordered, book.chapters, query]);
  async function perform(id: string, action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const token = generation.current;
    setPending(id);
    setError('');
    try {
      await action();
      if (token === generation.current) setEditing(null);
    } catch (cause) {
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : t('书签操作失败，请重试。'));
    } finally {
      if (token === generation.current) {
        pendingRef.current = false;
        setPending(null);
      }
    }
  }
  return (
    <ReadingPanel open={open} onOpenChange={onOpenChange} title={t('书签')}>
      <div className="shrink-0 space-y-3 px-7 pb-4">
        <Button
          className="w-full rounded-full"
          disabled={!!pending}
          onClick={() => void perform('add', add)}
        >
          {pending === 'add' ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            <BookmarkPlus size={17} />
          )}
          {t('添加当前位置书签')}
        </Button>
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute start-3 top-3 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
            }}
            placeholder={t('搜索书签')}
            aria-label={t('搜索书签')}
            className="h-10 rounded-full border-0 bg-muted ps-10"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('{count} 个书签', { count: filtered.length })}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {localize(error)}
          </p>
        )}
      </div>
      <div className="reading-bookmarks min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8">
        {!filtered.length && (
          <div className="px-3 py-12 text-center text-muted-foreground">
            <Bookmark size={28} strokeWidth={1.3} className="mx-auto mb-4" />
            <p className="text-sm">{query.trim() ? t('没有找到匹配的书签。') : t('还没有书签')}</p>
            {!query.trim() && (
              <p className="mt-2 text-xs leading-relaxed">
                {t('保存当前位置，稍后从这里继续阅读。')}
              </p>
            )}
          </div>
        )}
        {filtered.slice(0, limit).map((item) => (
          <div key={item.id} className="border-b border-border/60 px-2 py-3 last:border-0">
            {editing?.id === item.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(item.id, () => change(editing, label.trim()));
                }}
                className="space-y-3"
              >
                <Input
                  autoFocus
                  maxLength={120}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder={t('书签名称（可选）')}
                  aria-label={t('书签名称（可选）')}
                  disabled={!!pending}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!!pending}
                    onClick={() => setEditing(null)}
                  >
                    {t('取消')}
                  </Button>
                  <Button type="submit" size="sm" disabled={!!pending}>
                    {t('保存')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="w-full rounded-lg px-1 py-2 text-start hover:bg-muted disabled:opacity-50"
                  disabled={!!pending}
                  onClick={() => void perform(item.id, () => visit(item))}
                >
                  {item.label && (
                    <p className="mb-1 break-words text-sm font-medium" dir="auto">
                      {item.label}
                    </p>
                  )}
                  <p className="line-clamp-3 break-words text-sm leading-relaxed" dir="auto">
                    {item.quote || localize(book.chapters[item.position.chapter]?.title || '')}
                  </p>
                  <p className="mt-2 line-clamp-1 text-xs text-muted-foreground" dir="auto">
                    {localize(book.chapters[item.position.chapter]?.title || '')} ·{' '}
                    {item.position.textSource === 'translation' ? t('译文') : t('原文')}
                  </p>
                </button>
                <div className="mt-1 flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!!pending}
                    aria-label={t('编辑书签名称')}
                    onClick={() => {
                      setEditing(item);
                      setLabel(item.label);
                      setError('');
                    }}
                  >
                    <PencilLine size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!!pending}
                    aria-label={t('删除书签')}
                    onClick={() => void perform(item.id, () => change(item, null))}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
        {filtered.length > limit && (
          <Button
            variant="ghost"
            className="mt-4 w-full rounded-full"
            onClick={() => setLimit((value) => value + 50)}
          >
            {t('加载更多书签')}
          </Button>
        )}
      </div>
    </ReadingPanel>
  );
}
