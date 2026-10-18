'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Circle,
  FolderPlus,
  Pin,
  Archive,
  MoreHorizontal,
  RotateCcw,
  Grid2X2,
  List,
  BookOpen,
  NotebookPen,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Modal } from '@/components/reader/reader-dialogs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Book } from '@/lib/types';
import { readingProgress } from '@/lib/reading-progress';
import { useLibrary } from './library-provider';
import { BookCover, Empty, ImportButton, LibraryShell, PageHeading, SearchBar } from './library-ui';

export function BookshelfPage() {
  const { t, locale } = useI18n();
  const { allBooks, books, state, positions, updateBooks, createGroup, readBook, openImport } =
    useLibrary();
  const search = useSearchParams();
  const router = useRouter();
  const sort = search.get('sort') || 'default';
  const filter = search.get('filter') || 'all';
  const group = search.get('group') || '';
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [list, setList] = useState(false);
  const [menu, setMenu] = useState<Book | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupName, setGroupName] = useState('');
  const change = (key: string, value: string) => {
    const params = new URLSearchParams(search.toString());
    params.set(key, value);
    router.replace(`/library?${params}`, { scroll: false });
  };
  const source = filter === 'hidden' ? allBooks.filter((b) => state.books[b.id]?.hidden) : books;
  const visible = source
    .filter(
      (b) =>
        (!group || state.books[b.id]?.group === group) &&
        (['all', 'hidden'].includes(filter) ||
          (state.books[b.id]?.status || (positions[b.id] ? 'reading' : 'unread')) === filter),
    )
    .sort((a, b) => {
      const pin =
        Number(Boolean(state.books[b.id]?.pinned)) - Number(Boolean(state.books[a.id]?.pinned));
      if (pin) return pin;
      if (sort === 'title') return a.title.localeCompare(b.title, locale);
      if (sort === 'category') return (a.category || '').localeCompare(b.category || '', locale);
      if (sort === 'imported') return b.importedAt - a.importedAt;
      if (sort === 'progress')
        return (
          readingProgress(b.chapters, positions[b.id]) -
          readingProgress(a.chapters, positions[a.id])
        );
      return (
        (state.books[b.id]?.lastOpenedAt || b.importedAt) -
        (state.books[a.id]?.lastOpenedAt || a.importedAt)
      );
    });
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const finish = () => {
    setSelecting(false);
    setSelected([]);
  };
  const batch = (patch: Parameters<typeof updateBooks>[1]) => {
    updateBooks(selected, patch);
    finish();
  };
  return (
    <LibraryShell hideNavigation={selecting}>
      <main className="library-container shelf-page">
        <SearchBar className="shelf-search" />
        <PageHeading
          title={
            selecting ? t('选择书籍') : group || (filter === 'hidden' ? t('已收起的书') : t('书架'))
          }
          subtitle={!selecting ? t('{count} 本书', { count: visible.length }) : undefined}
        >
          {selecting ? (
            <>
              <button
                className="text-sm text-primary"
                onClick={() =>
                  setSelected(selected.length === visible.length ? [] : visible.map((b) => b.id))
                }
              >
                {selected.length === visible.length ? t('取消全选') : t('全选')}
              </button>
              <button className="text-sm text-muted-foreground" onClick={finish}>
                {t('取消')}
              </button>
            </>
          ) : (
            <>
              <ImportButton />
              <button
                onClick={() => setSelecting(true)}
                className="flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"
              >
                <CheckCircle2 size={17} />
                {t('选择')}
              </button>
            </>
          )}
        </PageHeading>
        <div className="shelf-toolbar">
          <div className="shelf-sort">
            {[
              ['default', t('默认')],
              ['imported', t('最近加入')],
              ['progress', t('进度')],
              ['title', t('书名')],
              ['category', t('分类')],
            ].map(([value, label]) => (
              <button
                aria-pressed={sort === value}
                key={value}
                onClick={() => change('sort', value)}
                className={sort === value ? 'is-active' : ''}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="hidden size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-white sm:flex"
            aria-label={list ? t('切换为网格') : t('切换为列表')}
            onClick={() => setList(!list)}
          >
            {list ? <Grid2X2 size={18} /> : <List size={19} />}
          </button>
        </div>
        <div className="shelf-filters">
          {[
            ['all', t('全部')],
            ['reading', t('在读')],
            ['finished', t('读完')],
            ['unread', t('未读')],
            ['hidden', t('已收起')],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => change('filter', value)}
              aria-pressed={filter === value}
              className={cn('shelf-filter', filter === value && 'active')}
            >
              {label}
            </button>
          ))}
          {group && (
            <button onClick={() => change('group', '')} className="shelf-filter active">
              {group} ×
            </button>
          )}
          <Link
            href="/collections"
            className="ms-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          >
            {t('分组')}
            <FolderPlus size={14} />
          </Link>
        </div>
        {visible.length ? (
          <div className={cn('shelf-grid', list && 'shelf-list')}>
            {visible.map((book) => (
              <article key={book.id} className="shelf-book">
                <button
                  className="shelf-book-main"
                  onClick={() => (selecting ? toggle(book.id) : void readBook(book))}
                  aria-label={
                    selecting
                      ? t('选择《{value0}》', { value0: book.title })
                      : t('阅读《{value0}》', { value0: book.title })
                  }
                  aria-pressed={selecting ? selected.includes(book.id) : undefined}
                >
                  <div className="relative">
                    <BookCover book={book} />
                    {selecting && (
                      <span
                        className={cn('book-selection', selected.includes(book.id) && 'selected')}
                      >
                        {selected.includes(book.id) ? <Check size={18} /> : <Circle size={24} />}
                      </span>
                    )}
                    {state.books[book.id]?.status === 'finished' && (
                      <span className="book-finished">{t('读完')}</span>
                    )}
                    {state.books[book.id]?.pinned && (
                      <span className="book-pinned">
                        <Pin size={12} />
                      </span>
                    )}
                  </div>
                  <span className="shelf-book-info">
                    <strong>{book.title}</strong>
                    {list && <span>{book.author}</span>}
                    <span className="shelf-book-status">
                      {state.books[book.id]?.status === 'finished'
                        ? t('已读完')
                        : positions[book.id]
                          ? book.chapters[positions[book.id]!.chapter]?.title
                          : t('还没开始阅读')}
                    </span>
                  </span>
                </button>
                {!selecting && (
                  <button
                    className="shelf-book-menu"
                    aria-label={t('管理《{value0}》', { value0: book.title })}
                    onClick={() => setMenu(book)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={filter === 'all' ? t('书架等你放上第一本书') : t('这里还没有书')}
            description={
              filter === 'hidden'
                ? t('从书架收起的书仍保留笔记和阅读位置。')
                : t('导入喜欢的书，或去书城发现一篇原创短文。')
            }
          >
            <button className="library-primary" onClick={openImport}>
              {t('导入书籍')}
            </button>
            <Link href="/discover" className="ms-5 text-sm text-primary">
              {t('去书城看看')}
            </Link>
          </Empty>
        )}
        {!selecting && visible.length > 0 && (
          <p className="shelf-end">
            {t('— {value0} 本书，都是与你的相遇 —', { value0: visible.length }).replace(
              /^— 1 books,/,
              '— 1 book,',
            )}
          </p>
        )}
      </main>
      {selecting && (
        <div className="shelf-batch-bar">
          <span className="hidden text-sm text-muted-foreground sm:block">
            {t('已选 {count} 本', { count: selected.length })}
          </span>
          {[
            { text: t('置顶'), Icon: Pin, action: () => batch({ pinned: true }) },
            {
              text: t('标记读完'),
              Icon: CheckCircle2,
              action: () => batch({ status: 'finished' }),
            },
            { text: t('分组到'), Icon: FolderPlus, action: () => setGrouping(true) },
            {
              text: filter === 'hidden' ? t('放回书架') : t('收起'),
              Icon: filter === 'hidden' ? RotateCcw : Archive,
              action: () => batch({ hidden: filter !== 'hidden' }),
            },
          ].map(({ text, Icon, action }) => (
            <button key={text} disabled={!selected.length} onClick={action}>
              <Icon size={23} />
              <span>{text}</span>
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(menu)}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="rounded-2xl p-6 max-sm:top-auto max-sm:left-0 max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pb-[max(28px,env(safe-area-inset-bottom))]"
        >
          <div
            className="mx-auto mb-5 h-1 w-9 rounded-full bg-muted sm:hidden"
            aria-hidden="true"
          />
          <DialogTitle className="pe-6 text-lg">{menu?.title}</DialogTitle>
          {menu && (
            <div className="mt-5 grid grid-cols-3 gap-3 text-center text-sm">
              <Link href={`/books/${menu.id}`} className="book-action">
                <BookOpen size={22} strokeWidth={1.5} />
                {t('书籍详情')}
              </Link>
              <button
                className="book-action"
                onClick={() => {
                  updateBooks([menu.id], { pinned: !state.books[menu.id]?.pinned });
                  setMenu(null);
                }}
              >
                <Pin size={22} strokeWidth={1.5} />
                {state.books[menu.id]?.pinned ? t('取消置顶') : t('置顶')}
              </button>
              <button
                className="book-action"
                onClick={() => {
                  updateBooks([menu.id], {
                    status: state.books[menu.id]?.status === 'finished' ? 'reading' : 'finished',
                  });
                  setMenu(null);
                }}
              >
                <CheckCircle2 size={22} strokeWidth={1.5} />
                {state.books[menu.id]?.status === 'finished' ? t('标记在读') : t('标记读完')}
              </button>
              <Link href={`/notes/${menu.id}`} className="book-action">
                <NotebookPen size={22} strokeWidth={1.5} />
                {t('查看笔记')}
              </Link>
              <button
                className="book-action"
                onClick={() => {
                  setSelected([menu.id]);
                  setMenu(null);
                  setGrouping(true);
                }}
              >
                <FolderPlus size={22} strokeWidth={1.5} />
                {t('分组到')}
              </button>
              <button
                className="book-action"
                onClick={() => {
                  updateBooks([menu.id], { hidden: !state.books[menu.id]?.hidden });
                  setMenu(null);
                }}
              >
                <Archive size={22} strokeWidth={1.5} />
                {state.books[menu.id]?.hidden ? t('放回书架') : t('收起书籍')}
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {grouping && (
        <Modal title={t('分组到')} close={() => setGrouping(false)}>
          <div className="mt-5 space-y-1">
            <button
              className="settings-row"
              onClick={() => {
                batch({ group: '' });
                setGrouping(false);
              }}
            >
              {t('不分组')}
            </button>
            {state.groups.map((name) => (
              <button
                key={name}
                className="settings-row"
                onClick={() => {
                  batch({ group: name });
                  setGrouping(false);
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <form
            className="mt-5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!groupName.trim()) return;
              createGroup(groupName);
              batch({ group: groupName.trim().slice(0, 40) });
              setGrouping(false);
              setGroupName('');
            }}
          >
            <Input
              aria-label={t('新分组名称')}
              placeholder={t('新建分组')}
              maxLength={40}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <Button type="submit" disabled={!groupName.trim()}>
              {t('创建')}
            </Button>
          </form>
        </Modal>
      )}
    </LibraryShell>
  );
}
