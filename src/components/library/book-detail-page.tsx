'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { displayLanguage } from '@/lib/i18n/config';
import { useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Pin,
  Archive,
} from 'lucide-react';
import { catalog, bookDescription } from '@/lib/catalog';
import { Modal } from '@/components/reader/reader-dialogs';
import { cn } from '@/lib/utils';
import { useLibrary } from './library-provider';
import { BookCover, Empty, LibraryShell } from './library-ui';

export function BookDetailPage({ id }: { id: string }) {
  const { t, text: localize, locale } = useI18n();
  const { allBooks, books, notes, state, positions, readBook, addBook, updateBooks, notify } =
    useLibrary();
  const book = allBooks.find((b) => b.id === id) || catalog.find((b) => b.id === id);
  const [tab, setTab] = useState('intro');
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  const owned = books.some((b) => b.id === id);
  const bookNotes = notes.filter((n) => n.bookId === id);
  const position = positions[id];
  const status = state.books[id]?.status || (position ? 'reading' : 'unread');
  const isChineseUi = locale.startsWith('zh');
  const displayAuthor = book?.sample
    ? `${t('ByPage · 逐页')} · ${
        book.id === 'ai-read-original-demo-v1'
          ? isChineseUi
            ? locale === 'zh-TW'
              ? '原創示例'
              : '原创示例'
            : 'Original sample'
          : isChineseUi
            ? locale === 'zh-TW'
              ? '原創短文'
              : '原创短文'
            : 'Original essay'
      }`
    : book?.author.replace(/^(ByPage · 逐页|逐页|逐頁|叶读|葉讀|LeafRead)/, t('ByPage · 逐页')) || '';
  const displayDescription =
    book?.id === 'ai-read-original-demo-v1' && !isChineseUi
      ? 'An original English demonstration essay on attention, translation, and asking questions, accompanied by prewritten Chinese translations.'
      : book
        ? bookDescription(book)
        : '';
  const chars =
    book?.chapters.reduce(
      (sum, c) => sum + c.paragraphs.reduce((n, p) => n + p.text.length, 0),
      0,
    ) || 0;
  return (
    <LibraryShell hideNavigation>
      {!book ? (
        <Empty title={t('没有找到这本书')} description={t('这本书可能尚未导入当前浏览器。')}>
          <Link href="/library" className="library-primary">
            {t('返回书架')}
          </Link>
        </Empty>
      ) : (
        <main className="book-detail-page">
          <header className="flex h-16 items-center justify-between">
            <Link
              href="/library"
              className="flex size-11 items-center justify-center rounded-full hover:bg-black/5"
              aria-label={t('返回书架')}
            >
              <ChevronLeft size={25} />
            </Link>
            <span className="text-sm text-muted-foreground">{t('书籍详情')}</span>
            <button
              onClick={() => setMore(true)}
              aria-label={t('更多书籍操作')}
              className="flex size-11 items-center justify-center rounded-full hover:bg-black/5"
            >
              <MoreHorizontal size={23} />
            </button>
          </header>
          <section className="book-detail-hero">
            <BookCover book={book} />
            <div className="book-detail-heading">
              <p className="mb-3 text-xs tracking-wide text-muted-foreground">
                {book.category ? localize(book.category) : t('我的藏书')}
              </p>
              <h1>{book.title}</h1>
              <p className="mt-5 text-sm text-primary">{displayAuthor}</p>
              {book.subtitle && (
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{book.subtitle}</p>
              )}
              <p className="mt-5 hidden max-w-xl text-sm leading-7 text-muted-foreground sm:block">
                {displayDescription.slice(0, 150)}
              </p>
            </div>
          </section>
          <div className="detail-metrics">
            <button
              onClick={() => {
                if (!owned) {
                  void addBook(book)
                    .then(() => updateBooks([id], { status: 'reading' }))
                    .catch((e) => notify(e.message));
                } else
                  updateBooks([id], { status: status === 'finished' ? 'reading' : 'finished' });
              }}
            >
              <strong>
                {status === 'finished' ? t('已读完') : status === 'reading' ? t('在读') : t('未读')}
              </strong>
              <span>
                {t('我的阅读')}
                <ChevronRight size={12} />
              </span>
            </button>
            <Link href={`/notes/${id}`}>
              <strong>{bookNotes.length.toLocaleString(locale)}</strong>
              <span>{t('笔记与划线')}</span>
            </Link>
            <div>
              <strong>
                {new Intl.NumberFormat(locale, {
                  notation: 'compact',
                  maximumFractionDigits: 1,
                }).format(chars)}
              </strong>
              <span>{t('字数')}</span>
            </div>
            <div>
              <strong>{book.chapters.length.toLocaleString(locale)}</strong>
              <span>{t('章节')}</span>
            </div>
          </div>
          <div className="detail-local-note">
            <BookOpen size={18} className="text-primary" />
            <span>
              {book.sample ? t('ByPage · 逐页 原创 · 可完整阅读') : t('本地书籍 · 继续你的阅读')}
            </span>
            {position && (
              <span className="ms-auto hidden truncate text-xs text-muted-foreground sm:block">
                {t('读到：{value0}', { value0: book.chapters[position.chapter]?.title })}
              </span>
            )}
          </div>
          <div className="book-detail-actions">
            <Link href={`/notes/${id}`} className="detail-note-link">
              <NotebookPen size={21} />
              <span>{t('笔记')}</span>
            </Link>
            <button
              className="detail-shelf-button"
              onClick={() => {
                if (owned) {
                  notify(t('已在你的书架中。'));
                  return;
                }
                void addBook(book)
                  .then(() => notify(t('已加入书架。')))
                  .catch((e) => notify(e.message));
              }}
            >
              {owned ? <Check size={18} /> : <Plus size={18} />}
              {owned ? t('已在书架') : t('加入书架')}
            </button>
            <button className="library-primary flex-1" onClick={() => void readBook(book)}>
              {position ? t('继续阅读') : t('阅读')}
            </button>
          </div>
          <div className="detail-tabs" role="tablist" aria-label={t('书籍内容')}>
            {[
              ['intro', t('简介')],
              ['contents', t('目录')],
              ['notes', t('笔记 {value0}', { value0: bookNotes.length || '' })],
            ].map(([value, label]) => (
              <button
                role="tab"
                aria-selected={tab === value}
                key={value}
                onClick={() => setTab(value)}
                className={cn(tab === value && 'active')}
              >
                {label}
              </button>
            ))}
          </div>
          <section className="detail-body" role="tabpanel">
            {tab === 'intro' && (
              <>
                <h2>{t('内容简介')}</h2>
                <p className={cn('whitespace-pre-wrap', !expanded && 'line-clamp-5')}>
                  {displayDescription}
                </p>
                {displayDescription.length > 180 && (
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-3 text-sm text-primary"
                  >
                    {expanded ? t('收起') : t('展开全部')}
                  </button>
                )}
                <h2 className="mt-9">{t('书籍信息')}</h2>
                <dl className="detail-info">
                  <dt>{t('作者')}</dt>
                  <dd>{displayAuthor}</dd>
                  <dt>{t('语言')}</dt>
                  <dd>{displayLanguage(book.language, locale) || t('自动识别')}</dd>
                  <dt>{t('来源')}</dt>
                  <dd>{book.sample ? t('ByPage · 逐页 原创示例 · MIT 许可') : t('本地导入')}</dd>
                  {book.importedAt > 0 && (
                    <>
                      <dt>{t('加入时间')}</dt>
                      <dd>{new Date(book.importedAt).toLocaleDateString(locale)}</dd>
                    </>
                  )}
                </dl>
                <button
                  className="mt-8 flex w-full items-center justify-between rounded-xl bg-muted px-5 py-4 text-sm"
                  onClick={() => setTab('contents')}
                >
                  {t('查看目录 · {count} 章', { count: book.chapters.length })}
                  <ChevronRight size={17} />
                </button>
              </>
            )}
            {tab === 'contents' && (
              <div>
                {book.chapters.map((chapter, index) => (
                  <button
                    className="detail-chapter"
                    key={chapter.id}
                    onClick={() => void readBook(book, chapter.paragraphs[0]?.id)}
                  >
                    <span className="me-5 text-xs tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1">{chapter.title}</span>
                    {position?.chapter === index && (
                      <span className="ms-3 text-xs text-primary">{t('正在读')}</span>
                    )}
                    <ChevronRight size={15} className="ms-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
            {tab === 'notes' &&
              (bookNotes.length ? (
                <>
                  <div className="space-y-5">
                    {bookNotes.slice(0, 4).map((note) => (
                      <button
                        className="note-excerpt text-start"
                        key={note.id}
                        onClick={() => void readBook(book, note.paragraphId)}
                      >
                        <p>{note.quote}</p>
                        {note.text && <p className="mt-3 text-foreground">{note.text}</p>}
                      </button>
                    ))}
                  </div>
                  <Link className="mt-6 inline-block text-sm text-primary" href={`/notes/${id}`}>
                    {t('查看全部笔记')}
                    <span aria-hidden="true">›</span>
                  </Link>
                </>
              ) : (
                <Empty
                  title={t('想法，从阅读开始')}
                  description={t('阅读时选中文字，可以划线或记下自己的想法。')}
                >
                  <button onClick={() => void readBook(book)} className="library-primary">
                    {t('开始阅读')}
                  </button>
                </Empty>
              ))}
          </section>
          {more && (
            <Modal title={t('书籍操作')} mobileSheet close={() => setMore(false)}>
              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <button
                  className="book-action"
                  onClick={() => {
                    void addBook(book)
                      .then(() => {
                        updateBooks([id], { pinned: !state.books[id]?.pinned });
                        setMore(false);
                      })
                      .catch((e) => notify(e.message));
                  }}
                >
                  <Pin size={22} />
                  {state.books[id]?.pinned ? t('取消置顶') : t('置顶')}
                </button>
                <Link className="book-action" href={`/notes/${id}`}>
                  <NotebookPen size={22} />
                  {t('查看笔记')}
                </Link>
                <button
                  className="book-action"
                  disabled={!owned}
                  onClick={() => {
                    updateBooks([id], { hidden: true });
                    setMore(false);
                    notify(t('已从书架收起，书籍和笔记仍保留。'));
                  }}
                >
                  <Archive size={22} />
                  {t('收起书籍')}
                </button>
              </div>
            </Modal>
          )}
        </main>
      )}
    </LibraryShell>
  );
}
