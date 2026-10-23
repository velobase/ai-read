'use client';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import { useI18n } from '@/lib/i18n/provider';
import {
  readAIConnection,
  saveAIConnection,
  applyAIConnection,
  type AIConnection,
} from '@/lib/ai-connection';
import { localeStorageKey, directionFor } from '@/lib/i18n/config';

import { sameData } from '@/lib/sync-types';
import { readingProgress } from '@/lib/reading-progress';
import { captureNoteSelection, noteRange } from '@/lib/note-anchors';
import { getSyncEntry } from '@/lib/sync-storage';
import { storageKey } from '@/lib/storage-scope';
import { useIdentity } from '@/components/auth/identity-provider';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { updateLibraryBooks } from '@/lib/library-state';
import { ChapterEnding, ReadingNavigation } from './reading-navigation';
import {
  readReadingAnchor,
  restoreReadingAnchor,
  useReadingNavigation,
  type ReadingAnchor,
} from './use-reading-navigation';
import { activeFrame, pageCount, setPage } from './reading-layout';
import { useReaderTranslations } from './use-reader-translations';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ReadingPanel,
  ReadingAppearance,
  ReadingLanguage,
  ReadingProgress,
} from './reading-controls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  List,
  Languages,
  History,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Moon,
  MoreHorizontal,
  PencilLine,
  Search,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Answer, Modal, SettingsModal } from './reader-dialogs';
import { buildContext, expandQuestion, streamAI } from '@/lib/ai';
import { sampleBook, sampleTranslations } from '@/lib/sample';
import { loadSettings, saveSettings, storage } from '@/lib/storage';
import { useBookTranslation } from './use-book-translation';
import { ChapterPreparation, TranslationPanel } from './translation-panel';
import {
  type Book,
  type Message,
  type Note,
  type NoteAnchor,
  type Paragraph,
  type Position,
  type Settings,
} from '@/lib/types';

const emptyPosition: Position = { chapter: 0, paragraph: '1.1', farthest: 0 };
const scopeNames = { chapter: '当前章节', read: '截至最远章节', book: '整本书（可能剧透）' };
type ReaderTool =
  | 'contents'
  | 'companion'
  | 'appearance'
  | 'language'
  | 'progress'
  | 'compose'
  | 'settings'
  | 'help'
  | 'delete'
  | 'translations'
  | 'more';
type PassageSelection = { paragraph: Paragraph; text: string; anchor?: NoteAnchor };

function markedPassage(
  text: string,
  notes: Note[],
  source: NoteAnchor['source'] = 'original',
  key?: string,
) {
  const ranges = notes
    .flatMap((note) => {
      const range = noteRange(text, note, source, key);
      return range ? [range] : [];
    })
    .sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  const content = merged.map((range) => {
    const before = text.slice(cursor, range.start);
    cursor = range.end;
    return (
      <span key={range.start}>
        {before}
        <mark className="passage-mark">{text.slice(range.start, range.end)}</mark>
      </span>
    );
  });
  return (
    <>
      {content}
      {text.slice(cursor)}
    </>
  );
}

export default function Reader({
  bookId,
  targetParagraph,
  returnTo = '/library',
}: {
  bookId?: string;
  targetParagraph?: string;
  returnTo?: string;
}) {
  const { t, text: localize, locale } = useI18n();
  const router = useRouter();
  const { enabled: authEnabled, user } = useIdentity();
  const needsLogin = authEnabled && !user;
  const openLogin = () =>
    router.push(
      `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  const returnLabel = returnTo.startsWith('/notes')
    ? t('笔记')
    : returnTo.startsWith('/books')
      ? t('书籍详情')
      : returnTo === '/'
        ? t('阅读首页')
        : t('书架');
  const [missing, setMissing] = useState(false);
  const [book, setBook] = useState<Book>(sampleBook);
  const [position, setPosition] = useState<Position>(emptyPosition);
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(loadSettings);
  const [hasServerKey, setHasServerKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [tool, setTool] = useState<ReaderTool | null>(null);
  const parentTool = useRef<ReaderTool | null>(null);
  const settingsOpen = tool === 'settings';
  const helpOpen = tool === 'help';
  const sidebarOpen = tool === 'contents';
  const companionOpen = tool === 'companion';
  const appearanceOpen = tool === 'appearance';
  const [chromeVisible, setChromeVisible] = useState(true);
  const [selectionMenu, setSelectionMenu] = useState<{ top: number; left: number } | null>(null);
  const layoutAnchor = useRef<ReadingAnchor | null>(null);
  const pointerStart = useRef<{ x: number; y: number; scroll: number; time: number } | null>(null);
  const selectionTime = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panel, setPanel] = useState<'chat' | 'notes'>('chat');
  const [selected, setSelected] = useState<PassageSelection | null>(null);
  const [draftSelection, setDraftSelection] = useState<PassageSelection | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  const [deleteNote, setDeleteNote] = useState<Note | null>(null);
  const [referenceReturn, setReferenceReturn] = useState<{
    anchor: ReadingAnchor;
    mode: Settings['navigationMode'];
    panel: 'chat' | 'notes' | null;
    selection: PassageSelection | null;
  } | null>(null);
  const jumpAnchor = useRef<ReadingAnchor | null>(null);
  const jumpEdge = useRef<'start' | 'end'>('start');
  const pendingPosition = useRef<{ bookId: string; position: Position } | null>(null);
  const [question, setQuestion] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState<'chat' | null>(null);
  const [busyText, setBusyText] = useState('');
  const [notice, setNotice] = useState('');
  const [jump, setJump] = useState<string | null>(null);
  const [jumpHighlight, setJumpHighlight] = useState<string | null>(null);
  const [scrollRange, setScrollRange] = useState({ bookId: '', start: 0, end: 1 });
  const readerRef = useRef<HTMLElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatScrollPosition = useRef<number | null>(null);
  const notesScrollPosition = useRef(0);
  const restoreChatScroll = useCallback((node: HTMLDivElement | null) => {
    if (node)
      requestAnimationFrame(() => {
        if (node.isConnected) node.scrollTop = chatScrollPosition.current ?? node.scrollHeight;
      });
  }, []);
  const restoreNotesScroll = useCallback((node: HTMLDivElement | null) => {
    if (node)
      requestAnimationFrame(() => {
        if (node.isConnected) node.scrollTop = notesScrollPosition.current;
      });
  }, []);
  const operation = useRef<AbortController | null>(null);
  const savingChat = useRef(false);
  const activation = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoring = useRef(false);
  const settingsEdited = useRef(false);
  const chapter = book.chapters[position.chapter] || book.chapters[0];
  const view = settings.readingMode;
  const readingIndex = Math.max(
    0,
    chapter.paragraphs.findIndex((p) => p.id === position.paragraph),
  );
  const readingParagraph =
    chapter.paragraphs.slice(readingIndex).find((p) => p.kind !== 'heading') ||
    chapter.paragraphs[readingIndex];
  const aiReady = !needsLogin && Boolean(settings.baseUrl && settings.model);
  const legacyTranslations = useMemo(
    () => (book.id === sampleBook.id ? { ...sampleTranslations, ...translations } : translations),
    [book.id, translations],
  );
  const bookTranslation = useBookTranslation(book, settings, {
    chapter: position.chapter,
    enabled: ready && !missing && !switching,
    auto: aiReady && view !== 'original',
    legacy: legacyTranslations,
  });
  const paragraphChapters = useMemo(
    () => new Map(book.chapters.flatMap((c, i) => c.paragraphs.map((p) => [p.id, i] as const))),
    [book],
  );
  const normalizeHeading = (text: string) => text.replace(/[\s\p{P}]/gu, '').toLowerCase();
  const allParagraphs = useMemo(() => book.chapters.flatMap((c) => c.paragraphs), [book]);
  const continuous = settings.navigationMode === 'scroll' && settings.scrollFlow === 'continuous';
  const range =
    scrollRange.bookId === book.id
      ? scrollRange
      : {
          start: Math.max(0, position.chapter - 1),
          end: Math.min(book.chapters.length - 1, position.chapter + 1),
        };
  const renderedChapters = book.chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter(({ index }) =>
      settings.navigationMode === 'scroll' && settings.scrollFlow === 'chapter'
        ? index === position.chapter
        : continuous
          ? index >= range.start && index <= range.end
          : Math.abs(index - position.chapter) <= 1,
    );
  const stableTranslations = useReaderTranslations({
    book,
    settings,
    chapterIndex: position.chapter,
    translations,
    contentRevision: bookTranslation.revision,
    version: bookTranslation.version,
    getTranslation,
    getKey: (p) => bookTranslation.key(paragraphChapters.get(p.id) ?? 0, p.id),
    preparationAnchor: position,
    root: readerRef,
  });
  const navigation = useReadingNavigation({
    root: readerRef,
    chapterId: chapter.id,
    chapterIndex: position.chapter,
    chapterCount: book.chapters.length,
    mode: settings.navigationMode,
    effect: settings.pageEffect,
    rtl: book.pageDirection === 'rtl',
    layoutKey: [
      settings.fontSize,
      settings.fontFamily,
      settings.lineHeight,
      settings.pageWidth,
      settings.pageMargin,
      settings.readingMode,
      settings.scrollFlow,
      settings.language,
      bookTranslation.version,
      stableTranslations.revision,
    ].join(':'),
    enabled: ready && !missing && !switching && !jump,
    blocked: Boolean(tool || selectionMenu),
    onChapter: toChapter,
  });
  const progress =
    position.chapter === book.chapters.length - 1 && navigation.atEnd
      ? 100
      : Math.min(99, Math.round(readingProgress(book.chapters, position) * 100));

  function openTool(next: ReaderTool | null) {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    parentTool.current = null;
    setSelectionMenu(null);
    setTool(next);
  }
  function subTool(next: ReaderTool, open: boolean) {
    if (open) {
      parentTool.current = tool;
      setSelectionMenu(null);
      setTool(next);
    } else {
      setTool(parentTool.current);
      parentTool.current = null;
    }
  }
  const setSidebarOpen = (open: boolean) => openTool(open ? 'contents' : null);
  const setAppearanceOpen = (open: boolean) => openTool(open ? 'appearance' : null);
  const setCompanionOpen = (open: boolean) => openTool(open ? 'companion' : null);
  const setSettingsOpen = (open: boolean) => subTool('settings', open);
  const setHelpOpen = (open: boolean) => subTool('help', open);

  function report(error: unknown) {
    setNotice(error instanceof Error ? error.message : String(error));
  }
  async function activate(next: Book) {
    const token = ++activation.current;
    operation.current?.abort();
    operation.current = null;
    setBusy(null);
    setBusyText('');
    setSwitching(true);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    try {
      const [savedPosition, savedNotes, savedMessages, savedTranslations] = await Promise.all([
        storage.readingPosition(next.id),
        storage.notes(next.id),
        storage.chat(next.id),
        storage.translations(next.id),
      ]);
      if (token !== activation.current) return;
      const pos = savedPosition || {
        ...emptyPosition,
        paragraph: next.chapters[0].paragraphs[0].id,
      };
      const safeChapter = Number.isInteger(pos.chapter)
        ? Math.min(next.chapters.length - 1, Math.max(0, pos.chapter))
        : 0;
      const safePosition = {
        ...pos,
        chapter: safeChapter,
        paragraph: next.chapters[safeChapter].paragraphs.some((p) => p.id === pos.paragraph)
          ? pos.paragraph
          : next.chapters[safeChapter].paragraphs[0].id,
        farthest: Number.isInteger(pos.farthest)
          ? Math.min(next.chapters.length - 1, Math.max(safeChapter, pos.farthest))
          : safeChapter,
      };
      const targetChapter = targetParagraph
        ? next.chapters.findIndex((c) => c.paragraphs.some((p) => p.id === targetParagraph))
        : -1;
      if (targetChapter >= 0 && targetParagraph) {
        safePosition.chapter = targetChapter;
        safePosition.paragraph = targetParagraph;
        safePosition.farthest = Math.max(safePosition.farthest, targetChapter);
        safePosition.offset = 0;
        safePosition.textOffset = 0;
        safePosition.textQuote = undefined;
        safePosition.textSource = 'original';
      }
      jumpAnchor.current = safePosition;
      try {
        const preferences = JSON.parse(
          localStorage.getItem(storageKey('ai-read-book-navigation')) || '{}',
        );
        const saved = preferences[next.id];
        if (saved)
          setSettings((previous) => ({
            ...previous,
            navigationMode: ['paged', 'scroll'].includes(saved.navigationMode)
              ? saved.navigationMode
              : previous.navigationMode,
            pageEffect: ['curl', 'slide', 'none'].includes(saved.pageEffect)
              ? saved.pageEffect
              : previous.pageEffect,
            scrollFlow: saved.scrollFlow === 'chapter' ? 'chapter' : 'continuous',
          }));
      } catch {
        /* Optional, device-local book preferences. */
      }
      setBook(next);
      setScrollRange({
        bookId: next.id,
        start: Math.max(0, safePosition.chapter - 1),
        end: Math.min(next.chapters.length - 1, safePosition.chapter + 1),
      });
      setPosition(safePosition);
      setNotes(savedNotes);
      setMessages(savedMessages);
      setTranslations(savedTranslations);
      setSelected(null);
      setDraftSelection(null);
      setNoteDraft('');
      setSearch('');
      setQuestion('');
      setBusy(null);
      setJump(safePosition.paragraph);
      try {
        localStorage.setItem(storageKey('ai-read-active'), next.id);
        updateLibraryBooks([next.id], { lastOpenedAt: Date.now() });
      } catch {
        /* Reading remains available if preferences cannot be stored. */
      }
    } catch (error) {
      report(error);
    } finally {
      if (token === activation.current) {
        setSwitching(false);
        setReady(true);
      }
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stored = await storage.books();
        const list = [
          sampleBook,
          ...stored
            .filter((b) => b.id !== sampleBook.id)
            .sort((a, b) => b.importedAt - a.importedAt),
        ];
        if (!alive) return;
        let active = '';
        try {
          active = localStorage.getItem(storageKey('ai-read-active')) || '';
        } catch {
          /* optional preference */
        }
        const target = list.find((b) => b.id === (bookId || active));
        if (bookId && !target) {
          setMissing(true);
          return;
        }
        await activate(target || sampleBook);
      } catch (error) {
        if (alive) {
          report(error);
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
      activation.current++;
      operation.current?.abort();
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void readAIConnection()
        .then((config) => {
          if (!alive) return;
          setHasServerKey(config.hasKey);
          if (config.accountManaged || !settingsEdited.current)
            setSettings((s) => applyAIConnection(s, config));
        })
        .catch(() => {
          if (alive) setNotice(t('AI 服务暂时不可用，仍可继续本地阅读。'));
        });
    };
    const configurationChanged = (event: Event) => {
      const config = (event as CustomEvent<AIConnection>).detail;
      if (!alive || !config) return;
      setHasServerKey(config.hasKey);
      setSettings((s) => applyAIConnection(s, config));
    };
    refresh();
    window.addEventListener('ai-read-ai-configuration-change', configurationChanged);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ai-read-ai-configuration-change', configurationChanged);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!missing || !bookId) return;
    let alive = true;
    let loading = false;
    const update = () => {
      if (loading) return;
      void storage
        .books()
        .then(async (books) => {
          const next = books.find((b) => b.id === bookId);
          if (alive && next && !loading) {
            loading = true;
            await activate(next);
            if (alive) setMissing(false);
          }
        })
        .catch(report);
    };
    window.addEventListener('ai-read-library-change', update);
    update();
    return () => {
      alive = false;
      window.removeEventListener('ai-read-library-change', update);
    };
  }, [missing, bookId]);
  useEffect(() => {
    const update = () => setSettings(loadSettings());
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey('ai-read-settings')) update();
    };
    window.addEventListener('ai-read-preferences-change', update);
    window.addEventListener('storage', storageChanged);
    return () => {
      window.removeEventListener('ai-read-preferences-change', update);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--page-width', `${settings.pageWidth}px`);
    try {
      saveSettings(settings);
    } catch {
      setNotice(t('偏好设置无法保存到浏览器。'));
    }
  }, [settings]);
  useEffect(() => {
    if (ready && !switching) void storage.savePosition(book.id, position).catch(report);
  }, [book.id, position, ready, switching]);
  useEffect(() => {
    const flush = () => {
      const pending = pendingPosition.current;
      if (pending?.bookId === book.id)
        void storage.savePosition(pending.bookId, pending.position).catch(report);
    };
    const hide = () => {
      if (document.hidden) flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hide);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [book.id]);
  useEffect(() => {
    if (!ready || switching) return;
    let alive = true;
    const refresh = () => {
      void Promise.all([
        storage.notes(book.id),
        storage.chat(book.id),
        storage.translations(book.id),
        getSyncEntry('book', book.id, book.id),
      ])
        .then(([nextNotes, nextChat, nextTranslations, meta]) => {
          if (!alive) return;
          setNotes((old) => (sameData(old, nextNotes) ? old : nextNotes));
          if (!operation.current && !savingChat.current)
            setMessages((old) => (sameData(old, nextChat) ? old : nextChat));
          setTranslations((old) =>
            sameData(old, nextTranslations) ? old : { ...old, ...nextTranslations },
          );
          if (meta?.deleted && !meta.pending) {
            operation.current?.abort();
            setMissing(true);
            setReady(false);
          }
        })
        .catch(report);
    };
    window.addEventListener('ai-read-library-change', refresh);
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== localeStorageKey) refresh();
    };
    window.addEventListener('storage', storageChanged);
    return () => {
      alive = false;
      window.removeEventListener('ai-read-library-change', refresh);
      window.removeEventListener('storage', storageChanged);
    };
  }, [book.id, ready, switching]);
  useEffect(() => {
    if (!ready || switching || busy) return;
    let alive = true;
    savingChat.current = true;
    void storage
      .saveChat(book.id, messages)
      .then(() => storage.chat(book.id))
      .then((next) => {
        if (alive && !operation.current) setMessages((old) => (sameData(old, next) ? old : next));
      })
      .catch(report)
      .finally(() => {
        if (alive) savingChat.current = false;
      });
    return () => {
      alive = false;
      savingChat.current = false;
    };
  }, [book.id, messages, busy, ready, switching]);
  useEffect(() => {
    if (!jump) return;
    restoring.current = true;
    const frame = requestAnimationFrame(() => {
      if (readerRef.current) {
        const root = readerRef.current;
        if (jumpEdge.current === 'end' && settings.navigationMode === 'paged') {
          const frame = activeFrame(root);
          if (frame) setPage(frame, pageCount(frame) - 1);
        } else if (jumpEdge.current === 'end') {
          const frame = activeFrame(root);
          if (frame)
            root.scrollTo({
              top:
                root.scrollTop +
                frame.getBoundingClientRect().bottom -
                root.getBoundingClientRect().bottom +
                64,
              behavior: 'instant',
            });
        } else restoreReadingAnchor(root, jumpAnchor.current || { paragraph: jump, offset: 0 });
        navigation.refresh();
      }
      jumpAnchor.current = null;
      jumpEdge.current = 'start';
      setJump(null);
      requestAnimationFrame(() => {
        restoring.current = false;
        saveScroll();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, chapter.id, book.id]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busyText]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.isComposing) {
        e.preventDefault();
        setSearchOpen(true);
        setSidebarOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  useEffect(() => {
    if (tool) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(readSelection, 180);
    };
    document.addEventListener('selectionchange', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', update);
    };
  }, [tool, chapter, selected?.paragraph.id, selected?.text]);

  useLayoutEffect(() => {
    const anchor = layoutAnchor.current;
    const root = readerRef.current;
    if (!anchor || !root) return;
    restoreReadingAnchor(root, anchor);
    layoutAnchor.current = null;
  }, [
    settings.fontSize,
    settings.fontFamily,
    settings.lineHeight,
    settings.pageWidth,
    settings.pageMargin,
    settings.readingMode,
    settings.navigationMode,
    settings.scrollFlow,
    settings.language,
    settings.theme,
    position.chapter,
    scrollRange.start,
    scrollRange.end,
  ]);

  useEffect(() => {
    if (!jumpHighlight) return;
    const timer = setTimeout(() => setJumpHighlight(null), 1800);
    return () => clearTimeout(timer);
  }, [jumpHighlight]);

  useEffect(() => {
    const root = readerRef.current;
    if (!root) return;
    const update = () => saveScroll();
    root.addEventListener('reader-location', update);
    return () => root.removeEventListener('reader-location', update);
  });

  function updateAppearance(patch: Partial<Settings>) {
    const root = readerRef.current;
    layoutAnchor.current = root ? readReadingAnchor(root) : null;
    setSettings((previous) => ({ ...previous, ...patch }));
    if (patch.navigationMode || patch.pageEffect || patch.scrollFlow) {
      try {
        const preferences = JSON.parse(
          localStorage.getItem(storageKey('ai-read-book-navigation')) || '{}',
        );
        const next = { ...settings, ...patch };
        preferences[book.id] = {
          navigationMode: next.navigationMode,
          pageEffect: next.pageEffect,
          scrollFlow: next.scrollFlow,
        };
        localStorage.setItem(storageKey('ai-read-book-navigation'), JSON.stringify(preferences));
      } catch {
        /* Reading still works without optional preferences. */
      }
    }
  }

  function openCompanion(nextPanel: 'chat' | 'notes') {
    setPanel(nextPanel);
    setSelectionMenu(null);
    setCompanionOpen(true);
  }

  function openNoteComposer(passage = selected) {
    if (!passage) return;
    if (
      !draftSelection ||
      !noteDraft.trim() ||
      (draftSelection.paragraph.id === passage.paragraph.id && draftSelection.text === passage.text)
    ) {
      if (draftSelection?.text !== passage.text) setNoteDraft('');
      setDraftSelection(passage);
    } else setNotice(t('先完成这条想法，刚才的选文仍然保留。'));
    openTool('compose');
  }

  function followReference(id: string, source: 'chat' | 'notes') {
    setReferenceReturn({
      anchor: (readerRef.current && readReadingAnchor(readerRef.current)) || position,
      mode: settings.navigationMode,
      panel: source,
      selection: selected,
    });
    navigate(id, false);
    openTool(null);
  }

  function returnFromReference() {
    if (!referenceReturn) return;
    navigate(referenceReturn.anchor.paragraph, false);
    jumpAnchor.current = referenceReturn.anchor;
    setSettings((current) => ({ ...current, navigationMode: referenceReturn.mode }));
    setSelected(referenceReturn.selection);
    if (referenceReturn.panel) openCompanion(referenceReturn.panel);
    else openTool(null);
    setReferenceReturn(null);
  }

  function navigate(id: string, remember = true) {
    const index = book.chapters.findIndex((c) => c.paragraphs.some((p) => p.id === id));
    if (index < 0) return;
    if (remember && readerRef.current) {
      const anchor = readReadingAnchor(readerRef.current);
      if (anchor)
        setReferenceReturn({
          anchor,
          mode: settings.navigationMode,
          panel: null,
          selection: selected,
        });
      setJumpHighlight(id);
    }
    setScrollRange({
      bookId: book.id,
      start: Math.max(0, index - 1),
      end: Math.min(book.chapters.length - 1, index + 1),
    });
    setSelected(null);
    setSelectionMenu(null);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    pendingPosition.current = null;
    restoring.current = true;
    jumpAnchor.current = null;
    window.getSelection()?.removeAllRanges();
    setPosition((p) => ({ chapter: index, paragraph: id, farthest: Math.max(p.farthest, index) }));
    setJump(id);
    setSidebarOpen(false);
  }
  function toChapter(index: number, edge: 'start' | 'end' = 'start') {
    const c = book.chapters[index];
    if (c?.paragraphs.length) {
      setSelected(null);
      jumpEdge.current = edge;
      navigate(
        edge === 'end' ? c.paragraphs[c.paragraphs.length - 1].id : c.paragraphs[0].id,
        false,
      );
    }
  }
  function saveScroll() {
    if (restoring.current || switching || !ready || readerRef.current?.dataset.turning === 'true')
      return;
    const root = readerRef.current;
    const anchor = root && readReadingAnchor(root);
    if (!anchor) return;
    if (continuous && root) {
      const nearBottom =
        root.scrollHeight - root.scrollTop - root.clientHeight < root.clientHeight &&
        range.end < book.chapters.length - 1;
      if (nearBottom) {
        // Appending below changes no existing geometry and must not interrupt inertia.
        setScrollRange({
          bookId: book.id,
          start: range.start,
          end: range.end + 1,
        });
      }
    }
    const { visualOffset: _visualOffset, chapter: anchoredChapter, ...contentAnchor } = anchor;
    const index = anchoredChapter ?? position.chapter;
    if (
      view !== 'original' &&
      !book.chapters[index]?.paragraphs.every((p) => stableTranslations.read(index, p))
    ) {
      // A preparation screen has no text location. Never overwrite a saved
      // paragraph/offset with its placeholder while a cached chapter downloads.
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      pendingPosition.current = null;
      if (index !== position.chapter)
        setPosition((p) => ({
          chapter: index,
          paragraph: book.chapters[index].paragraphs[0].id,
          farthest: Math.max(p.farthest, index),
        }));
      return;
    }
    const next = {
      ...position,
      ...contentAnchor,
      chapter: index,
      farthest: Math.max(position.farthest, index),
    };
    pendingPosition.current = { bookId: book.id, position: next };
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      if (!restoring.current) {
        if (continuous && root) {
          const bounds = root.getBoundingClientRect();
          const nearby = Array.from(
            root.querySelectorAll<HTMLElement>('.reader-chapters > [data-chapter-index]'),
          )
            .filter((frame) => {
              const rect = frame.getBoundingClientRect();
              return (
                rect.bottom > bounds.top - root.clientHeight &&
                rect.top < bounds.bottom + root.clientHeight
              );
            })
            .map((frame) => Number(frame.dataset.chapterIndex));
          if (nearby.length) {
            const preloadPrevious = root.scrollTop < root.clientHeight && range.start > 0;
            const start = Math.max(
              0,
              Math.min(index - 1, ...nearby, preloadPrevious ? range.start - 1 : index),
            );
            if (start !== range.start) layoutAnchor.current = anchor;
            setScrollRange({
              bookId: book.id,
              start,
              end: Math.min(book.chapters.length - 1, Math.max(index + 1, ...nearby)),
            });
          }
        }
        setPosition(next);
      }
    }, 180);
  }
  function readSelection() {
    if (tool) return;
    const selection = window.getSelection();
    const value = selection?.toString().trim();
    if (!value || value.length < 2 || !selection?.anchorNode || !selection.focusNode) {
      setSelectionMenu(null);
      return;
    }
    if (
      !readerRef.current?.contains(selection.anchorNode) ||
      !readerRef.current.contains(selection.focusNode)
    )
      return;
    const start = selection.getRangeAt(0).startContainer;
    const anchor = start instanceof Element ? start : start.parentElement;
    const id = anchor?.closest('[data-paragraph]')?.getAttribute('data-paragraph');
    const paragraph = allParagraphs.find((p) => p.id === id);
    if (paragraph) {
      selectionTime.current = Date.now();
      setSelected({ paragraph, ...captureNoteSelection(selection.getRangeAt(0)) });
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setSelectionMenu({
        left: Math.max(12, Math.min(window.innerWidth - 276, rect.left + rect.width / 2 - 132)),
        top: Math.max(
          12,
          rect.top > 84 ? rect.top - 76 : Math.min(window.innerHeight - 80, rect.bottom + 10),
        ),
      });
    }
  }
  function getTranslation(p: Paragraph) {
    if (book.language.toLowerCase() === settings.language.toLowerCase()) return p.text;
    return bookTranslation.text(paragraphChapters.get(p.id) ?? 0, p.id);
  }
  async function ask(prompt: string, passage = selected) {
    if (busy || !prompt.trim()) return;
    if (needsLogin) {
      openLogin();
      return;
    }
    if (!aiReady) {
      setQuestion(prompt);
      setSettingsOpen(true);
      return;
    }
    setCompanionOpen(true);
    setPanel('chat');
    const controller = new AbortController();
    operation.current = controller;
    setBusy('chat');
    setQuestion('');
    const focus = passage || { paragraph: readingParagraph, text: readingParagraph.text };
    const allowedIds = new Set(
      book.chapters.flatMap((c, i) =>
        (
          settings.scope === 'chapter'
            ? i === position.chapter
            : settings.scope === 'read'
              ? i <= Math.max(position.farthest, position.chapter)
              : true
        )
          ? c.paragraphs.map((p) => p.id)
          : [],
      ),
    );
    const history: Message[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const user = messages[i],
        assistant = messages[i + 1];
      if (
        user.role === 'user' &&
        assistant.role === 'assistant' &&
        !assistant.partial &&
        assistant.sources?.every((id) => allowedIds.has(id))
      )
        history.push(user, assistant);
    }
    const userContent = passage
      ? `${prompt}\n\n「${passage.text.slice(0, 500)}」`
      : t('{value0}\n\n（阅读位置：段落 {value1}）', {
          value0: prompt,
          value1: focus.paragraph.id,
        });
    const turnId = crypto.randomUUID();
    const createdAt = Date.now();
    const next: Message[] = [
      ...messages,
      { role: 'user', content: userContent, turnId, createdAt },
      { role: 'assistant', content: '', sources: [] },
    ];
    setMessages(next);
    let output = '';
    let sourceIds: string[] = [];
    try {
      setBusyText(t('正在阅读相关段落…'));
      let context = buildContext(
        book,
        position.chapter,
        position.farthest,
        settings.scope,
        prompt,
        focus.paragraph,
      );
      if (context.partial) {
        setBusyText(t('正在跨语言查找相关原文…'));
        let terms = '';
        try {
          terms = await expandQuestion(
            settings,
            book,
            prompt,
            focus.text,
            history.slice(-8),
            controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) throw error;
          setNotice(t('跨语言检索词生成失败，本次使用问题原文检索。'));
        }
        context = buildContext(
          book,
          position.chapter,
          position.farthest,
          settings.scope,
          `${prompt} ${terms}`,
          focus.paragraph,
        );
      }
      sourceIds = context.sources.map((s) => s.id);
      setBusyText(
        t('参考 {value0} / {value1} 段 · {value2}', {
          value0: context.sources.length,
          value1: context.total,
          value2: localize(scopeNames[settings.scope]),
        }),
      );
      output = await streamAI(
        settings,
        {
          action: 'ask',
          title: book.title,
          question: prompt,
          selection: passage?.text,
          readingPassage: `[${focus.paragraph.id}] ${focus.paragraph.text}`,
          history: history.slice(-8),
          scope: `${scopeNames[settings.scope]}; passages ${context.sources.length}/${context.total}; partial=${context.partial}`,
          sources: context.sources,
        },
        controller.signal,
        (content) => {
          if (operation.current !== controller) return;
          output = content;
          setMessages([...next.slice(0, -1), { role: 'assistant', content, sources: sourceIds }]);
        },
      );
      if (operation.current === controller)
        setMessages([
          ...next.slice(0, -1),
          { role: 'assistant', content: output, sources: sourceIds },
        ]);
    } catch (error) {
      const failure = controller.signal.aborted
        ? t('已停止生成。')
        : error instanceof Error
          ? localize(error.message)
          : t('请求失败，请重试。');
      if (operation.current === controller)
        setMessages([
          ...next.slice(0, -1),
          {
            role: 'assistant',
            content: output
              ? t('{value0}\n\n—— {value1}（以上内容可能不完整）', {
                  value0: output,
                  value1: failure,
                })
              : failure,
            sources: sourceIds,
            partial: true,
          },
        ]);
    } finally {
      if (operation.current === controller) {
        setBusy(null);
        setBusyText('');
        operation.current = null;
      }
    }
  }
  async function saveNote(kind: 'note' | 'highlight' = 'note') {
    const passage = kind === 'note' ? draftSelection : selected;
    if (!passage || savingNoteRef.current) return;
    if (
      kind === 'highlight' &&
      notes.some(
        (note) =>
          note.paragraphId === passage.paragraph.id &&
          note.quote === passage.text &&
          !note.text &&
          sameData(note.anchor, passage.anchor),
      )
    ) {
      setNotice(t('这段文字已经划线'));
      return;
    }
    savingNoteRef.current = true;
    setSavingNote(true);
    const note: Note = {
      id: crypto.randomUUID(),
      bookId: book.id,
      paragraphId: passage.paragraph.id,
      quote: passage.text,
      anchor: passage.anchor,
      text: kind === 'note' ? noteDraft.trim() : '',
      createdAt: Date.now(),
    };
    const token = activation.current;
    try {
      const saved = await storage.addNote(note);
      if (token !== activation.current) return;
      setNotes(saved);
      if (kind === 'note') {
        setNoteDraft('');
        setDraftSelection(null);
        setTool((current) => (current === 'compose' ? null : current));
      }
      setSelectionMenu(null);
      setSelected(null);
      window.getSelection()?.removeAllRanges();
      setNotice(kind === 'highlight' ? t('已划线') : t('想法已保存'));
    } catch (error) {
      report(error);
    } finally {
      savingNoteRef.current = false;
      setSavingNote(false);
    }
  }
  function exportNotes() {
    const content =
      `# ${book.title}\n\n${book.author}\n\n` +
      notes
        .map((n) =>
          t('## 段落 {value0}\n\n> {value1}\n\n{value2}\n', {
            value0: n.paragraphId,
            value1: n.quote.replace(/\n/g, '\n> '),
            value2: n.text,
          }),
        )
        .join('\n---\n\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title.replace(/[\\/:*?"<>|]/g, '_')}-notes.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const searchResults = search.trim()
    ? allParagraphs
        .filter((p) => p.text.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 60)
    : [];

  if (missing)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sidebar px-6 text-center">
        <BookOpen size={38} className="text-muted-foreground" />
        <h1 className="text-xl">{t('当前阅读空间尚未导入这本书')}</h1>
        <p className="max-w-sm text-sm leading-7 text-muted-foreground">
          {user
            ? t('如果之前以游客身份阅读，可以从“数据与备份”复制游客书库；也可以重新导入原始文件。')
            : t('请从书架导入原始文件，再继续阅读。如果书籍属于你的账号，请先登录。')}
        </p>
        <Link className="rounded-full bg-primary px-6 py-3 text-sm text-white" href="/library">
          {t('返回书架')}
        </Link>
        <Link
          className="text-sm text-primary"
          href={
            user ? '/me/data' : `/login?returnTo=${encodeURIComponent(`/read/${bookId || ''}`)}`
          }
        >
          {user ? t('导入游客书库或恢复备份') : t('登录原来的账号')}
        </Link>
      </div>
    );
  return (
    <div
      className="reading-app h-dvh overflow-hidden bg-sidebar"
      data-chrome={chromeVisible}
      data-navigation={settings.navigationMode}
      style={
        {
          '--page-width': `${settings.pageWidth}px`,
          '--reader-font-size': `${settings.fontSize}px`,
          '--reader-line-height': settings.lineHeight,
          '--reader-page-margin': `${settings.pageMargin}px`,
        } as CSSProperties
      }
    >
      <header className="reading-header reading-chrome">
        <Button
          variant="ghost"
          className="h-10 shrink-0 gap-2 rounded-full px-3 font-normal text-muted-foreground"
          onClick={() => router.push(returnTo)}
          aria-label={t('返回{value0}', { value0: returnLabel })}
        >
          <ArrowLeft size={18} />
          <span className="hidden sm:inline">{returnLabel}</span>
        </Button>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{book.title}</span>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 rounded-full text-xs text-muted-foreground"
          onClick={() => openTool('translations')}
        >
          <BookOpen size={16} />
          {locale.startsWith('zh') ? '译本' : 'Translation'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full text-muted-foreground md:hidden"
          onClick={() => openCompanion('chat')}
          aria-label={t('打开 AI 伴读')}
        >
          <Sparkles size={20} strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="shrink-0 rounded-full text-muted-foreground"
          onClick={() => openTool('more')}
          aria-label={t('更多阅读选项')}
        >
          <MoreHorizontal size={22} strokeWidth={1.6} />
        </Button>
      </header>

      <main
        id="reading-surface"
        aria-busy={!ready || switching || Boolean(jump)}
        tabIndex={0}
        aria-label={
          settings.navigationMode === 'paged'
            ? t('阅读正文，左右轻扫翻页，轻点显示或隐藏工具')
            : t('阅读正文，上下滚动，轻点显示或隐藏工具')
        }
        ref={readerRef}
        className="reading-scroll h-full overflow-y-auto outline-none"
        onScroll={() => {
          if (tapTimer.current) clearTimeout(tapTimer.current);
          setSelectionMenu(null);
          saveScroll();
        }}
        onPointerDown={(event) => {
          navigation.onPointerDown(event);
          if (tapTimer.current) clearTimeout(tapTimer.current);
          pointerStart.current = {
            x: event.clientX,
            y: event.clientY,
            scroll: readerRef.current?.scrollTop ?? 0,
            time: Date.now(),
          };
        }}
        onPointerMove={navigation.onPointerMove}
        onPointerUp={navigation.onPointerUp}
        onPointerCancel={navigation.onPointerCancel}
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Escape') {
            setChromeVisible(true);
            setSelectionMenu(null);
            window.getSelection()?.removeAllRanges();
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            setChromeVisible((visible) => !visible);
          }
        }}
        onClick={(event) => {
          if (navigation.suppressClick) return;
          if (
            (event.target as Element).closest('button,a,input,textarea') ||
            window.getSelection()?.toString().trim()
          )
            return;
          setSelectionMenu(null);
          setSelected(null);
          const start = pointerStart.current;
          if (
            window.innerWidth < 768 &&
            start &&
            Date.now() - start.time < 400 &&
            Date.now() - selectionTime.current > 400 &&
            Math.abs(start.x - event.clientX) < 8 &&
            Math.abs(start.y - event.clientY) < 8 &&
            Math.abs(start.scroll - (readerRef.current?.scrollTop ?? 0)) < 8
          ) {
            tapTimer.current = setTimeout(() => {
              if (
                !window.getSelection()?.toString().trim() &&
                Date.now() - selectionTime.current > 400
              ) {
                const bounds = readerRef.current
                  ?.querySelector('.page-viewport')
                  ?.getBoundingClientRect();
                const fraction = bounds ? (event.clientX - bounds.left) / bounds.width : 0.5;
                if (settings.navigationMode === 'paged' && (fraction < 0.2 || fraction > 0.8))
                  navigation.turn(
                    ((fraction < 0.2 ? -1 : 1) * (book.pageDirection === 'rtl' ? -1 : 1)) as -1 | 1,
                  );
                else setChromeVisible((visible) => !visible);
              }
            }, 200);
          }
        }}
      >
        <div className="reader-chapters">
          {renderedChapters.map(({ chapter: visibleChapter, index: chapterIndex }) => {
            const hasChapterHeading =
              normalizeHeading(visibleChapter.paragraphs[0]?.text ?? '') ===
              normalizeHeading(visibleChapter.title);
            const hidden = settings.navigationMode === 'paged' && chapterIndex !== position.chapter;
            const chapterReady = visibleChapter.paragraphs.every(
              (p) => !!stableTranslations.read(chapterIndex, p),
            );
            return (
              <section
                key={visibleChapter.id}
                className="reader-chapter"
                data-chapter-index={chapterIndex}
                data-current={chapterIndex === position.chapter}
                aria-hidden={hidden || undefined}
                inert={hidden || undefined}
              >
                <div className="page-viewport">
                  <article
                    className="book-page"
                    data-book-page
                    data-mode={view}
                    data-font={settings.fontFamily}
                    aria-label={visibleChapter.title}
                  >
                    {(!hasChapterHeading || (view !== 'original' && !chapterReady)) && (
                      <h1
                        className="chapter-title"
                        dir="auto"
                        lang={book.language === 'auto' ? undefined : book.language}
                      >
                        {visibleChapter.title}
                      </h1>
                    )}
                    {view !== 'original' && !chapterReady ? (
                      <div data-paragraph={visibleChapter.paragraphs[0]?.id}>
                        <ChapterPreparation
                          controller={bookTranslation}
                          index={chapterIndex}
                          open={() => openTool('translations')}
                          original={() => updateAppearance({ readingMode: 'original' })}
                          connect={() => (needsLogin ? openLogin() : setSettingsOpen(true))}
                        />
                      </div>
                    ) : (
                      visibleChapter.paragraphs.map((paragraph, index) => {
                        const translated = stableTranslations.read(chapterIndex, paragraph);
                        const isTitle = index === 0 && hasChapterHeading;
                        return (
                          <section
                            key={paragraph.id}
                            id={`passage-${paragraph.id}`}
                            data-paragraph={paragraph.id}
                            data-jump-target={jumpHighlight === paragraph.id || undefined}
                            data-kind={paragraph.kind}
                            data-title={isTitle}
                            data-annotated={notes.some((note) => note.paragraphId === paragraph.id)}
                            className="reading-passage group/passage"
                          >
                            {view !== 'translation' &&
                              (isTitle ? (
                                <h1
                                  className="chapter-title"
                                  data-note-source="original"
                                  lang={book.language === 'auto' ? undefined : book.language}
                                  dir="auto"
                                >
                                  {markedPassage(
                                    paragraph.text,
                                    notes.filter((note) => note.paragraphId === paragraph.id),
                                  )}
                                </h1>
                              ) : (
                                <div
                                  className="passage-original"
                                  data-note-source="original"
                                  lang={book.language === 'auto' ? undefined : book.language}
                                  dir="auto"
                                >
                                  {markedPassage(
                                    paragraph.text,
                                    notes.filter((note) => note.paragraphId === paragraph.id),
                                  )}
                                </div>
                              ))}
                            {view !== 'original' && (translated || view === 'translation') && (
                              <div
                                data-translation
                                data-note-source={translated ? 'translation' : undefined}
                                data-note-key={
                                  translated
                                    ? stableTranslations.key(chapterIndex, paragraph)
                                    : undefined
                                }
                                className={
                                  isTitle && view === 'translation'
                                    ? 'chapter-title'
                                    : 'passage-translation'
                                }
                                lang={settings.language}
                                dir="auto"
                              >
                                {translated ? (
                                  markedPassage(
                                    translated,
                                    notes.filter((note) => note.paragraphId === paragraph.id),
                                    'translation',
                                    stableTranslations.key(chapterIndex, paragraph),
                                  )
                                ) : (
                                  <div
                                    data-note-source="original"
                                    lang={book.language}
                                    dir="auto"
                                    className="text-foreground"
                                  >
                                    {markedPassage(
                                      paragraph.text,
                                      notes.filter((note) => note.paragraphId === paragraph.id),
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                            {!isTitle && (
                              <div className="passage-actions">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="rounded-full"
                                  aria-label={t('摘录段落 {value0}', { value0: paragraph.id })}
                                  title={t('摘录这一段')}
                                  onClick={() => {
                                    setSelected({ paragraph, text: paragraph.text });
                                    openNoteComposer({ paragraph, text: paragraph.text });
                                  }}
                                >
                                  <Bookmark size={15} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="rounded-full"
                                  aria-label={t('解释段落 {value0}', { value0: paragraph.id })}
                                  title={t('围绕这一段提问')}
                                  disabled={Boolean(busy)}
                                  onClick={() => {
                                    const passage = { paragraph, text: paragraph.text };
                                    setSelected(passage);
                                    openCompanion('chat');
                                  }}
                                >
                                  <Sparkles size={15} />
                                </Button>
                              </div>
                            )}
                          </section>
                        );
                      })
                    )}
                  </article>
                </div>
                {settings.navigationMode === 'paged' && (
                  <>
                    <span
                      data-page-grip
                      className="reader-page-grip reader-page-grip-left"
                      aria-hidden="true"
                    />
                    <span
                      data-page-grip
                      className="reader-page-grip reader-page-grip-right"
                      aria-hidden="true"
                    />
                  </>
                )}
                {settings.navigationMode === 'scroll' && settings.scrollFlow === 'chapter' && (
                  <ChapterEnding
                    chapter={visibleChapter}
                    next={book.chapters[chapterIndex + 1]}
                    previous={book.chapters[chapterIndex - 1]}
                    index={chapterIndex}
                    turning={navigation.turning}
                    onChapter={navigation.changeChapter}
                    onContents={() => setSidebarOpen(true)}
                    onFinish={() => router.push('/library')}
                  />
                )}
              </section>
            );
          })}
        </div>
      </main>

      <nav className="desktop-reading-tools reading-chrome" aria-label={t('阅读工具')}>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('打开目录')}
          title={t('目录 / 搜索 ⌘K')}
          onClick={() => {
            setSearchOpen(false);
            setSidebarOpen(true);
          }}
        >
          <List size={21} strokeWidth={1.6} />
        </Button>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('打开 AI 伴读')}
          title={t('AI 伴读')}
          onClick={() => openCompanion('chat')}
        >
          <Sparkles size={21} strokeWidth={1.6} />
        </Button>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('打开笔记')}
          title={t('笔记')}
          onClick={() => openCompanion('notes')}
        >
          <Bookmark size={20} strokeWidth={1.6} />
        </Button>
        <span className="mx-auto my-1 h-px w-5 bg-border" />
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('阅读语言与双语')}
          title={t('原文 / 双语 / 译文')}
          onClick={() => openTool('language')}
        >
          <Languages size={21} strokeWidth={1.6} />
        </Button>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('阅读设置')}
          title={t('字号与排版')}
          onClick={() => setAppearanceOpen(true)}
        >
          <span className="text-xl font-normal">
            A<span className="text-sm">a</span>
          </span>
        </Button>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={settings.theme === 'paper' ? t('切换夜间模式') : t('切换日间模式')}
          title={t('日间 / 夜间')}
          onClick={() =>
            updateAppearance({ theme: settings.theme === 'paper' ? 'night' : 'paper' })
          }
        >
          {settings.theme === 'paper' ? (
            <Moon size={20} strokeWidth={1.6} />
          ) : (
            <Sun size={20} strokeWidth={1.6} />
          )}
        </Button>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('专注阅读，隐藏工具')}
          title={t('专注阅读')}
          onClick={() => setChromeVisible(false)}
        >
          <Minimize2 size={19} strokeWidth={1.6} />
        </Button>
      </nav>
      {!chromeVisible && (
        <Button
          variant="ghost"
          size="icon-lg"
          className="fixed right-5 top-5 z-20 hidden rounded-full text-muted-foreground/50 hover:text-foreground md:inline-flex"
          onClick={() => setChromeVisible(true)}
          aria-label={t('显示阅读工具')}
          title={t('显示阅读工具')}
        >
          <Maximize2 size={17} />
        </Button>
      )}
      {stableTranslations.pending &&
        settings.navigationMode === 'paged' &&
        chapter.paragraphs.every((p) => stableTranslations.read(position.chapter, p)) && (
          <button
            className="reader-translation-ready"
            onClick={stableTranslations.apply}
            disabled={navigation.turning}
          >
            {t('译文已就绪 · 显示译文')}
          </button>
        )}
      <ReadingNavigation
        mode={settings.navigationMode}
        chapterTitle={chapter.title}
        rtl={book.pageDirection === 'rtl'}
        page={navigation.page}
        pages={navigation.pages}
        atStart={navigation.atStart}
        atEnd={navigation.atEnd}
        chapterIndex={position.chapter}
        chapterCount={book.chapters.length}
        turning={navigation.turning}
        progress={progress}
        onTurn={(direction) => {
          void navigation.turn(direction);
        }}
        onContents={() => setSidebarOpen(true)}
        onMode={() => setAppearanceOpen(true)}
      />
      {settings.navigationMode === 'scroll' && !chromeVisible && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-10 -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground">
          {progress}%
        </div>
      )}
      <footer className="mobile-reading-tools reading-chrome">
        <div
          dir={book.pageDirection === 'rtl' ? 'rtl' : 'ltr'}
          className="mb-3 flex items-center gap-3 px-3 text-[11px] text-muted-foreground"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={settings.navigationMode === 'paged' ? t('向前翻页') : t('上一章')}
            disabled={
              navigation.turning ||
              (position.chapter === 0 &&
                (settings.navigationMode !== 'paged' || navigation.atStart))
            }
            onClick={() =>
              settings.navigationMode === 'paged'
                ? void navigation.turn(-1)
                : navigation.changeChapter(position.chapter - 1, 'end')
            }
          >
            {book.pageDirection === 'rtl' ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </Button>
          <button
            className="flex min-h-8 min-w-0 flex-1 items-center gap-3"
            onClick={() => openTool('progress')}
            aria-label={t('调整阅读进度')}
          >
            <span className="min-w-0 flex-1 truncate text-start">{chapter.title}</span>
            <span className="shrink-0 tabular-nums">
              {settings.navigationMode === 'paged'
                ? t('{value0}/{value1} 页', { value0: navigation.page, value1: navigation.pages })
                : `${progress}%`}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              settings.navigationMode === 'paged'
                ? navigation.atEnd
                  ? t('下一章')
                  : t('向后翻页')
                : t('下一章')
            }
            disabled={
              navigation.turning ||
              (position.chapter === book.chapters.length - 1 &&
                (settings.navigationMode !== 'paged' || navigation.atEnd))
            }
            onClick={() =>
              settings.navigationMode === 'paged'
                ? void navigation.turn(1)
                : navigation.changeChapter(position.chapter + 1)
            }
          >
            {book.pageDirection === 'rtl' ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </Button>
        </div>
        <nav className="grid grid-cols-5" aria-label={t('手机阅读工具')}>
          <Button
            variant="plain"
            size="plain"
            className="mobile-reader-tool"
            onClick={() => {
              setSearchOpen(false);
              setSidebarOpen(true);
            }}
          >
            <List size={22} strokeWidth={1.6} />
            <span>{t('目录')}</span>
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="mobile-reader-tool"
            onClick={() => openTool('progress')}
          >
            <History size={22} strokeWidth={1.6} />
            <span>{t('进度')}</span>
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="mobile-reader-tool"
            onClick={() => openCompanion('notes')}
          >
            <Bookmark size={21} strokeWidth={1.6} />
            <span>{t('笔记')}</span>
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="mobile-reader-tool"
            onClick={() => openTool('language')}
          >
            <Languages size={22} strokeWidth={1.6} />
            <span>
              {view === 'original' ? t('双语') : view === 'bilingual' ? t('双语中') : t('译文中')}
            </span>
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="mobile-reader-tool"
            onClick={() => setAppearanceOpen(true)}
          >
            <span className="text-[23px] leading-[22px]">Aa</span>
            <span>{t('排版')}</span>
          </Button>
        </nav>
      </footer>

      {referenceReturn && !tool && (
        <div className="reference-return fixed bottom-10 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card p-1 shadow-lg">
          <Button
            variant="ghost"
            className="h-9 rounded-full px-4 text-xs"
            onClick={returnFromReference}
          >
            <ArrowLeft size={14} />
            {referenceReturn.panel
              ? t('返回{value0}', {
                  value0: referenceReturn.panel === 'chat' ? t('AI 伴读') : t('笔记'),
                })
              : t('返回刚才位置')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t('留在当前原文')}
            onClick={() => setReferenceReturn(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {selectionMenu && selected && !tool && (
        <div
          role="toolbar"
          aria-label={t('选中文字操作')}
          className="selection-toolbar fixed z-30 flex w-[264px] items-center rounded-xl bg-[#303236] p-1.5 text-white shadow-xl"
          style={{ top: selectionMenu.top, left: selectionMenu.left }}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse') event.preventDefault();
          }}
        >
          <Button
            variant="plain"
            size="plain"
            className="selection-action"
            onClick={() => {
              void navigator.clipboard
                .writeText(selected.text)
                .then(() => {
                  setNotice(t('已复制'));
                  setSelectionMenu(null);
                })
                .catch(report);
            }}
          >
            <Copy size={17} />
            {t('复制')}
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="selection-action"
            onClick={() => {
              void saveNote('highlight');
            }}
          >
            <Highlighter size={17} />
            {t('划线')}
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="selection-action"
            onClick={() => openNoteComposer()}
          >
            <PencilLine size={17} />
            {t('写想法')}
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="selection-action"
            onClick={() => openCompanion('chat')}
          >
            <Sparkles size={17} />
            {t('问 AI')}
          </Button>
        </div>
      )}

      <ReadingPanel
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        title={t('目录')}
        autoFocusSelector={searchOpen ? '[data-reader-search]' : undefined}
      >
        <div className="shrink-0 px-7 pb-4">
          <p className="mb-1 line-clamp-2 text-base font-medium leading-relaxed">{book.title}</p>
          <p className="mb-5 text-xs text-muted-foreground">{book.author}</p>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <Input
              className="h-10 rounded-full border-0 bg-muted ps-10 pe-9 text-sm shadow-none"
              placeholder={t('搜索书中内容')}
              data-reader-search
              aria-label={t('搜索书中内容')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1 rounded-full"
                onClick={() => setSearch('')}
                aria-label={t('清除搜索')}
              >
                <X size={14} />
              </Button>
            )}
          </div>
        </div>
        <nav
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6"
          aria-label={t('章节目录')}
        >
          {search.trim() ? (
            searchResults.length ? (
              searchResults.map((paragraph) => (
                <Button
                  variant="plain"
                  size="plain"
                  key={paragraph.id}
                  className="block w-full border-b px-3 py-4 text-start text-sm leading-7 hover:bg-muted"
                  onClick={() => {
                    navigate(paragraph.id);
                    setSearch('');
                  }}
                >
                  <span className="mb-1 block text-xs text-muted-foreground">
                    {
                      book.chapters.find((item) =>
                        item.paragraphs.some((p) => p.id === paragraph.id),
                      )?.title
                    }
                  </span>
                  <span className="line-clamp-3">{paragraph.text}</span>
                </Button>
              ))
            ) : (
              <p className="px-3 py-8 text-sm text-muted-foreground">{t('没有找到匹配的内容')}</p>
            )
          ) : (
            book.chapters.map((item, index) => (
              <Button
                variant="plain"
                size="plain"
                key={item.id}
                aria-current={position.chapter === index ? 'location' : undefined}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-4 text-start text-sm leading-7 hover:bg-muted aria-[current=location]:text-primary"
                onClick={() => {
                  const firstParagraph = item.paragraphs[0];
                  if (firstParagraph) navigate(firstParagraph.id);
                }}
                disabled={switching}
              >
                <span>{item.title}</span>
                {position.chapter === index && (
                  <span className="shrink-0 text-[11px]">{t('正在读')}</span>
                )}
              </Button>
            ))
          )}
        </nav>
        <div className="flex shrink-0 items-center justify-between border-t px-7 py-4 text-xs text-muted-foreground">
          <span>{t('{count} 个章节', { count: book.chapters.length })}</span>
          <Button
            variant="link"
            size="plain"
            className="text-xs font-normal"
            onClick={() => {
              setSidebarOpen(false);
              router.push('/library');
            }}
          >
            {t('返回书架')}
          </Button>
        </div>
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'translations'}
        onOpenChange={(open) => openTool(open ? 'translations' : null)}
        title={locale.startsWith('zh') ? '书籍译本' : 'Book translation'}
      >
        <div className="overflow-y-auto px-7 pb-8">
          <p className="mb-5 text-sm leading-6 text-muted-foreground">{book.title}</p>
          <TranslationPanel
            controller={bookTranslation}
            book={book}
            chapter={position.chapter}
            connect={() => (needsLogin ? openLogin() : setSettingsOpen(true))}
          />
        </div>
      </ReadingPanel>

      <ReadingPanel
        open={appearanceOpen}
        onOpenChange={setAppearanceOpen}
        title={t('阅读设置')}
        compact
      >
        <ReadingAppearance settings={settings} update={updateAppearance} />
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'language'}
        onOpenChange={(open) => !open && openTool(null)}
        title={t('阅读语言')}
        compact
      >
        <ReadingLanguage
          settings={settings}
          update={updateAppearance}
          openSettings={() => setSettingsOpen(true)}
        />
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'more'}
        onOpenChange={(open) => !open && openTool(null)}
        title={t('阅读选项')}
        compact
      >
        <div className="grid gap-1 px-5 pb-6 text-sm">
          <Link
            className="flex items-center gap-3 rounded-xl px-4 py-4 hover:bg-muted"
            href={`/books/${book.id}`}
          >
            <BookOpen size={19} />
            {t('书籍详情')}
          </Link>
          <button
            className="flex items-center gap-3 rounded-xl px-4 py-4 text-start hover:bg-muted"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={19} />
            {t('AI 连接设置')}
          </button>
          <button
            className="flex items-center gap-3 rounded-xl px-4 py-4 text-start hover:bg-muted"
            onClick={() => setHelpOpen(true)}
          >
            <BookOpen size={19} />
            {t('阅读帮助')}
          </button>
        </div>
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'progress'}
        onOpenChange={(open) => !open && openTool(null)}
        title={t('阅读进度')}
        compact
      >
        <ReadingProgress
          key={tool === 'progress' ? position.paragraph : 'closed'}
          chapters={book.chapters}
          paragraph={position.paragraph}
          navigate={(id) => {
            navigate(id);
            openTool(null);
          }}
        />
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'compose'}
        onOpenChange={(open) => !open && openTool(null)}
        title={t('写想法')}
        compact
        autoFocusSelector="[data-note-editor]"
      >
        <form
          className="overflow-y-auto px-7 pb-7"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNote();
          }}
        >
          <blockquote
            dir="auto"
            className="mb-5 max-h-28 overflow-y-auto border-s-2 border-primary/40 ps-4 text-sm leading-7 text-muted-foreground"
          >
            {draftSelection?.text}
          </blockquote>
          <Textarea
            data-note-editor
            aria-label={t('笔记内容')}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            maxLength={4000}
            placeholder={t('写下此刻的想法…')}
            className="min-h-32 resize-none rounded-xl border-0 bg-muted p-4 text-base shadow-none"
            disabled={savingNote}
          />
          <div className="mt-5 flex items-center justify-between gap-4">
            <span className="text-xs text-muted-foreground">{t('收起后可从笔记继续编辑')}</span>
            <Button
              type="submit"
              className="rounded-full px-6"
              disabled={!draftSelection || savingNote}
            >
              {savingNote ? t('保存中…') : t('保存')}
            </Button>
          </div>
        </form>
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'delete'}
        onOpenChange={(open) => !open && subTool('delete', false)}
        title={t('删除这条笔记？')}
        compact
      >
        <div className="px-7 pb-7">
          <p className="mb-6 text-sm leading-7 text-muted-foreground">
            {t('删除后无法恢复，书籍正文不会改变。')}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => subTool('delete', false)}>
              {t('取消')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteNote) return;
                void storage
                  .modifyNote(book.id, deleteNote.id, null, deleteNote)
                  .then(() => {
                    setDeleteNote(null);
                    subTool('delete', false);
                  })
                  .catch((error) => {
                    setDeleteNote(null);
                    subTool('delete', false);
                    report(error);
                  });
              }}
            >
              {t('删除笔记')}
            </Button>
          </div>
        </div>
      </ReadingPanel>

      <ReadingPanel
        open={companionOpen}
        onOpenChange={setCompanionOpen}
        title={panel === 'chat' ? t('AI 伴读') : t('笔记')}
      >
        <Tabs
          value={panel}
          onValueChange={(value) => setPanel(value as 'chat' | 'notes')}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            variant="line"
            className="mx-7 mb-2 h-10 shrink-0 justify-start gap-6 rounded-none border-b"
          >
            <TabsTrigger value="chat">{t('AI 伴读')}</TabsTrigger>
            <TabsTrigger value="notes">
              {t('笔记')}
              {notes.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {notes.length.toLocaleString(locale)}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="chat"
            className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <div className="mx-7 mb-3 mt-2 flex items-center gap-3 text-muted-foreground">
              <BookOpen size={15} />
              <Select
                disabled={Boolean(busy)}
                value={settings.scope}
                onValueChange={(scope) =>
                  setSettings((previous) => ({
                    ...previous,
                    scope: scope as typeof settings.scope,
                  }))
                }
              >
                <SelectTrigger
                  aria-label={t('AI 参考范围')}
                  className="h-8 flex-1 border-0 bg-transparent p-0 text-xs shadow-none dark:bg-transparent"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(scopeNames).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {localize(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSettingsOpen(true)}
                aria-label={t('AI 连接设置')}
              >
                <Settings2 size={16} />
              </Button>
            </div>
            <div
              ref={restoreChatScroll}
              onScroll={(event) => {
                chatScrollPosition.current = event.currentTarget.scrollTop;
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-5"
            >
              {!messages.length && (
                <div className="pt-8 text-sm leading-7">
                  <p className="text-foreground">
                    {selected ? t('围绕这段文字，一起读深一点。') : t('从正在读的这一页开始。')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('解释会附上原文引用，点击即可回看。')}
                  </p>
                  <div className="mt-7 flex flex-col items-start gap-3">
                    {[t('请梳理本章的核心观点，引用原文。'), t('请结合上下文解释这段文字。')].map(
                      (prompt, index) => (
                        <Button
                          key={prompt}
                          variant="outline"
                          className="h-auto rounded-full px-4 py-2.5 text-xs font-normal shadow-none"
                          onClick={() => void ask(prompt)}
                        >
                          {index === 0 ? t('这一章在讲什么？') : t('这里是什么意思？')}
                          <ArrowUpRight size={13} />
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              )}
              {messages.map((message, index) => (
                <div key={index} data-role={message.role} className="group/message pt-6">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {message.role === 'assistant' ? (
                      <>
                        <Sparkles size={13} />
                        {t('AI 伴读')}
                      </>
                    ) : (
                      t('你')
                    )}
                    {message.partial && <span className="ms-auto">{t('未完成')}</span>}
                  </div>
                  {message.content ? (
                    <Answer
                      content={message.content}
                      sources={message.sources}
                      navigate={(id) => followReference(id, 'chat')}
                    />
                  ) : (
                    <LoaderCircle size={16} className="animate-spin text-muted-foreground" />
                  )}
                </div>
              ))}
              {busy === 'chat' && (
                <div
                  role="status"
                  className="mt-5 flex items-center gap-2 text-xs leading-6 text-muted-foreground"
                >
                  <LoaderCircle size={13} className="animate-spin" />
                  {localize(busyText)}
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div className="shrink-0 border-t px-5 pb-5 pt-4">
              {selected ? (
                <div className="mb-3 rounded-lg bg-muted px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('选中文段')}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('移除选中文段')}
                      onClick={() => setSelected(null)}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-6 text-muted-foreground">
                    {selected.text}
                  </p>
                </div>
              ) : (
                <p className="mb-3 truncate text-xs text-muted-foreground">
                  {t('参考：{value0}', { value0: chapter.title })}
                </p>
              )}
              <form
                className="rounded-2xl border bg-background p-3 focus-within:border-primary/50"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(question);
                }}
              >
                <Textarea
                  aria-label={t('向 AI 提问')}
                  placeholder={selected ? t('问问这段文字…') : t('这里是什么意思？')}
                  value={question}
                  maxLength={4000}
                  className="min-h-16 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void ask(question);
                    }
                  }}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <Button
                    variant="link"
                    size="plain"
                    type="button"
                    className="min-w-0 truncate text-xs font-normal text-muted-foreground"
                    onClick={() => (needsLogin ? openLogin() : setSettingsOpen(true))}
                  >
                    <span className="truncate">
                      {needsLogin
                        ? t('登录后使用 AI 伴读')
                        : aiReady
                          ? settings.model
                          : t('连接 AI 模型')}
                    </span>
                    <ChevronDown size={12} />
                  </Button>
                  {busy ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      className="rounded-full"
                      aria-label={t('停止生成')}
                      onClick={() => operation.current?.abort()}
                    >
                      <Square size={13} />
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm"
                      className="rounded-full"
                      disabled={!question.trim()}
                      aria-label={t('发送问题')}
                    >
                      <ArrowUp size={17} />
                    </Button>
                  )}
                </div>
              </form>
              <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{t('AI 可能出错，请核对原文')}</span>
                <div className="flex gap-3">
                  {messages.length > 0 && (
                    <Button
                      variant="plain"
                      size="plain"
                      className="text-[10px]"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void storage
                          .clearChat(book.id)
                          .then(() => setMessages([]))
                          .catch(report)
                      }
                    >
                      {t('清空')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent
            value="notes"
            ref={restoreNotesScroll}
            onScroll={(event) => {
              notesScrollPosition.current = event.currentTarget.scrollTop;
            }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-7"
          >
            {draftSelection && (
              <button
                className="mt-4 flex w-full items-center justify-between rounded-xl bg-muted p-4 text-start text-sm"
                onClick={() => openTool('compose')}
              >
                <span>{t('继续未保存的想法')}</span>
                <PencilLine size={16} />
              </button>
            )}
            {selected && (
              <Button
                variant="outline"
                className="mt-4 w-full rounded-full"
                onClick={() => openNoteComposer()}
              >
                <PencilLine size={16} />
                {t('为选中的文字写想法')}
              </Button>
            )}
            <div className="flex items-center justify-between py-4 text-xs text-muted-foreground">
              <span>{t('{count} 条笔记与划线', { count: notes.length })}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs font-normal"
                disabled={!notes.length}
                onClick={exportNotes}
              >
                <ArrowDownToLine size={14} />
                {t('导出')}
              </Button>
            </div>
            {!notes.length && !selected && (
              <div className="py-16 text-center text-muted-foreground">
                <Bookmark size={28} strokeWidth={1.3} className="mx-auto mb-4" />
                <p className="text-sm">{t('选中文字，留下一个想法。')}</p>
                <p className="mt-2 text-xs">{t('笔记和划线保存在本地')}</p>
              </div>
            )}
            {notes.map((note) => (
              <div className="border-b py-5" key={note.id}>
                <Button
                  variant="plain"
                  size="plain"
                  className="mb-3 max-w-full text-start text-xs leading-6 text-muted-foreground"
                  onClick={() => {
                    followReference(note.paragraphId, 'notes');
                  }}
                >
                  <span className="truncate">
                    {book.chapters.find((item) =>
                      item.paragraphs.some((p) => p.id === note.paragraphId),
                    )?.title ?? t('查看原文')}
                  </span>
                  <ArrowUpRight size={13} />
                </Button>
                <blockquote
                  dir="auto"
                  className="max-h-48 overflow-auto border-s-2 ps-4 text-sm leading-7 text-muted-foreground"
                >
                  {note.quote}
                </blockquote>
                {note.text && (
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{note.text}</p>
                )}
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                  <time>{new Date(note.createdAt).toLocaleDateString(locale)}</time>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('删除这条笔记')}
                    onClick={() => {
                      setDeleteNote(note);
                      subTool('delete', true);
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </ReadingPanel>
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          hasServerKey={hasServerKey}
          accountMode={authEnabled && Boolean(user)}
          onSave={async (s, clearKey) => {
            let next = s;
            if (authEnabled && user) {
              const config = await saveAIConnection(s);
              next = applyAIConnection(s, config);
              setHasServerKey(config.hasKey);
            }
            settingsEdited.current = true;
            setSettings(next);
            setNotice(t('设置已保存。'));
          }}
          close={() => setSettingsOpen(false)}
        />
      )}
      {helpOpen && (
        <Modal title={t('跨越语言，读懂每一页。')} close={() => setHelpOpen(false)}>
          <div className="mt-5 text-[13px] leading-[1.9] text-muted-foreground [&_p]:my-[1em]">
            <p>
              {t(
                'ByPage · 逐页 是一个开源的多语言阅读器。书籍、阅读位置、译文和笔记保存在浏览器 IndexedDB 中；清除网站数据会移除它们。',
              )}
            </p>
            <p>
              {t(
                '从书架导入 EPUB 或 TXT。双语和译文模式按章节准备，完整章节就绪后自动打开。可在“译本”中准备整本、暂停或继续；切回原文不会取消任务。已完成章节保存在本机。AI 跟随阅读位置，选中文字可指定提问范围。',
              )}
            </p>
            <p>
              {t(
                '“截至最远章节”包括你曾打开的章节，不代表逐段读过。长书采用关键词检索，回答可能只参考部分原文。引用可点击核对。',
              )}
            </p>
            <p>{t('当前专注文字阅读，不支持 PDF、DRM 或扫描件。')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
              <a
                className="inline-flex items-center gap-[5px] text-primary no-underline [&_svg]:rotate-45"
                href="https://leafread.ai"
                target="_blank"
                rel="noreferrer"
              >
                leafread.ai <ArrowUp size={14} />
              </a>
              <a className="text-primary no-underline" href={SUPPORT_MAILTO}>
                {SUPPORT_EMAIL}
              </a>
              <a className="text-primary no-underline" href="/privacy">
                {locale.startsWith('zh') ? '隐私政策' : 'Privacy Policy'}
              </a>
              <a className="text-primary no-underline" href="/terms">
                {locale.startsWith('zh') ? '服务条款' : 'Terms of Service'}
              </a>
            </div>
          </div>
        </Modal>
      )}
      {notice && (
        <div
          className="fixed bottom-[25px] left-1/2 z-[60] flex max-w-[min(600px,90vw)] -translate-x-1/2 items-center gap-5 rounded-[9px] border border-[#6f8a6240] bg-[#303236] py-[11px] ps-[19px] pe-[14px] text-xs leading-[1.7] text-white shadow-[0_8px_30px_#15281e29] [&_button]:size-[22px] [&_button]:text-white/70 max-[720px]:w-max max-[720px]:max-w-[92vw]"
          role="status"
        >
          <span>{localize(notice)}</span>
          <Button
            variant="plain"
            size="plain"
            className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-md p-[5px] text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-40"
            onClick={() => setNotice('')}
            aria-label={t('关闭提示')}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {(!ready || switching) && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center gap-3 bg-background/90 text-[13px] text-muted-foreground backdrop-blur-[3px] dark:bg-background/90"
          role="status"
        >
          <LoaderCircle size={20} className="animate-spin" />
          {t('正在打开书籍…')}
        </div>
      )}
    </div>
  );
}
