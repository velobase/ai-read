'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { FolderPlus, ChevronRight, Plus } from 'lucide-react';
import { catalog, categories, bookDescription } from '@/lib/catalog';
import { Storefront } from './storefront';
import type { Book } from '@/lib/types';
import { useLibrary } from './library-provider';
import { BookCard, BookCover, Empty, LibraryShell, PageHeading, SearchBar } from './library-ui';
import { Modal } from '@/components/reader/reader-dialogs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function CategoriesPage() {
  const { t } = useI18n();
  const params = useSearchParams();
  return (
    <LibraryShell>
      <main className="library-container">
        <PageHeading title={t('分类')} back="/" />
        <Storefront initialCategory={params.get('category') || ''} />
      </main>
    </LibraryShell>
  );
}

export function CollectionsPage() {
  const { t, text: localize, locale } = useI18n();
  const { state, books, createGroup } = useLibrary();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  return (
    <LibraryShell>
      <main className="library-container">
        <PageHeading title={t('书单与分组')} back="/me">
          <button
            onClick={() => setAdding(true)}
            className="flex size-11 items-center justify-center text-primary"
            aria-label={t('新建分组')}
          >
            <Plus size={22} />
          </button>
        </PageHeading>
        <p className="mb-7 text-sm text-muted-foreground">{t('把想一起读的书，放在一起。')}</p>
        <div className="collection-grid">
          {state.groups.map((group) => {
            const items = books.filter((b) => state.books[b.id]?.group === group);
            return (
              <Link
                key={group}
                href={`/library?group=${encodeURIComponent(group)}`}
                className="collection-card"
              >
                <div className="collection-covers">
                  {items.slice(0, 3).map((book) => (
                    <BookCover key={book.id} book={book} />
                  ))}
                  {!items.length && (
                    <FolderPlus
                      size={38}
                      strokeWidth={1}
                      className="m-auto text-muted-foreground/40"
                    />
                  )}
                </div>
                <h2>{group}</h2>
                <p>
                  {items.length.toLocaleString(locale)}
                  {t('本书')}
                  <ChevronRight size={15} />
                </p>
              </Link>
            );
          })}
          <button onClick={() => setAdding(true)} className="new-collection-card">
            <FolderPlus size={29} strokeWidth={1.4} />
            <span>{t('新建分组')}</span>
          </button>
        </div>
        <Storefront collectionMode />
        {adding && (
          <Modal title={t('新建分组')} close={() => setAdding(false)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                createGroup(name);
                setAdding(false);
                setName('');
              }}
            >
              <Input
                autoFocus
                className="my-6"
                aria-label={t('分组名称')}
                placeholder={t('例如：睡前阅读')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
              />
              <Button className="w-full" type="submit" disabled={!name.trim()}>
                {t('创建分组')}
              </Button>
            </form>
          </Modal>
        )}
      </main>
    </LibraryShell>
  );
}

export function SearchPage() {
  const { t, locale, text: localize } = useI18n();
  const params = useSearchParams();
  const query = (params.get('q') || '').trim();
  const { allBooks, notes, readBook } = useLibrary();
  const all = Array.from(new Map<string, Book>([...allBooks].map((b) => [b.id, b])).values());
  const needle = query.toLocaleLowerCase();
  const found = query
    ? all.filter((b) =>
        `${b.title} ${b.subtitle || ''} ${b.author} ${b.category || ''}`
          .toLocaleLowerCase()
          .includes(needle),
      )
    : [];
  const foundNotes = query
    ? notes.filter((n) => `${n.quote} ${n.text}`.toLocaleLowerCase().includes(needle))
    : [];
  return (
    <LibraryShell>
      <main className="library-container search-page">
        <PageHeading title={t('搜索')} back="/" />
        <SearchBar key={query} defaultValue={query} />
        {!query ? (
          <>
            <h2 className="mb-5 mt-10 text-sm text-muted-foreground">{t('从这里发现')}</h2>
            <div className="flex flex-wrap gap-3">
              {categories.slice(1).map((category) => (
                <Link
                  href={`/categories?category=${encodeURIComponent(category)}`}
                  key={category}
                  className="rounded-full bg-white px-5 py-3 text-sm"
                >
                  {localize(category)}
                </Link>
              ))}
            </div>
            <Empty
              title={t('每个问题，都有一页来路')}
              description={t('搜索书名、作者，或你曾留下的笔记。')}
            />
          </>
        ) : (
          <>
            <p className="my-7 text-sm text-muted-foreground">
              {t('“{value0}” · 找到 {value1} 本书，{value2} 条笔记', {
                value0: query,
                value1: found.length,
                value2: foundNotes.length,
              })}
            </p>
            {found.length > 0 && (
              <section className="search-result-group">
                <h2>{t('书籍')}</h2>
                {found.map((book) => (
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
              </section>
            )}
            {foundNotes.length > 0 && (
              <section className="search-result-group">
                <h2>{t('笔记与划线')}</h2>
                {foundNotes.map((note) => (
                  <button
                    className="search-note-row"
                    key={note.id}
                    onClick={() => {
                      const book = allBooks.find((b) => b.id === note.bookId);
                      if (book) void readBook(book, note.paragraphId);
                    }}
                  >
                    <p className="line-clamp-3 text-sm leading-7">{note.text || note.quote}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('《{value0}》 · 回到原文', {
                        value0: allBooks.find((b) => b.id === note.bookId)?.title || t('书中笔记'),
                      })}
                    </p>
                  </button>
                ))}
              </section>
            )}
            {!found.length && !foundNotes.length && (
              <Empty
                title={t('没有找到相关内容')}
                description={t('换一个关键词，或先把这本书导入书架。')}
              />
            )}
          </>
        )}
      </main>
    </LibraryShell>
  );
}
