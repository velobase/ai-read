'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { displayLanguage, readingLanguages } from '@/lib/i18n/config';
import { useMemo, useState } from 'react';
import { bookContents, isPdfBook } from '../../../packages/reading-core/src';
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
  Smartphone,
} from 'lucide-react';
import { setBookSourceLanguage } from '@/lib/storage';
import { catalog, bookDescription } from '@/lib/catalog';
import { Modal } from '@/components/reader/reader-dialogs';
import { cn } from '@/lib/utils';
import { useLibrary } from './library-provider';
import { BookCover, Empty, LibraryShell } from './library-ui';

export function BookDetailPage({ id }: { id: string }) {
  const { t, text: localize, locale } = useI18n();
  const {
    allBooks,
    books,
    notes,
    bookmarks,
    state,
    positions,
    readBook,
    addBook,
    updateBooks,
    notify,
    refresh,
  } = useLibrary();
  const book = allBooks.find((b) => b.id === id) || catalog.find((b) => b.id === id);
  const [tab, setTab] = useState('intro');
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [contentsPage, setContentsPage] = useState({ bookId: id, limit: 60, pdfPages: false });
  const contentsLimit = contentsPage.bookId === id ? contentsPage.limit : 60;
  const pdfPages = contentsPage.bookId === id && contentsPage.pdfPages;
  const pdfBook = !!book && isPdfBook(book);
  const chapterContents = useMemo(() => (book ? bookContents(book) : []), [book]);
  const pageContents = useMemo(() => (book ? bookContents(book, { pdfPages: true }) : []), [book]);
  const hasPdfContents =
    pdfBook &&
    (chapterContents.length !== pageContents.length ||
      chapterContents.some(
        (entry, index) =>
          entry.title !== pageContents[index]?.title ||
          entry.paragraphId !== pageContents[index]?.paragraphId,
      ));
  const contents = hasPdfContents && pdfPages ? pageContents : chapterContents;
  const paragraphLocations = useMemo(() => {
    let order = 0;
    return new Map(
      (book?.chapters || []).flatMap((chapter) =>
        chapter.paragraphs.map(
          (paragraph) =>
            [
              paragraph.id,
              { chapterId: chapter.id, order: order++, sourcePage: chapter.sourcePage },
            ] as const,
        ),
      ),
    );
  }, [book]);
  const owned = books.some((b) => b.id === id);
  const bookNotes = notes.filter((n) => n.bookId === id);
  const referenceStats = book?.references
    ? {
        notes: book.references.links.filter((link) => link.kind === 'footnote').length,
        links: book.references.links.filter((link) => link.kind === 'internal').length,
        skipped:
          book.references.diagnostics.skippedMissing +
          book.references.diagnostics.skippedUnanchored +
          book.references.diagnostics.skippedLimit,
      }
    : null;
  const position = positions[id];
  const activeContentsIndex = useMemo(() => {
    const chapter = position && book?.chapters[position.chapter];
    if (!chapter) return -1;
    const current =
      paragraphLocations.get(position.paragraph) ||
      paragraphLocations.get(chapter.paragraphs[0]?.id);
    if (!current) return -1;
    let active = -1,
      lastOffset = -1,
      depth = -1;
    contents.forEach((entry, index) => {
      if (!(hasPdfContents && !pdfPages) && entry.chapterId !== chapter.id) return;
      const offset = paragraphLocations.get(entry.paragraphId)?.order;
      if (offset === undefined || offset > current.order) return;
      if (offset > lastOffset || (offset === lastOffset && entry.depth >= depth)) {
        active = index;
        lastOffset = offset;
        depth = entry.depth;
      }
    });
    return active;
  }, [book, contents, position, paragraphLocations, hasPdfContents, pdfPages]);
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
    : book?.author.replace(/^(ByPage · 逐页|逐页|逐頁|叶读|葉讀|LeafRead)/, t('ByPage · 逐页')) ||
      '';
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
              <strong>
                {(pdfBook ? chapterContents.length : book.chapters.length).toLocaleString(locale)}
              </strong>
              <span>{t(pdfBook && !hasPdfContents ? '原页目录' : '章节')}</span>
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
          {book.media && (
            <p className="mb-4 px-1 text-xs leading-6 text-muted-foreground">
              {t('已保留 {count} 处插图；{skipped} 处图片暂未转换。', {
                count: book.media.placements.length,
                skipped: Object.values(book.media.diagnostics).reduce(
                  (sum, count) => sum + count,
                  0,
                ),
              })}
            </p>
          )}
          {referenceStats && (
            <p className="mb-4 px-1 text-xs leading-6 text-muted-foreground">
              {t('{notes} 条注释 · {links} 条书内链接', referenceStats)}
              {referenceStats.skipped > 0 && (
                <> · {t('{count} 条引用暂未转换。', { count: referenceStats.skipped })}</>
              )}
            </p>
          )}
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
                  <dt>
                    <label htmlFor="book-source-language">{t('原文语言')}</label>
                  </dt>
                  <dd>
                    <select
                      id="book-source-language"
                      className="max-w-full rounded-lg border border-border bg-background p-2 text-sm"
                      value={book.sourceLanguage || 'auto'}
                      disabled={savingLanguage}
                      onChange={async (event) => {
                        const language = event.target.value;
                        setSavingLanguage(true);
                        try {
                          if (!owned) await addBook(book);
                          await setBookSourceLanguage(book.id, language);
                          await refresh();
                          notify(t('原文语言已更新，现有译文和笔记已保留。'));
                        } catch (error) {
                          notify(error instanceof Error ? error.message : t('原文语言保存失败。'));
                        } finally {
                          setSavingLanguage(false);
                        }
                      }}
                    >
                      <option value="auto">
                        {t('按文件默认：{language}', {
                          language: displayLanguage(book.language, locale) || t('自动识别'),
                        })}
                      </option>
                      {readingLanguages.map(([code, name]) => (
                        <option key={code} value={code}>
                          {displayLanguage(code, locale) || name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {t('识别有误时可手动修改；原文与译文语言相同时直接阅读原文。')}
                    </p>
                  </dd>
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
                  {pdfBook && !hasPdfContents
                    ? `${t('原页目录')} · ${t('{count} 个原页', { count: pageContents.length })}`
                    : t('查看目录 · {count} 章', {
                        count: pdfBook ? chapterContents.length : book.chapters.length,
                      })}
                  <ChevronRight size={17} />
                </button>
              </>
            )}
            {tab === 'contents' && (
              <div>
                {hasPdfContents && (
                  <div className="mb-4 flex gap-2" role="group" aria-label={t('目录')}>
                    {[false, true].map((pages) => (
                      <button
                        type="button"
                        key={String(pages)}
                        aria-pressed={pdfPages === pages}
                        className={cn(
                          'rounded-full px-4 py-2 text-sm',
                          pdfPages === pages ? 'bg-muted text-primary' : 'hover:bg-muted',
                        )}
                        onClick={() => setContentsPage({ bookId: id, limit: 60, pdfPages: pages })}
                      >
                        {t(pages ? '原页目录' : '章节')}
                      </button>
                    ))}
                  </div>
                )}
                {contents.slice(0, contentsLimit).map((entry, index) => (
                  <button
                    className="detail-chapter"
                    key={`${entry.chapterId}:${entry.paragraphId}:${index}`}
                    style={{ paddingInlineStart: 2 + Math.min(entry.depth, 5) * 16 }}
                    aria-current={index === activeContentsIndex ? 'location' : undefined}
                    onClick={() => void readBook(book, entry.paragraphId)}
                  >
                    <span className="me-5 text-xs tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className={cn('flex-1', entry.depth === 0 && 'font-medium')}>
                      {entry.title}
                      {hasPdfContents &&
                        !pdfPages &&
                        paragraphLocations.get(entry.paragraphId)?.sourcePage !== undefined && (
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {t('PDF 第 {n} 页', {
                              n: paragraphLocations.get(entry.paragraphId)!.sourcePage!,
                            })}
                          </span>
                        )}
                    </span>
                    {index === activeContentsIndex && (
                      <span className="ms-3 text-xs text-primary">{t('正在读')}</span>
                    )}
                    <ChevronRight size={15} className="ms-3 text-muted-foreground" />
                  </button>
                ))}
                {contents.length > contentsLimit && (
                  <button
                    type="button"
                    className="search-more"
                    onClick={() =>
                      setContentsPage({ bookId: id, limit: contentsLimit + 60, pdfPages })
                    }
                  >
                    {localize('显示更多结果')}
                  </button>
                )}
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
                <button
                  className="book-action"
                  disabled={exporting}
                  onClick={() => {
                    setExporting(true);
                    void import('@/lib/portable-library')
                      .then(async ({ createPortableLibrary, downloadPortableLibrary }) => {
                        downloadPortableLibrary(
                          await createPortableLibrary(
                            {
                              format: 'ai-read-books-and-notes',
                              version: 1,
                              exportedAt: Date.now(),
                              books: [book],
                              notes: bookNotes,
                              bookmarks: bookmarks.filter((item) => item.bookId === id),
                              positions: position ? { [id]: position } : {},
                            },
                            { includeEmptyCollections: false },
                          ),
                        );
                        notify(t('阅读包已导出，可在 iOS App 中导入。'));
                      })
                      .catch((error) =>
                        notify(
                          error instanceof Error
                            ? localize(error.message)
                            : t('导出失败，请重试。'),
                        ),
                      )
                      .finally(() => setExporting(false));
                  }}
                >
                  <Smartphone size={22} />
                  {t(exporting ? '正在导出阅读包…' : '导出 iOS 阅读包')}
                </button>
              </div>
            </Modal>
          )}
        </main>
      )}
    </LibraryShell>
  );
}
