'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useState } from 'react';
import { Download, Search, PencilLine, Trash2, ArrowUpRight, NotebookPen } from 'lucide-react';
import { storage } from '@/lib/storage';
import type { Note } from '@/lib/types';
import type { Book } from '@/lib/types';
import { normalizeSearch } from '../../../packages/reading-core/src/search';
import {
  createNotesExportLocator,
  MAX_NOTES_EXPORT_BYTES,
  notesExportLabels,
  notesMarkdownBook,
  notesMarkdownEntry,
  notesMarkdownHeader,
  type NotesExportLabels,
} from '../../../packages/reading-core/src/notes-export';
import { catalog } from '@/lib/catalog';
import { Modal } from '@/components/reader/reader-dialogs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLibrary } from './library-provider';
import { BookCover, Empty, LibraryShell, PageHeading } from './library-ui';

function downloadNotes(notes: Note[], title: string, books: Book[], labels: NotesExportLabels) {
  const byId = new Map(books.map((book) => [book.id, book]));
  const grouped = new Map<string, Note[]>();
  for (const note of notes) {
    if (!grouped.has(note.bookId)) grouped.set(note.bookId, []);
    grouped.get(note.bookId)!.push(note);
  }
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let bytes = 0;
  const append = (part: string) => {
    bytes += encoder.encode(part).byteLength;
    if (bytes > MAX_NOTES_EXPORT_BYTES) throw new Error('notes_export_too_large');
    parts.push(part);
  };
  append(notesMarkdownHeader(labels));
  for (const [bookId, entries] of grouped) {
    const book = byId.get(bookId);
    const locate = book ? createNotesExportLocator(book) : () => ({});
    append(notesMarkdownBook(book || { title: labels.title, author: '' }, labels));
    for (const note of entries) append(notesMarkdownEntry(note, locate(note.paragraphId), labels));
  }
  const text = parts.join('');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NotesPage({ bookId }: { bookId?: string }) {
  const { t, locale } = useI18n();
  const { allBooks, notes, readBook, refresh, notify } = useLibrary();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'books' | 'recent'>('books');
  const [editing, setEditing] = useState<Note | null>(null);
  const [removing, setRemoving] = useState<Note | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const book = allBooks.find((b) => b.id === bookId) || catalog.find((b) => b.id === bookId);
  const names = Object.fromEntries(allBooks.map((b) => [b.id, b.title]));
  const needle = normalizeSearch(query.trim());
  const filtered = notes
    .filter(
      (n) =>
        (!bookId || n.bookId === bookId) &&
        (!needle ||
          normalizeSearch(`${n.quote} ${n.text} ${names[n.bookId] || ''}`).includes(needle)),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const grouped = Array.from(new Set(filtered.map((n) => n.bookId)))
    .map((id) => ({
      book: allBooks.find((b) => b.id === id),
      notes: filtered.filter((n) => n.bookId === id),
    }))
    .filter((item) => item.book);
  const mutate = async (note: Note, remove = false) => {
    if (saving) return;
    setSaving(true);
    try {
      await storage.modifyNote(note.bookId, note.id, remove ? null : { text: text.trim() }, note);
      await refresh();
      setEditing(null);
      setRemoving(null);
      notify(remove ? t('笔记已删除。') : t('笔记已保存。'));
    } catch (e) {
      setRemoving(null);
      notify(e instanceof Error ? e.message : t('保存失败。'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <LibraryShell hideNavigation={Boolean(bookId)}>
      <main className="library-container notes-page">
        <PageHeading
          title={bookId ? book?.title || t('书中笔记') : t('笔记')}
          subtitle={
            bookId
              ? t('{count} 条笔记', { count: filtered.length })
              : t('{notes} 条笔记 · {books} 本书', {
                  notes: filtered.length,
                  books: grouped.length,
                })
          }
          back={bookId ? '/notes' : undefined}
        >
          <button
            disabled={!filtered.length}
            onClick={() => {
              const title = book ? t('{value0}-笔记', { value0: book.title }) : t('我的阅读笔记');
              try {
                downloadNotes(
                  filtered,
                  title,
                  allBooks,
                  notesExportLabels(locale === 'zh-CN' ? 'zh-CN' : 'en', {
                    title,
                    author: t('作者'),
                    chapter: t('章节'),
                    source: t('来源'),
                    unknown: t('来源未记录'),
                    original: t('原文'),
                    translation: t('译文'),
                    paragraph: t('段落'),
                    date: t('日期'),
                    thought: t('你的想法'),
                    pdfPage: t('PDF 原页'),
                  }),
                );
              } catch (error) {
                notify(
                  t(
                    error instanceof Error && error.message === 'notes_export_too_large'
                      ? '笔记超过 10 MB，请缩小书籍或搜索范围后重试。'
                      : '导出失败，请重试。',
                  ),
                );
              }
            }}
            className="flex size-11 items-center justify-center text-muted-foreground disabled:opacity-30"
            aria-label={t('导出笔记')}
          >
            <Download size={20} />
          </button>
        </PageHeading>
        <label className="notes-search">
          <Search size={18} className="text-muted-foreground" />
          <input
            aria-label={t('搜索笔记')}
            placeholder={t('搜索笔记、想法或书名')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {!bookId && (
          <div className="shelf-sort mb-6 mt-6">
            <button
              className={view === 'books' ? 'is-active' : ''}
              onClick={() => setView('books')}
            >
              {t('按书查看')}
            </button>
            <button
              className={view === 'recent' ? 'is-active' : ''}
              onClick={() => setView('recent')}
            >
              {t('最近笔记')}
            </button>
          </div>
        )}
        {!filtered.length ? (
          <Empty
            title={query ? t('没有找到相关笔记') : t('让每一次阅读留下回响')}
            description={
              query
                ? t('试试另一段文字，或清空搜索。')
                : t('在阅读中选中文字，划线、写想法；你的笔记会在这里按书整理。')
            }
          >
            {query ? (
              <button className="library-primary" onClick={() => setQuery('')}>
                {t('清空搜索')}
              </button>
            ) : book ? (
              <button className="library-primary" onClick={() => void readBook(book)}>
                {t('去阅读')}
              </button>
            ) : (
              <Link href="/library" className="library-primary">
                {t('去书架')}
              </Link>
            )}
          </Empty>
        ) : !bookId && view === 'books' ? (
          <div className="notes-book-grid">
            {grouped.map(({ book: b, notes: bn }) => (
              <Link key={b!.id} href={`/notes/${b!.id}`} className="notes-book-card">
                <div>
                  <strong>
                    {bn.length.toLocaleString(locale)}
                    <span>{t('个笔记')}</span>
                  </strong>
                  <h2>《{b!.title}》</h2>
                  <time>{new Date(bn[0].createdAt).toLocaleDateString(locale)}</time>
                </div>
                <BookCover book={b!} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="note-list">
            {filtered.map((note) => (
              <article className="note-card" key={`${note.bookId}:${note.id}`}>
                <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
                  <Link href={`/books/${note.bookId}`}>{names[note.bookId] || t('书中笔记')}</Link>
                  <time>{new Date(note.createdAt).toLocaleDateString(locale)}</time>
                </div>
                {note.id.startsWith('conflict-') && (
                  <span className="mb-3 inline-block rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    {t('冲突副本')}
                  </span>
                )}
                <p className="mb-3 text-xs text-muted-foreground">
                  {t(
                    note.anchor?.source === 'translation'
                      ? '译文'
                      : note.anchor?.source === 'original'
                        ? '原文'
                        : '来源未记录',
                  )}
                </p>
                <blockquote dir="auto">{note.quote}</blockquote>
                {note.text && (
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{note.text}</p>
                )}
                <div className="mt-5 flex items-center gap-2">
                  <button
                    className="me-auto flex min-h-10 items-center gap-1 text-xs text-primary"
                    onClick={() => {
                      const b = allBooks.find((b) => b.id === note.bookId);
                      if (b) void readBook(b, note.paragraphId, note.id);
                    }}
                  >
                    {t('回到摘录')}
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    aria-label={t('编辑笔记')}
                    className="note-icon-button"
                    onClick={() => {
                      setEditing(note);
                      setText(note.text);
                    }}
                  >
                    <PencilLine size={17} />
                  </button>
                  <button
                    aria-label={t('删除笔记')}
                    className="note-icon-button"
                    onClick={() => setRemoving(note)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {editing && (
          <Modal
            title={t('编辑想法')}
            close={() => {
              if (!saving) setEditing(null);
            }}
          >
            <blockquote
              dir="auto"
              className="my-5 max-h-40 overflow-y-auto border-s-2 ps-4 text-sm leading-7 text-muted-foreground"
            >
              {editing.quote}
            </blockquote>
            <Textarea
              aria-label={t('你的想法')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={10000}
              className="min-h-36"
            />
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
                {t('取消')}
              </Button>
              <Button disabled={saving} onClick={() => void mutate(editing)}>
                {saving ? t('保存中…') : t('保存')}
              </Button>
            </div>
          </Modal>
        )}
        {removing && (
          <Modal
            title={t('删除这条笔记？')}
            close={() => {
              if (!saving) setRemoving(null);
            }}
          >
            <p className="my-6 text-sm leading-7 text-muted-foreground">
              {t('这条划线和想法将被删除，书籍原文不受影响。删除后无法撤销。')}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" disabled={saving} onClick={() => setRemoving(null)}>
                {t('取消')}
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => void mutate(removing, true)}
              >
                {t('删除笔记')}
              </Button>
            </div>
          </Modal>
        )}
      </main>
    </LibraryShell>
  );
}
