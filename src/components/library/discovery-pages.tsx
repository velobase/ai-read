'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { FolderPlus, ChevronRight, Plus } from 'lucide-react';
import { catalog, categories } from '@/lib/catalog';
import { recommendedBooks, type RecommendedBook } from '@/lib/recommended-books';
import type { Book } from '@/lib/types';
import { useLibrary } from './library-provider';
import { BookCard, BookCover, LibraryShell, PageHeading } from './library-ui';
import { Modal } from '@/components/reader/reader-dialogs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function CategoriesPage() {
  const { t, text: localize } = useI18n();
  const params = useSearchParams();
  const [chosen, setChosen] = useState(params.get('category') || '全部');
  const { books } = useLibrary();
  const all = Array.from(
    new Map<string, Book | RecommendedBook>(
      [...recommendedBooks, ...catalog, ...books].map((b) => [b.id, b]),
    ).values(),
  );
  const choices = [...new Set([...categories, ...all.map((b) => b.category || '其他')])];
  const filtered = all.filter((b) => chosen === '全部' || (b.category || '其他') === chosen);
  return (
    <LibraryShell>
      <main className="library-container">
        <PageHeading title={t('分类')} back="/" />
        <div className="category-layout">
          <nav aria-label={t('书籍分类')} className="category-nav">
            {choices.map((category) => (
              <button
                key={category}
                className={chosen === category ? 'active' : ''}
                aria-pressed={chosen === category}
                onClick={() => setChosen(category)}
              >
                {localize(category)}
              </button>
            ))}
          </nav>
          <section className="category-results">
            <h2 className="mb-6 text-lg font-semibold">
              {localize(chosen)}
              <span className="ms-3 text-xs font-normal text-muted-foreground">
                {t('{count} 本', { count: filtered.length })}
              </span>
            </h2>
            <div className="category-book-grid">
              {filtered.map((book) => (
                <BookCard key={book.id} book={book} showAuthor />
              ))}
            </div>
          </section>
        </div>
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
        <h2 className="mb-5 mt-12 text-xl font-semibold">{t('主题书单')}</h2>
        <div className="collection-grid">
          {categories.slice(1).map((category) => (
            <Link
              key={category}
              href={`/categories?category=${encodeURIComponent(category)}`}
              className="collection-card"
            >
              <div className="collection-covers">
                {[...recommendedBooks, ...catalog]
                  .filter((b) => b.category === category)
                  .slice(0, 3)
                  .map((book) => (
                    <BookCover key={book.id} book={book} />
                  ))}
              </div>
              <h2>{localize(category)}</h2>
              <p>
                {t('书目精选')}
                <ChevronRight size={15} />
              </p>
            </Link>
          ))}
        </div>
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
