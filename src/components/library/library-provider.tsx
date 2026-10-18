'use client';

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
import { importBook } from '@/lib/import';
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
import type { Book, Note, Position } from '@/lib/types';
import { Modal } from '@/components/reader/reader-dialogs';
import { Button } from '@/components/ui/button';
import { FileUp, LoaderCircle, X } from 'lucide-react';
import { useIdentity } from '@/components/auth/identity-provider';
import { storageKey } from '@/lib/storage-scope';

type LibraryContextValue = {
  books: Book[];
  allBooks: Book[];
  notes: Note[];
  positions: Record<string, Position | undefined>;
  state: LibraryState;
  profile: ReaderProfile;
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openImport: () => void;
  addBook: (book: Book) => Promise<void>;
  readBook: (book: Book, paragraph?: string) => Promise<void>;
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [positions, setPositions] = useState<Record<string, Position | undefined>>({});
  const [state, setState] = useState<LibraryState>({ books: {}, groups: [] });
  const [profile, setProfile] = useState(defaultProfile);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    try {
      const saved = await storage.books();
      const books = [catalog[0], ...saved.filter((b) => b.id !== catalog[0].id)];
      const data = await Promise.all(
        books.map(async (book) => ({
          id: book.id,
          notes: await storage.notes(book.id),
          position: await storage.position(book.id),
        })),
      );
      if (token !== generation.current) return;
      setBooks(books);
      setNotes(data.flatMap((d) => d.notes));
      setPositions(Object.fromEntries(data.map((d) => [d.id, d.position])));
      setState(loadLibraryState());
      setProfile(loadProfile());
      setError('');
    } catch (error) {
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
    const update = () => {
      void refresh();
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
  const addBook = async (book: Book) => {
    if (!allBooks.some((b) => b.id === book.id))
      await storage.saveBook({ ...book, importedAt: Date.now() });
    setState(updateLibraryBooks([book.id], { hidden: false }));
    await refresh();
  };
  const readBook = async (book: Book, paragraph?: string) => {
    const origin = window.location.pathname + window.location.search;
    try {
      sessionStorage.setItem(storageKey(`ai-read-return:${origin}`), String(window.scrollY));
    } catch {
      /* optional navigation state */
    }
    try {
      await addBook(book);
      const current = loadLibraryState().books[book.id];
      updateBooks([book.id], {
        lastOpenedAt: Date.now(),
        status: current?.status === 'finished' ? 'finished' : 'reading',
      });
      const params = new URLSearchParams({
        from: origin,
      });
      if (paragraph) params.set('at', paragraph);
      router.push(`/read/${encodeURIComponent(book.id)}?${params}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('打开失败，请重试。'));
    }
  };
  const importFile = async (file?: File) => {
    if (!file || importing) return;
    setImporting(true);
    try {
      const book = await importBook(file, {
        unknownAuthor: t('未知作者'),
        section: (number) => t('第 {number} 节', { number }),
        chapter: (number) => t('第 {number} 章', { number }),
      });
      const existing = allBooks.find((b) => b.id === book.id);
      if (existing && !existing.cover && book.cover)
        await storage.saveBook({ ...existing, cover: book.cover });
      await addBook(existing || book);
      setImportOpen(false);
      setNotice(existing ? t('这本书已在书架，原有笔记和进度已保留。') : t('已导入书架。'));
      router.push(`/books/${book.id}`);
    } catch (error) {
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
    positions,
    state,
    profile: user ? { name: user.name, bio: user.bio, color: user.color } : profile,
    ready,
    error,
    refresh,
    notify: setNotice,
    openImport: () => setImportOpen(true),
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
        accept=".epub,.txt"
        className="hidden"
        aria-label={t('导入 EPUB 或 TXT')}
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {importOpen && (
        <Modal
          title={t('导入书籍')}
          close={() => {
            if (!importing) setImportOpen(false);
          }}
        >
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {t('把喜欢的书，放进自己的书架。')}
          </p>
          <button
            disabled={importing}
            onClick={() => input.current?.click()}
            className="mt-6 flex w-full items-center gap-4 rounded-2xl bg-muted p-6 text-start hover:bg-accent disabled:opacity-60"
          >
            {importing ? (
              <LoaderCircle className="animate-spin text-primary" />
            ) : (
              <FileUp className="text-primary" />
            )}
            <span>
              <strong className="block font-medium">
                {importing ? t('正在整理书籍…') : t('从文件导入')}
              </strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t('EPUB / UTF-8 TXT · 最大 30 MB')}
              </span>
            </span>
          </button>
          <p className="mt-5 text-xs leading-6 text-muted-foreground">
            {t('本机数据已保存。登录后可跨设备同步。')}
          </p>
        </Modal>
      )}
      {notice && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[100] flex w-max max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-2xl bg-[#30343a] px-5 py-3 text-sm leading-6 text-white shadow-lg"
        >
          <span>{localize(notice)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('关闭提示')}
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </Button>
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
