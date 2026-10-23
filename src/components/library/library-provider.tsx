'use client';

import dynamic from 'next/dynamic';
const PdfImportDialog = dynamic(
  () => import('@/components/pdf/pdf-import-dialog').then((m) => m.PdfImportDialog),
  { ssr: false },
);

import { useI18n } from '@/lib/i18n/provider';
import { localeStorageKey } from '@/lib/i18n/config';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { catalog } from '@/lib/catalog';
import { storage } from '@/lib/storage';
import { measureClient } from '@/lib/observability/client';
import {
  addLibraryGroup,
  defaultProfile,
  loadLibraryState,
  loadProfile,
  updateLibraryBooks,
  type BookState,
  type LibraryState,
  type ReaderProfile,
} from '@/lib/library-state';
import type { Book, Bookmark, Note, Position } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { LoaderCircle, X } from 'lucide-react';
import { useIdentity } from '@/components/auth/identity-provider';
import { storageKey } from '@/lib/storage-scope';
import type { TranslationSearchTarget } from '@/lib/translation-search';

type LibraryContextValue = {
  books: Book[];
  allBooks: Book[];
  notes: Note[];
  bookmarks: Bookmark[];
  positions: Record<string, Position | undefined>;
  state: LibraryState;
  profile: ReaderProfile;
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openImport: () => void;
  addBook: (book: Book) => Promise<void>;
  readBook: (
    book: Book,
    paragraph?: string,
    noteId?: string,
    textOffset?: number,
    translationTarget?: TranslationSearchTarget,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  updateBooks: (ids: string[], patch: BookState) => void;
  createGroup: (name: string) => void;
};
const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { t, text: localize } = useI18n();
  const { user } = useIdentity();
  const router = useRouter();
  const pathname = usePathname();
  const [allBooks, setBooks] = useState<Book[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [positions, setPositions] = useState<Record<string, Position | undefined>>({});
  const [state, setState] = useState<LibraryState>({ books: {}, groups: [] });
  const [profile, setProfile] = useState(defaultProfile);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    const measured = measureClient('library_load');
    try {
      const data = await storage.librarySnapshot();
      const books = [
        data.books.find((book) => book.id === catalog[0].id) || catalog[0],
        ...data.books.filter((book) => book.id !== catalog[0].id),
      ];
      if (token !== generation.current) return;
      const bookIds = new Set(books.map((book) => book.id));
      setBooks(books);
      setBookmarks(data.bookmarks.filter((bookmark) => bookIds.has(bookmark.bookId)));
      setNotes(data.notes.filter((note) => bookIds.has(note.bookId)));
      setPositions(data.positions);
      setState(loadLibraryState());
      setProfile(loadProfile());
      setError('');
      measured('ok', { count: books.length });
    } catch (error) {
      measured('error', { errorKind: 'storage' });
      if (token === generation.current)
        setError(error instanceof Error ? error.message : t('无法加载书架。'));
    } finally {
      if (token === generation.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  useEffect(() => {
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      // Focus, visibility and cross-tab sync often fire together.
      if (scheduled) clearTimeout(scheduled);
      scheduled = setTimeout(() => {
        scheduled = undefined;
        void refresh();
      }, 80);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') update();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== localeStorageKey) update();
    };
    window.addEventListener('storage', storageChanged);
    window.addEventListener('ai-read-library-change', update);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', visible);
    return () => {
      if (scheduled) clearTimeout(scheduled);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('ai-read-library-change', update);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', visible);
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  const updateBooks = (ids: string[], patch: BookState) => {
    try {
      setState(updateLibraryBooks(ids, patch));
    } catch {
      setNotice(t('书架设置保存失败，请检查浏览器存储空间。'));
    }
  };
  const addBook = async (book: Book, originalPdf?: File) => {
    const existing = allBooks.find((b) => b.id === book.id);
    if (
      originalPdf ||
      !existing ||
      (book.toc?.length && !existing.toc?.length) ||
      (book.cover && !existing.cover) ||
      (book.media && book.media.revision !== existing.media?.revision) ||
      (book.references && book.references.revision !== existing.references?.revision) ||
      (book.sourceFormat && !existing.sourceFormat)
    )
      await storage.saveBook({ ...book, importedAt: Date.now() }, originalPdf);
    setState(updateLibraryBooks([book.id], { hidden: false }));
    await refresh();
  };
  const readBook = async (
    book: Book,
    paragraph?: string,
    noteId?: string,
    textOffset?: number,
    translationTarget?: TranslationSearchTarget,
    isCurrent?: () => boolean,
  ) => {
    const measured = measureClient('book_open');
    const origin = window.location.pathname + window.location.search;
    try {
      sessionStorage.setItem(storageKey(`ai-read-return:${origin}`), String(window.scrollY));
    } catch {
      /* optional navigation state */
    }
    try {
      await addBook(book);
      // Search can change or close while the local book refresh is pending.
      // A completed refresh must not pull the user back to an obsolete result.
      if (isCurrent && !isCurrent()) {
        measured('cancelled');
        return;
      }
      const current = loadLibraryState().books[book.id];
      updateBooks([book.id], {
        lastOpenedAt: Date.now(),
        status: current?.status === 'finished' ? 'finished' : 'reading',
      });
      const params = new URLSearchParams({
        from: origin,
      });
      if (paragraph) params.set('at', paragraph);
      if (noteId) params.set('note', noteId);
      const target = paragraph
        ? book.chapters.flatMap((chapter) => chapter.paragraphs).find((p) => p.id === paragraph)
        : undefined;
      if (translationTarget && !noteId && target) {
        if (
          typeof textOffset !== 'number' ||
          !Number.isSafeInteger(textOffset) ||
          textOffset < 0 ||
          !Number.isSafeInteger(translationTarget.sourceEnd) ||
          translationTarget.sourceEnd <= textOffset ||
          translationTarget.sourceEnd > 100000 ||
          !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(translationTarget.language) ||
          !/^[\w.:-]{1,200}$/.test(translationTarget.translationKey) ||
          !translationTarget.translationKey.startsWith(
            `${translationTarget.language}:${target.id}:`,
          ) ||
          !/^[a-f0-9]{64}$/.test(translationTarget.textHash)
        )
          throw new Error(t('打开失败，请重试。'));
        params.set('source', 'translation');
        params.set('lang', translationTarget.language);
        params.set('translation', translationTarget.translationKey);
        params.set('textHash', translationTarget.textHash);
        params.set('offset', String(textOffset));
        params.set('end', String(translationTarget.sourceEnd));
      } else if (
        !noteId &&
        target &&
        typeof textOffset === 'number' &&
        Number.isSafeInteger(textOffset) &&
        textOffset >= 0 &&
        textOffset < target.text.length
      )
        params.set('offset', String(textOffset));
      router.push(`/read/${encodeURIComponent(book.id)}?${params}`);
      measured();
    } catch (error) {
      measured('error', { errorKind: 'storage' });
      setNotice(error instanceof Error ? error.message : t('打开失败，请重试。'));
    }
  };
  const importFile = async (file?: File) => {
    if (!file || importing) return;
    if (/\.pdf$/i.test(file.name)) {
      setPdfFile(file);
      if (input.current) input.current.value = '';
      return;
    }
    setImporting(true);
    setNotice('');
    const measured = measureClient('book_import', {
      format: file.name.toLowerCase().endsWith('.epub') ? 'epub' : 'txt',
    });
    try {
      const { importBook } = await import('@/lib/import');
      const book = await importBook(file, {
        unknownAuthor: t('未知作者'),
        section: (number) => t('第 {number} 节', { number }),
        chapter: (number) => t('第 {number} 章', { number }),
      });
      const existing = allBooks.find((b) => b.id === book.id);
      await addBook(book);
      setNotice(existing ? t('这本书已在书架，原有笔记和进度已保留。') : t('已导入书架。'));
      router.push(`/books/${book.id}`);
      measured('ok', { count: book.chapters.length });
    } catch (error) {
      measured('error');
      setNotice(error instanceof Error ? error.message : t('导入失败。'));
    } finally {
      setImporting(false);
      if (input.current) input.current.value = '';
    }
  };
  const value: LibraryContextValue = {
    allBooks,
    books: allBooks.filter((b) => !state.books[b.id]?.hidden),
    notes,
    bookmarks,
    positions,
    state,
    profile: user ? { name: user.name, bio: user.bio, color: user.color } : profile,
    ready,
    error,
    refresh,
    notify: setNotice,
    openImport: () => {
      if (!importing && !pdfFile) input.current?.click();
    },
    addBook,
    readBook,
    updateBooks,
    createGroup: (name) => {
      try {
        setState(addLibraryGroup(name));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : t('创建失败。'));
      }
    },
  };
  return (
    <LibraryContext.Provider value={value}>
      {children}
      <input
        ref={input}
        type="file"
        accept=".epub,.txt,.pdf"
        className="hidden"
        aria-label={t('导入 EPUB、TXT 或 PDF')}
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {pdfFile && (
        <PdfImportDialog
          file={pdfFile}
          close={() => setPdfFile(null)}
          save={async (book) => {
            const finish = measureClient('book_import', { format: 'pdf' });
            try {
              await addBook(book, pdfFile);
              setPdfFile(null);
              setNotice(t('已导入书架。'));
              router.push(`/books/${encodeURIComponent(book.id)}`);
              finish('ok', { count: book.chapters.length });
            } catch (error) {
              finish('error', { errorKind: 'storage' });
              throw error;
            }
          }}
        />
      )}
      {(notice || importing) && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[100] flex w-max max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-2xl bg-[#30343a] px-5 py-3 text-sm leading-6 text-white shadow-lg"
        >
          {importing && <LoaderCircle size={16} className="animate-spin" />}
          <span>{importing ? t('正在整理书籍…') : localize(notice)}</span>
          {!importing && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('关闭提示')}
              onClick={() => setNotice('')}
            >
              <X size={16} />
            </Button>
          )}
        </div>
      )}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('LibraryProvider is required.');
  return value;
}
