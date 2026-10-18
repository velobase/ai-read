'use client';

import { ExternalLink, FileUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { recommendationCopy, type RecommendedBook } from '@/lib/recommended-books';
import { useLibrary } from './library-provider';
import { BookCover, LibraryShell, PageHeading } from './library-ui';

export function RecommendedBookPage({ book }: { book: RecommendedBook }) {
  const { t, locale } = useI18n();
  const { openImport } = useLibrary();
  const copy = recommendationCopy(book, locale);
  return (
    <LibraryShell hideNavigation>
      <main className="book-detail-page">
        <PageHeading title={t('原版书目')} back="/discover" />
        <section className="book-detail-hero">
          <BookCover book={book} />
          <div className="book-detail-heading">
            <p className="mb-3 text-xs tracking-wide text-muted-foreground">{t(book.category)}</p>
            <h1 lang="en">{book.title}</h1>
            <p className="mt-5 text-sm text-primary">{book.author}</p>
            {book.subtitle && (
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{book.subtitle}</p>
            )}
            <p className="mt-5 text-xs text-muted-foreground">
              {t('英文原版')} · {book.publisher}
            </p>
          </div>
        </section>
        <section className="my-7 rounded-2xl border border-black/5 bg-white/70 p-5 sm:p-6">
          <h2 className="font-medium">{t('站内全文暂未开放')}</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {t('当前提供原版书目信息和官方来源。完整原文与中文译文尚未开放站内阅读。')}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={book.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="library-primary inline-flex items-center gap-2"
            >
              {t('查看官方原版')}
              <ExternalLink size={16} />
            </a>
            <button
              onClick={openImport}
              className="detail-shelf-button inline-flex items-center gap-2"
            >
              <FileUp size={16} />
              {t('导入我的原版文件')}
            </button>
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            {t('已有 EPUB 或 TXT？可导入自己的书架，个人导入内容不会公开到书城。')}
          </p>
        </section>
        <section className="detail-body">
          <h2>{t('内容简介')}</h2>
          <p>{copy.description}</p>
          <h2 className="mt-8">{t('推荐理由')}</h2>
          <p>{copy.reason}</p>
          <h2 className="mt-8">{t('原版信息')}</h2>
          <dl className="detail-info">
            <dt>{t('作者')}</dt>
            <dd>{book.author}</dd>
            <dt>{t('语言')}</dt>
            <dd>English</dd>
            <dt>{t('出版社')}</dt>
            <dd>{book.publisher}</dd>
            <dt>{t('所列版本')}</dt>
            <dd>{book.edition}</dd>
            <dt>{t('版本出版年')}</dt>
            <dd>{book.publicationYear}</dd>
            <dt>ISBN-13</dt>
            <dd>
              <bdi>{book.isbn}</bdi>
            </dd>
            <dt>{t('来源')}</dt>
            <dd>
              <a
                className="text-primary underline underline-offset-4"
                href={book.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {book.sourceLabel}
              </a>
            </dd>
          </dl>
        </section>
      </main>
    </LibraryShell>
  );
}
