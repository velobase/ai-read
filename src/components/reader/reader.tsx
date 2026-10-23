'use client';
import { measureClient } from '@/lib/observability/client';
import {
  bookContents,
  createContentsOutline,
  visibleContentsOutline,
  contentsOutlineAncestors,
  isPdfBook,
  sameReadingLanguage,
  effectiveBookLanguage,
  resolveSavedPassage,
  resolvePdfTextEvidence,
  safeReadingQuote,
  readingScopeParagraphs,
  readingChapterNavigation,
  validateBookmark,
  bookmarkLocationKey,
  type Bookmark as ReadingBookmark,
  type ReadingChapterTarget,
} from '../../../packages/reading-core/src';

import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact';

import { useI18n } from '@/lib/i18n/provider';
import {
  readAIConnection,
  saveAIConnection,
  applyAIConnection,
  type AIConnection,
} from '@/lib/ai-connection';
import {
  localeStorageKey,
  directionFor,
  readingLanguages,
  displayLanguage,
} from '@/lib/i18n/config';

import { sameData } from '@/lib/sync-types';
import { readingProgress } from '@/lib/reading-progress';
import { captureNoteSelection } from '@/lib/note-anchors';
import { getSyncEntry } from '@/lib/sync-storage';
import { storageKey } from '@/lib/storage-scope';
import { useIdentity } from '@/components/auth/identity-provider';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { updateLibraryBooks } from '@/lib/library-state';
import { ChapterEnding, ReadingNavigation } from './reading-navigation';
import {
  readReadingAnchor,
  restoreReadingAnchor,
  useReadingNavigation,
  type ReadingAnchor,
} from './use-reading-navigation';
import {
  activeFrame,
  forgetReadingAnchor,
  hasReadableTranslation,
  pageCount,
  setPage,
  type PendingContentAnchor,
} from './reading-layout';
import { BookIllustration, IllustrationDialog, type Illustration } from './book-illustration';
import { BookmarksPanel } from './bookmarks-panel';
import { ReaderLoading } from './reader-loading';
import {
  ReaderSearchMatches,
  useReaderBookSearch,
  type ReaderSearchSource,
} from './reader-book-search';
import type { PassageMatch } from '@/lib/book-search';
import { readSearchTranslation, type TranslationSearchTarget } from '@/lib/translation-search';
import {
  BookReferencePreview,
  MarkedPassage,
  OriginalReferences,
  type InlineBookReference,
} from './book-reference';
import type {
  BookReferenceLink,
  BookReferenceTarget,
} from '../../../packages/reading-core/src/types';
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
  Fragment,
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
  LoaderCircle,
  LocateFixed,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PencilLine,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { Answer, Modal, SettingsModal } from './reader-dialogs';
import { buildContext, expandQuestion, streamAI } from '@/lib/ai';
import { sampleBook, sampleTranslations } from '@/lib/sample';
import { loadSettings, saveSettings, storage } from '@/lib/storage';
import { useBookTranslation } from './use-book-translation';
import { readSavedTranslationVersion } from '@/lib/saved-translation-storage';
import { resolveTranslationKey } from '../../../packages/reading-core/src/translation-key';
import { contentHash } from '@/lib/translation-edition';
import { canUseAI, hasMatchingServerKey } from '@/lib/ai-availability';
import {
  type Book,
  type Message,
  type Note,
  type NoteAnchor,
  type Paragraph,
  type Position,
  type Settings,
} from '@/lib/types';

function withBookLanguage(bookId: string, settings: Settings): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey('ai-read-book-language')) || '{}')[
      bookId
    ];
    if (!saved) return { ...settings, readingMode: 'bilingual' };
    return {
      ...settings,
      readingMode: ['original', 'bilingual', 'translation'].includes(saved.readingMode)
        ? saved.readingMode
        : settings.readingMode,
      language: readingLanguages.some(([code]) => code === saved.language)
        ? saved.language
        : settings.language,
    };
  } catch {
    return settings;
  }
}

const emptyPosition: Position = { chapter: 0, paragraph: '1.1', farthest: 0 };
const PdfOriginalDialog = dynamic(
  () => import('@/components/pdf/pdf-original-dialog').then((module) => module.PdfOriginalDialog),
  { ssr: false },
);
const scopeNames = { chapter: '当前章节', read: '截至最远章节', book: '整本书（可能剧透）' };
type ReaderTool =
  | 'contents'
  | 'bookmarks'
  | 'companion'
  | 'appearance'
  | 'language'
  | 'progress'
  | 'compose'
  | 'settings'
  | 'help'
  | 'delete'
  | 'pdf-original'
  | 'more';
type PassageSelection = { paragraph: Paragraph; text: string; anchor?: NoteAnchor };
type RevealedTranslation = {
  bookId: string;
  paragraph: string;
  language: string;
  key: string;
  text: string;
  sourceLanguage: string;
  preferredLanguage: string;
  readingMode: Settings['readingMode'];
};

type OriginalReadingOverride = {
  bookId: string;
  language: string;
  readingMode: Settings['readingMode'];
};
type ReferenceReturn = {
  bookId: string;
  activation: number;
  context: string;
  anchor: ReadingAnchor;
  translationKey?: string;
  mode: Settings['navigationMode'];
  panel: 'chat' | 'notes' | null;
  selection: PassageSelection | null;
  translation: RevealedTranslation | null;
  original: OriginalReadingOverride | null;
  referenceSources?: string[];
};
type SearchReturn = {
  origin: ReferenceReturn;
  history: ReferenceReturn[];
  results: {
    query: string;
    source: ReaderSearchSource;
    language: string;
    page: number;
    scrollTop: number;
  };
};
const MAX_REFERENCE_RETURNS = 8;

async function savedPassageTranslation(
  book: Book,
  paragraphId: string,
  key: string | undefined,
  saved: Record<string, string>,
  settings: Settings,
): Promise<RevealedTranslation | null> {
  if (!key) return null;
  const identity = resolveTranslationKey(
    key,
    new Set(book.chapters.flatMap((c) => c.paragraphs.map((p) => p.id))),
  );
  if (!identity || identity.paragraphId !== paragraphId) return null;
  const language = identity.language;
  const prefix = `${language}:${paragraphId}:`;
  const exact = await readSavedTranslationVersion(book, key);
  if (exact === null) return null;
  let text = exact?.paragraphId === paragraphId && exact.language === language ? exact.text : '';
  if (exact === undefined)
    text = key.startsWith(`${prefix}edition-`)
      ? (await readSearchTranslation(book, { paragraphId, language, translationKey: key })) || ''
      : saved[key];
  if (!text) return null;
  return {
    bookId: book.id,
    paragraph: paragraphId,
    language,
    key,
    text,
    sourceLanguage: effectiveBookLanguage(book),
    preferredLanguage: settings.language,
    readingMode: settings.readingMode,
  };
}

async function savedNoteTranslation(
  book: Book,
  note: Note,
  saved: Record<string, string>,
  settings: Settings,
): Promise<RevealedTranslation | null> {
  if (note.bookId !== book.id) return null;
  return savedPassageTranslation(
    book,
    note.paragraphId,
    note.anchor?.source === 'translation' ? note.anchor.translationKey : undefined,
    saved,
    settings,
  );
}

async function savedSearchTranslation(
  book: Book,
  paragraphId: string,
  start: number | undefined,
  target: TranslationSearchTarget,
  settings: Settings,
  signal?: AbortSignal,
): Promise<{ translation: RevealedTranslation; start: number; quote: string } | null> {
  if (
    !Number.isSafeInteger(start) ||
    start! < 0 ||
    !Number.isSafeInteger(target.sourceEnd) ||
    target.sourceEnd <= start! ||
    !/^[a-f0-9]{64}$/.test(target.textHash)
  )
    return null;
  const text = await readSearchTranslation(book, { paragraphId, ...target }, signal);
  signal?.throwIfAborted();
  if (!text || target.sourceEnd > text.length || (await contentHash(text)) !== target.textHash)
    return null;
  signal?.throwIfAborted();
  const paragraph = book.chapters
    .flatMap((chapter) => chapter.paragraphs)
    .find((entry) => entry.id === paragraphId);
  if (!paragraph) return null;
  const resolved = resolveSavedPassage(
    paragraph,
    {
      anchor: {
        source: 'translation',
        start: start!,
        end: target.sourceEnd,
        translationKey: target.translationKey,
      },
      quote: text.slice(start, target.sourceEnd),
    },
    (key) => (key === target.translationKey ? text : undefined),
  );
  if (
    resolved.source !== 'translation' ||
    resolved.fallback ||
    resolved.start !== start ||
    resolved.end !== target.sourceEnd
  )
    return null;
  return {
    start: resolved.start,
    quote: safeReadingQuote(text, resolved.start),
    translation: {
      bookId: book.id,
      paragraph: paragraphId,
      language: target.language,
      key: target.translationKey,
      text,
      sourceLanguage: effectiveBookLanguage(book),
      preferredLanguage: settings.language,
      readingMode: settings.readingMode,
    },
  };
}

export default function Reader({
  bookId,
  targetParagraph,
  targetNoteId,
  targetTextOffset,
  targetTranslation,
  returnTo = '/library',
}: {
  bookId?: string;
  targetParagraph?: string;
  targetNoteId?: string;
  targetTextOffset?: number;
  targetTranslation?: TranslationSearchTarget;
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
  const returnLabel = returnTo.startsWith('/search')
    ? t('搜索')
    : returnTo.startsWith('/notes')
      ? t('笔记')
      : returnTo.startsWith('/books')
        ? t('书籍详情')
        : returnTo === '/'
          ? t('阅读首页')
          : t('书架');
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [book, setBook] = useState<Book>(sampleBook);
  const [pdfPages, setPdfPages] = useState(false);
  const chapterContents = useMemo(() => bookContents(book), [book]);
  const pageContents = useMemo(() => bookContents(book, { pdfPages: true }), [book]);
  const hasPdfContents =
    isPdfBook(book) &&
    (chapterContents.length !== pageContents.length ||
      chapterContents.some(
        (item, index) =>
          item.title !== pageContents[index]?.title ||
          item.paragraphId !== pageContents[index]?.paragraphId,
      ));
  const contents = hasPdfContents && pdfPages ? pageContents : chapterContents;
  useEffect(() => setPdfPages(false), [book.id]);
  const [position, setPosition] = useState<Position>(emptyPosition);
  const [notes, setNotes] = useState<Note[]>([]);
  const [bookmarks, setBookmarks] = useState<ReadingBookmark[]>([]);
  const bookmarkMutation = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(loadSettings);
  const [revealed, setRevealed] = useState<RevealedTranslation | null>(null);
  const noteRequest = useRef(0);
  const [temporaryOriginal, setTemporaryOriginal] = useState<OriginalReadingOverride | null>(null);
  useEffect(() => {
    setTemporaryOriginal((current) =>
      current &&
      (current.bookId !== book.id ||
        current.language !== settings.language ||
        current.readingMode !== settings.readingMode)
        ? null
        : current,
    );
  }, [book.id, settings.language, settings.readingMode]);
  const [aiConnection, setAIConnection] = useState<AIConnection | null>(null);
  const hasServerKey = hasMatchingServerKey(settings.baseUrl, aiConnection);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const surfaceReady =
    ready && !missing && !loadFailed && !switching && (!bookId || book.id === bookId);
  const [tool, setTool] = useState<ReaderTool | null>(null);
  const [illustration, setIllustration] = useState<Illustration | null>(null);
  const illustrations = useMemo(() => {
    const assets = new Map(book.media?.assets.map((asset) => [asset.id, asset]));
    const result = new Map<string, { before: Illustration[]; after: Illustration[] }>();
    for (const placement of book.media?.placements || []) {
      const asset = assets.get(placement.assetId);
      if (!asset) continue;
      const group = result.get(placement.paragraphId) || { before: [], after: [] };
      group[placement.position].push({ asset, placement });
      result.set(placement.paragraphId, group);
    }
    return result;
  }, [book.media]);
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
  const [referenceHistory, setReferenceHistory] = useState<ReferenceReturn[]>([]);
  const referenceHistoryRef = useRef<ReferenceReturn[]>([]);
  const referenceReturn = referenceHistory.at(-1) || null;
  const [searchOrigin, setSearchOrigin] = useState<SearchReturn | null>(null);
  const searchOriginRef = useRef<SearchReturn | null>(null);
  const [referenceSession, setReferenceSession] = useState(false);
  const [referencePreview, setReferencePreview] = useState<{
    link: BookReferenceLink;
    target: BookReferenceTarget;
    origin: ReferenceReturn;
    opener: HTMLElement | null;
  } | null>(null);
  useEffect(() => setReferencePreview(null), [book.id, book.references?.revision]);
  const jumpAnchor = useRef<ReadingAnchor | null>(null);
  const pendingContentAnchor = useRef<PendingContentAnchor | null>(null);
  const jumpEdge = useRef<'start' | 'end'>('start');
  const jumpGeneration = useRef(0);
  const [jumpRequest, setJumpRequest] = useState(0);
  const scrollIntent = useRef<{ top: number; until: number } | null>(null);
  const pendingPosition = useRef<{ bookId: string; position: Position } | null>(null);
  const [question, setQuestion] = useState('');
  const [search, setSearch] = useState('');
  const [searchSource, setSearchSource] = useState<ReaderSearchSource>('original');
  const [searchTitles, setSearchTitles] = useState(false);
  const [searchLanguage, setSearchLanguage] = useState('');
  const [searchPage, setSearchPage] = useState(0);
  const [searchOpening, setSearchOpening] = useState(false);
  const searchOpeningRef = useRef(false);
  const searchPageTransition = useRef<string | null>(null);
  const searchScroll = useRef(0);
  const restoringSearchScroll = useRef(false);
  const searchList = useRef<HTMLElement | null>(null);
  const [contentsLocateRequest, setContentsLocateRequest] = useState(0);
  const contentsLocateFrame = useRef<number | null>(null);
  const searchJump = useRef<AbortController | null>(null);
  const searchIdentity = useRef('');
  searchIdentity.current = JSON.stringify([
    book.id,
    search,
    searchSource,
    searchLanguage,
    searchPage,
    searchTitles,
  ]);
  const searchResults = useReaderBookSearch({
    book,
    query: search,
    source: searchSource,
    language: searchLanguage,
    page: searchPage,
    enabled: sidebarOpen && ready && !switching && !searchTitles,
  });
  useEffect(() => {
    return () => {
      searchJump.current?.abort();
    };
  }, [book, search, searchSource, searchLanguage, searchPage, sidebarOpen, searchTitles]);
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
  const pdf = isPdfBook(book);
  const chapterNavigation = readingChapterNavigation(book, position);
  const readingTitle = chapterNavigation.current?.title || chapter.title;
  const sourceLanguage = effectiveBookLanguage(book);
  const bookmarkScope = useRef('');
  bookmarkScope.current = JSON.stringify([
    book.id,
    sourceLanguage,
    settings.language,
    settings.readingMode,
  ]);
  const revealedTranslation =
    revealed?.bookId === book.id &&
    revealed.sourceLanguage === sourceLanguage &&
    revealed.preferredLanguage === settings.language &&
    revealed.readingMode === settings.readingMode
      ? revealed
      : null;
  useEffect(() => {
    if (revealed && !revealedTranslation) setRevealed(null);
  }, [revealed, revealedTranslation]);
  const view = revealedTranslation
    ? 'bilingual'
    : sameReadingLanguage(sourceLanguage, settings.language) ||
        (temporaryOriginal?.bookId === book.id &&
          temporaryOriginal.language === settings.language &&
          temporaryOriginal.readingMode === settings.readingMode)
      ? 'original'
      : settings.readingMode;
  const readingIndex = Math.max(
    0,
    chapter.paragraphs.findIndex((p) => p.id === position.paragraph),
  );
  const readingParagraph =
    chapter.paragraphs.slice(readingIndex).find((p) => p.kind !== 'heading') ||
    chapter.paragraphs[readingIndex];
  const aiReady = !needsLogin && canUseAI(settings, aiConnection);
  const legacyTranslations = useMemo(
    () => (book.id === sampleBook.id ? { ...sampleTranslations, ...translations } : translations),
    [book.id, translations],
  );
  const contentScope = JSON.stringify([book.id, settings.language, view]);
  const bookTranslation = useBookTranslation(book, settings, {
    chapter: position.chapter,
    enabled: ready && !missing && !switching,
    legacy: legacyTranslations,
  });
  const paragraphChapters = useMemo(
    () => new Map(book.chapters.flatMap((c, i) => c.paragraphs.map((p) => [p.id, i] as const))),
    [book],
  );
  const normalizeHeading = (text: string) => text.replace(/[\s\p{P}]/gu, '').toLowerCase();
  const allParagraphs = useMemo(() => book.chapters.flatMap((c) => c.paragraphs), [book]);
  const paragraphsById = useMemo(
    () => new Map(allParagraphs.map((paragraph) => [paragraph.id, paragraph])),
    [allParagraphs],
  );
  const referenceTargets = useMemo(
    () => new Map(book.references?.targets.map((target) => [target.id, target])),
    [book.references],
  );
  const referencesByParagraph = useMemo(() => {
    const result = new Map<string, InlineBookReference[]>();
    for (const link of book.references?.links || []) {
      const target = referenceTargets.get(link.targetId);
      if (!target) continue;
      for (const range of link.source) {
        const entries = result.get(range.paragraphId) || [];
        entries.push({
          link,
          start: range.start,
          end: range.end,
          href: `#passage-${target.location?.paragraphId || range.paragraphId}`,
        });
        result.set(range.paragraphId, entries);
      }
    }
    return result;
  }, [book.references, referenceTargets]);
  const paragraphOrder = useMemo(
    () => new Map(allParagraphs.map((paragraph, index) => [paragraph.id, index])),
    [allParagraphs],
  );
  const activeContent = useMemo(() => {
    const current = paragraphOrder.get(position.paragraph) ?? 0;
    let active = -1,
      nearest = -1;
    contents.forEach((item, index) => {
      if (!(hasPdfContents && !pdfPages) && item.chapterId !== book.chapters[position.chapter]?.id)
        return;
      const order = paragraphOrder.get(item.paragraphId) ?? -1;
      if (
        order >= 0 &&
        order <= current &&
        (order > nearest ||
          (order === nearest && (active < 0 || item.depth >= contents[active].depth)))
      ) {
        active = index;
        nearest = order;
      }
    });
    return active;
  }, [
    book.chapters,
    contents,
    paragraphOrder,
    position.chapter,
    position.paragraph,
    hasPdfContents,
    pdfPages,
  ]);
  const contentsOutline = useMemo(
    () =>
      createContentsOutline(
        contents.map((item, index) => ({
          ...item,
          key: JSON.stringify([item.chapterId, item.paragraphId, index]),
        })),
      ),
    [contents],
  );
  const contentsActivation = JSON.stringify([book.id, activation.current]);
  const contentsMode = pdfPages ? 'pages' : 'contents';
  const [contentsFolds, setContentsFolds] = useState<{
    activation: string;
    modes: Partial<
      Record<'pages' | 'contents', { entries: typeof contents; keys: ReadonlySet<string> }>
    >;
  }>({ activation: '', modes: {} });
  const savedContentsFolds =
    contentsFolds.activation === contentsActivation ? contentsFolds.modes[contentsMode] : undefined;
  const collapsedContents =
    savedContentsFolds?.entries === contents ? savedContentsFolds.keys : undefined;
  const setCollapsedContents = useCallback(
    (change: (keys: ReadonlySet<string>) => ReadonlySet<string>) => {
      setContentsFolds((previous) => {
        const modes = previous.activation === contentsActivation ? previous.modes : {};
        const saved = modes[contentsMode];
        const keys = saved?.entries === contents ? saved.keys : new Set<string>();
        const next = change(keys);
        if (next === keys && saved?.entries === contents) return previous;
        return {
          activation: contentsActivation,
          modes: { ...modes, [contentsMode]: { entries: contents, keys: next } },
        };
      });
    },
    [contentsActivation, contentsMode, contents],
  );
  const activeContentKey = contentsOutline.nodes[activeContent]?.key;
  const contentsProjection = useMemo(
    () =>
      visibleContentsOutline(contentsOutline, {
        collapsedKeys: collapsedContents,
        query: searchTitles ? search : '',
        activeKey: activeContentKey,
      }),
    [contentsOutline, collapsedContents, searchTitles, search, activeContentKey],
  );
  const hierarchicalContents =
    !(pdf && (!hasPdfContents || pdfPages)) &&
    contentsOutline.nodes.some((node) => node.hasChildren);
  const searchingContents = searchTitles ? contentsProjection.searching : !!search.trim();
  const visibleActiveContent = contentsProjection.rows.reduce(
    (active, row) => (row.isActive || row.isActiveAncestor ? row.index : active),
    -1,
  );
  const contentsLocateIdentity = JSON.stringify([
    contentsActivation,
    sidebarOpen,
    search.trim(),
    visibleActiveContent,
    pdfPages,
    surfaceReady,
    contentsLocateRequest,
  ]);
  const contentsLocateState = useRef({ identity: '', enabled: false, active: -1 });
  contentsLocateState.current = {
    identity: contentsLocateIdentity,
    enabled: sidebarOpen && !search.trim() && surfaceReady && activeContent >= 0,
    active: visibleActiveContent,
  };
  const locateContents = useCallback(() => {
    if (contentsLocateFrame.current !== null) cancelAnimationFrame(contentsLocateFrame.current);
    contentsLocateFrame.current = null;
    const request = contentsLocateState.current;
    if (!request.enabled) return;
    contentsLocateFrame.current = requestAnimationFrame(() => {
      contentsLocateFrame.current = null;
      if (contentsLocateState.current.identity !== request.identity) return;
      const list = searchList.current;
      const item = list?.querySelector<HTMLElement>(
        `[data-reader-content-index="${request.active}"]`,
      );
      if (!list?.isConnected || !item || !list.clientHeight) return;
      // The positioned nav is the rows' offset parent. These coordinates are
      // independent of dialog animations, and only this scroll container moves.
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top >= list.scrollTop + 12 && bottom <= list.scrollTop + list.clientHeight - 12) return;
      list.scrollTop = Math.max(0, top - Math.max(0, (list.clientHeight - item.offsetHeight) / 2));
    });
  }, []);
  const attachContentsList = useCallback(
    (element: HTMLElement | null) => {
      searchList.current = element;
      if (element) locateContents();
    },
    [locateContents],
  );
  useEffect(() => {
    locateContents();
    return () => {
      if (contentsLocateFrame.current !== null) cancelAnimationFrame(contentsLocateFrame.current);
      contentsLocateFrame.current = null;
    };
  }, [contentsLocateIdentity, locateContents]);
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
    settings: { ...settings, readingMode: view },
    chapterIndex: position.chapter,
    translations,
    contentRevision: bookTranslation.revision,
    version: bookTranslation.version,
    getTranslation,
    getKey: (p) => bookTranslation.key(paragraphChapters.get(p.id) ?? 0, p.id),
    fallbackAnchor: jumpAnchor.current || position,
    contentScope,
    pendingContentAnchor,
    root: readerRef,
    surfaceReady,
  });
  const navigation = useReadingNavigation({
    root: readerRef,
    surfaceReady,
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
      view,
      settings.scrollFlow,
      settings.language,
      bookTranslation.version,
      stableTranslations.revision,
      book.media?.revision,
      book.references?.revision,
      revealedTranslation?.key,
    ].join(':'),
    enabled: ready && !missing && !switching && !jump,
    blocked: Boolean(tool || selectionMenu || illustration || referencePreview),
    onChapter: toChapter,
  });
  useEffect(() => {
    if (pendingContentAnchor.current?.scope !== contentScope) pendingContentAnchor.current = null;
  }, [contentScope]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        !surfaceReady ||
        tool ||
        illustration ||
        referencePreview ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        target?.closest('button,a,input,textarea,select,[contenteditable="true"]') ||
        (target && target !== document.body && !readerRef.current?.contains(target)) ||
        window.getSelection()?.toString().trim()
      )
        return;
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key)
      )
        markScrollIntent();
    };
    // The navigation hook also handles keys targeted at document.body.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const progress =
    position.chapter === book.chapters.length - 1 && navigation.atEnd
      ? 100
      : Math.min(99, Math.round(readingProgress(book.chapters, position) * 100));

  function openTool(next: ReaderTool | null) {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tool === 'contents' && next !== 'contents') {
      cancelSearchJump();
      if (search.trim() && searchList.current) searchScroll.current = searchList.current.scrollTop;
    }
    if (tool === 'bookmarks' && next !== 'bookmarks') noteRequest.current++;
    parentTool.current = null;
    setSelectionMenu(null);
    setTool(next);
  }
  function navigateChapter(target: ReadingChapterTarget) {
    if (!ready || switching || navigation.turning) return;
    navigate(target.paragraphId, false);
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
  function advanceJumpRequest() {
    // The ref invalidates in-flight callbacks immediately; state also schedules
    // a new effect when the requested paragraph is unchanged.
    abandonPendingContentAnchor();
    setJumpRequest(++jumpGeneration.current);
  }
  async function activate(next: Book) {
    const readingSettings = withBookLanguage(next.id, settings);
    const measured = measureClient('reader_ready');
    const token = ++activation.current;
    advanceJumpRequest();
    noteRequest.current++;
    searchJump.current?.abort();
    setReferencePreview(null);
    replaceReferenceHistory([]);
    replaceSearchOrigin(null);
    setReferenceSession(false);
    jumpEdge.current = 'start';
    scrollIntent.current = null;
    operation.current?.abort();
    operation.current = null;
    setBusy(null);
    setBusyText('');
    setReady(false);
    setMissing(false);
    setLoadFailed(false);
    setSwitching(true);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    try {
      const [savedPosition, savedNotes, savedMessages, savedTranslations, savedBookmarks] =
        await Promise.all([
          storage.readingPosition(next.id),
          storage.notes(next.id),
          storage.chat(next.id),
          storage.translations(next.id),
          storage.bookmarks(next.id),
        ]);
      if (token !== activation.current) return;
      const targetNote = savedNotes.find(
        (note) => note.id === targetNoteId && note.bookId === next.id,
      );
      const noteTranslation = targetNote
        ? await savedNoteTranslation(
            next,
            targetNote,
            next.id === sampleBook.id
              ? { ...sampleTranslations, ...savedTranslations }
              : savedTranslations,
            readingSettings,
          )
        : null;
      if (token !== activation.current) return;
      const destination = targetNote?.paragraphId || targetParagraph;
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
      const targetChapter = destination
        ? next.chapters.findIndex((c) => c.paragraphs.some((p) => p.id === destination))
        : -1;
      const targetText =
        targetChapter >= 0
          ? next.chapters[targetChapter].paragraphs.find((p) => p.id === destination)?.text
          : undefined;
      const translationSearchRequested = !targetNote && !!targetTranslation;
      const searchController = new AbortController();
      searchJump.current = searchController;
      const searchTranslation =
        translationSearchRequested && targetChapter >= 0 && destination
          ? await savedSearchTranslation(
              next,
              destination,
              targetTextOffset,
              targetTranslation!,
              readingSettings,
              searchController.signal,
            ).catch(() => null)
          : null;
      if (token !== activation.current || searchController.signal.aborted) return;
      const exactSearch =
        !targetNote &&
        !translationSearchRequested &&
        targetText !== undefined &&
        typeof targetTextOffset === 'number' &&
        Number.isSafeInteger(targetTextOffset) &&
        targetTextOffset >= 0 &&
        targetTextOffset < targetText.length;
      if (targetChapter >= 0 && destination) {
        safePosition.chapter = targetChapter;
        safePosition.paragraph = destination;
        safePosition.farthest = Math.max(safePosition.farthest, targetChapter);
        safePosition.offset = 0;
        safePosition.textOffset = 0;
        safePosition.textQuote = undefined;
        safePosition.textSource = 'original';
        if (targetNote?.anchor && (targetNote.anchor.source === 'original' || noteTranslation)) {
          safePosition.textOffset = targetNote.anchor.start;
          safePosition.textQuote = targetNote.quote;
          safePosition.textSource = targetNote.anchor.source;
        } else if (searchTranslation) {
          safePosition.textOffset = searchTranslation.start;
          safePosition.textQuote = searchTranslation.quote;
          safePosition.textSource = 'translation';
          safePosition.offset = searchTranslation.start / searchTranslation.translation.text.length;
        } else if (exactSearch) {
          safePosition.textOffset = targetTextOffset;
          safePosition.textQuote = targetText!.slice(targetTextOffset, targetTextOffset + 32);
          safePosition.offset = targetTextOffset / targetText!.length;
        }
      }
      jumpAnchor.current = safePosition;
      setSettings((current) => ({
        ...current,
        readingMode: readingSettings.readingMode,
        language: readingSettings.language,
      }));
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
      setRevealed(noteTranslation || searchTranslation?.translation || null);
      setReferenceSession(!!targetNote || exactSearch || translationSearchRequested);
      if ((exactSearch || translationSearchRequested) && destination) setJumpHighlight(destination);
      if (translationSearchRequested && !searchTranslation)
        setNotice(
          locale.startsWith('zh')
            ? '这处译文未保存在本机或内容已变化，已回到原文。'
            : 'This saved translation is missing or has changed. The original is shown instead.',
        );
      if (targetNote?.anchor?.source === 'translation' && !noteTranslation)
        setNotice(t('这条笔记的译文尚未保存在本机，已定位到原文。'));
      setTemporaryOriginal(
        (targetNote && !noteTranslation) || exactSearch || translationSearchRequested
          ? {
              bookId: next.id,
              language: readingSettings.language,
              readingMode: readingSettings.readingMode,
            }
          : null,
      );
      measured();
      setScrollRange({
        bookId: next.id,
        start: Math.max(0, safePosition.chapter - 1),
        end: Math.min(next.chapters.length - 1, safePosition.chapter + 1),
      });
      setPosition(safePosition);
      setNotes(savedNotes);
      setBookmarks(savedBookmarks);
      setMessages(savedMessages);
      setTranslations(savedTranslations);
      setSelected(null);
      setDraftSelection(null);
      setNoteDraft('');
      setSearch('');
      setSearchSource('original');
      setSearchTitles(false);
      setSearchLanguage('');
      setSearchPage(0);
      cancelSearchJump();
      searchPageTransition.current = null;
      searchScroll.current = 0;
      restoringSearchScroll.current = false;
      setQuestion('');
      setBusy(null);
      setJump(safePosition.paragraph);
      try {
        localStorage.setItem(storageKey('ai-read-active'), next.id);
        updateLibraryBooks([next.id], { lastOpenedAt: Date.now() });
      } catch {
        /* Reading remains available if preferences cannot be stored. */
      }
      setReady(true);
    } catch (error) {
      if (token === activation.current) {
        report(error);
        setLoadFailed(true);
      }
    } finally {
      if (token === activation.current) {
        setSwitching(false);
      }
    }
  }

  useEffect(() => {
    let alive = true;
    setReady(false);
    setMissing(false);
    setLoadFailed(false);
    setNotice('');
    void (async () => {
      try {
        const stored = await storage.books();
        const list = [
          stored.find((book) => book.id === sampleBook.id) || sampleBook,
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
          setLoadFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
      activation.current++;
      searchJump.current?.abort();
      operation.current?.abort();
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
  }, [bookId, loadAttempt]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void readAIConnection()
        .then((config) => {
          if (!alive) return;
          setAIConnection(config);
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
      setAIConnection(config);
      setSettings((s) => applyAIConnection(s, config));
    };
    refresh();
    window.addEventListener('ai-read-ai-configuration-change', configurationChanged);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('ai-read-refresh-connection', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('ai-read-refresh-connection', refresh);
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
    const update = () => setSettings(withBookLanguage(book.id, loadSettings()));
    const storageChanged = (event: StorageEvent) => {
      if (
        event.key === storageKey('ai-read-settings') ||
        event.key === storageKey('ai-read-book-language')
      )
        update();
    };
    window.addEventListener('ai-read-preferences-change', update);
    window.addEventListener('storage', storageChanged);
    return () => {
      window.removeEventListener('ai-read-preferences-change', update);
      window.removeEventListener('storage', storageChanged);
    };
  }, [book.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--page-width', `${settings.pageWidth}px`);
    try {
      const defaults = loadSettings();
      saveSettings({ ...settings, readingMode: defaults.readingMode, language: defaults.language });
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
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      void Promise.all([
        storage.notes(book.id),
        storage.chat(book.id),
        storage.translations(book.id),
        getSyncEntry('book', book.id, book.id),
        storage.books(),
        storage.bookmarks(book.id),
      ])
        .then(([nextNotes, nextChat, nextTranslations, meta, books, nextBookmarks]) => {
          if (!alive || request !== revision) return;
          const latestBook = books.find((item) => item.id === book.id);
          if (latestBook)
            setBook((current) =>
              current.sourceLanguage === latestBook.sourceLanguage &&
              current.references?.revision === latestBook.references?.revision
                ? current
                : {
                    ...current,
                    sourceLanguage: latestBook.sourceLanguage,
                    references: latestBook.references,
                  },
            );
          setNotes((old) => (sameData(old, nextNotes) ? old : nextNotes));
          setBookmarks((old) => (sameData(old, nextBookmarks) ? old : nextBookmarks));
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
    if (!jump || !ready || switching) return;
    const generation = jumpRequest;
    restoring.current = true;
    const frame = requestAnimationFrame(() => {
      if (generation !== jumpGeneration.current) return;
      scrollIntent.current = null;
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
        } else {
          const anchor = jumpAnchor.current || { paragraph: jump, offset: 0 };
          pendingContentAnchor.current =
            view === 'translation' && !hasReadableTranslation(root, anchor.paragraph)
              ? { scope: contentScope, anchor }
              : null;
          restoreReadingAnchor(root, anchor);
        }
        navigation.refresh();
      }
      jumpAnchor.current = null;
      jumpEdge.current = 'start';
      setJump(null);
      requestAnimationFrame(() => {
        if (generation !== jumpGeneration.current) return;
        restoring.current = false;
        saveScroll();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    jump,
    jumpRequest,
    chapter.id,
    book.id,
    view,
    contentScope,
    stableTranslations.revision,
    ready,
    switching,
  ]);
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
      if (illustration) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.isComposing) {
        e.preventDefault();
        setSearchOpen(true);
        setSidebarOpen(true);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [illustration]);

  useEffect(() => {
    if (tool || illustration || referencePreview) return;
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
  }, [tool, illustration, referencePreview, chapter, selected?.paragraph.id, selected?.text]);

  useLayoutEffect(() => {
    const anchor = layoutAnchor.current;
    const root = readerRef.current;
    if (!anchor || !root) return;
    if (view === 'translation' && !hasReadableTranslation(root, anchor.paragraph))
      pendingContentAnchor.current = { scope: contentScope, anchor };
    restoreReadingAnchor(root, anchor);
    layoutAnchor.current = null;
  }, [
    settings.fontSize,
    settings.fontFamily,
    settings.lineHeight,
    settings.pageWidth,
    settings.pageMargin,
    view,
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
    scrollIntent.current = null;
    layoutAnchor.current =
      jumpAnchor.current ||
      (pendingContentAnchor.current?.scope === contentScope
        ? pendingContentAnchor.current.anchor
        : null) ||
      (root ? readReadingAnchor(root) : null);
    if (patch.readingMode !== undefined || patch.language !== undefined) {
      pendingContentAnchor.current = null;
      setTemporaryOriginal(null);
      setRevealed(null);
      setReferenceSession(false);
      noteRequest.current++;
      try {
        const preferences = JSON.parse(
          localStorage.getItem(storageKey('ai-read-book-language')) || '{}',
        );
        const next = { ...settings, ...patch };
        preferences[book.id] = { readingMode: next.readingMode, language: next.language };
        localStorage.setItem(storageKey('ai-read-book-language'), JSON.stringify(preferences));
      } catch {
        setNotice(t('偏好设置无法保存到浏览器。'));
      }
    }
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

  function validReferenceReturn(snapshot: ReferenceReturn) {
    return (
      snapshot.bookId === book.id &&
      snapshot.activation === activation.current &&
      paragraphsById.has(snapshot.anchor.paragraph)
    );
  }
  function replaceReferenceHistory(history: ReferenceReturn[]) {
    const next = history.slice(-MAX_REFERENCE_RETURNS);
    referenceHistoryRef.current = next;
    setReferenceHistory(next);
  }
  function replaceSearchOrigin(next: SearchReturn | null) {
    searchOriginRef.current = next;
    setSearchOrigin(next);
  }
  function captureReferenceReturn(panel: 'chat' | 'notes' | null = null): ReferenceReturn {
    const anchor: ReadingAnchor = {
      ...(jumpAnchor.current ||
        (readerRef.current && readReadingAnchor(readerRef.current)) ||
        position),
    };
    let translationKey: string | undefined;
    if (anchor.textSource === 'translation') {
      const paragraph = paragraphsById.get(anchor.paragraph);
      const index = paragraphChapters.get(anchor.paragraph);
      if (paragraph && index !== undefined) {
        const passage =
          readerRef.current &&
          Array.from(readerRef.current.querySelectorAll<HTMLElement>('[data-paragraph]')).find(
            (node) => node.dataset.paragraph === anchor.paragraph,
          );
        const element = passage?.querySelector<HTMLElement>('[data-note-source="translation"]');
        const reveal = revealedTranslation?.paragraph === paragraph.id ? revealedTranslation : null;
        const text =
          element?.textContent || reveal?.text || stableTranslations.read(index, paragraph);
        translationKey =
          element?.dataset.noteKey ||
          reveal?.key ||
          stableTranslations.key(index, paragraph) ||
          undefined;
        const offset = anchor.textOffset ?? Math.floor((anchor.offset || 0) * text.length);
        if (Number.isSafeInteger(offset) && offset >= 0 && offset < text.length) {
          anchor.textOffset = offset;
          anchor.textQuote = safeReadingQuote(text, offset);
        } else translationKey = undefined;
      }
    }
    return {
      bookId: book.id,
      activation: activation.current,
      context: JSON.stringify([bookmarkScope.current, bookTranslation.version]),
      anchor,
      translationKey,
      mode: settings.navigationMode,
      panel,
      selection: selected,
      translation: revealedTranslation,
      original: temporaryOriginal,
    };
  }
  function pushReferenceReturn(snapshot: ReferenceReturn) {
    if (!validReferenceReturn(snapshot)) return;
    replaceReferenceHistory([
      ...referenceHistoryRef.current.filter(validReferenceReturn),
      snapshot,
    ]);
  }
  function followReference(id: string, source: 'chat' | 'notes') {
    if (!paragraphsById.has(id)) return;
    pushReferenceReturn(captureReferenceReturn(source));
    navigate(id, false);
    if (source === 'chat') {
      setReferenceSession(true);
      setTemporaryOriginal({
        bookId: book.id,
        language: settings.language,
        readingMode: settings.readingMode,
      });
    }
    openTool(null);
  }

  function cancelSearchJump() {
    searchJump.current?.abort();
    searchJump.current = null;
    searchOpeningRef.current = false;
    setSearchOpening(false);
  }

  function changeSearchCriteria(change: {
    query?: string;
    source?: ReaderSearchSource;
    language?: string;
    titles?: boolean;
  }) {
    if (searchOpeningRef.current) return;
    cancelSearchJump();
    searchPageTransition.current = null;
    searchScroll.current = 0;
    restoringSearchScroll.current = false;
    setSearchPage(0);
    if (change.query !== undefined) setSearch(change.query);
    if (change.source !== undefined) {
      setSearchSource(change.source);
      setSearchTitles(false);
    }
    if (change.titles !== undefined) setSearchTitles(change.titles);
    if (change.language !== undefined) setSearchLanguage(change.language);
  }

  function changeSearchPage(page: number) {
    if (
      searchOpeningRef.current ||
      searchResults.loading ||
      searchPageTransition.current === searchIdentity.current ||
      !Number.isSafeInteger(page) ||
      page < 0 ||
      Math.abs(page - searchPage) !== 1 ||
      (page > searchPage && !searchResults.data?.limited)
    )
      return;
    // Lock this rendered page synchronously, before React can disable its controls.
    searchPageTransition.current = searchIdentity.current;
    cancelSearchJump();
    searchScroll.current = 0;
    restoringSearchScroll.current = false;
    searchList.current?.scrollTo({ top: 0 });
    setSearchPage(page);
  }

  async function followSearchMatch(match: PassageMatch) {
    const paragraph = paragraphsById.get(match.paragraphId);
    const index = paragraphChapters.get(match.paragraphId);
    if (
      !paragraph ||
      searchTitles ||
      index === undefined ||
      match.bookId !== book.id ||
      match.chapterIndex !== index ||
      !ready ||
      switching ||
      navigation.turning ||
      searchOpeningRef.current ||
      searchResults.loading ||
      searchPageTransition.current === searchIdentity.current
    )
      return;
    const request = ++noteRequest.current;
    const token = activation.current;
    const scope = bookmarkScope.current;
    const identity = searchIdentity.current;
    searchJump.current?.abort();
    const controller = new AbortController();
    searchJump.current = controller;
    searchOpeningRef.current = true;
    setSearchOpening(true);
    try {
      const previous = searchOriginRef.current;
      const origin: SearchReturn = {
        origin:
          previous && validReferenceReturn(previous.origin)
            ? previous.origin
            : captureReferenceReturn(),
        history:
          previous && validReferenceReturn(previous.origin)
            ? previous.history
            : [...referenceHistoryRef.current],
        results: {
          query: search,
          source: searchSource,
          language: searchLanguage,
          page: searchPage,
          scrollTop: searchList.current?.scrollTop || 0,
        },
      };
      const translated = match.source === 'translation';
      const found =
        translated && match.language && match.translationKey && match.textHash
          ? await savedSearchTranslation(
              book,
              paragraph.id,
              match.sourceStart,
              {
                language: match.language,
                translationKey: match.translationKey,
                textHash: match.textHash,
                sourceEnd: match.sourceEnd,
              },
              settings,
              controller.signal,
            ).catch(() => null)
          : null;
      if (
        controller.signal.aborted ||
        request !== noteRequest.current ||
        token !== activation.current ||
        scope !== bookmarkScope.current ||
        identity !== searchIdentity.current
      )
        return;
      const text = found?.translation.text || paragraph.text;
      const textOffset = translated ? found?.start || 0 : match.sourceStart;
      if (!Number.isSafeInteger(textOffset) || textOffset < 0 || textOffset >= text.length) return;
      navigate(paragraph.id, false);
      replaceReferenceHistory([]);
      replaceSearchOrigin(origin);
      setJumpHighlight(paragraph.id);
      setReferenceSession(true);
      setRevealed(found?.translation || null);
      setTemporaryOriginal({
        bookId: book.id,
        language: settings.language,
        readingMode: settings.readingMode,
      });
      const anchor: ReadingAnchor = {
        chapter: index,
        paragraph: paragraph.id,
        textSource: found ? 'translation' : 'original',
        textOffset,
        textQuote: safeReadingQuote(text, textOffset),
        offset: textOffset / text.length,
      };
      layoutAnchor.current = null;
      jumpAnchor.current = anchor;
      setPosition((current) => ({ ...current, ...anchor }));
      if (translated && !found)
        setNotice(
          locale.startsWith('zh')
            ? '这处译文未保存在本机或内容已变化，已回到原文。'
            : 'This saved translation is missing or has changed. The original is shown instead.',
        );
    } finally {
      if (searchJump.current === controller) {
        searchJump.current = null;
        searchOpeningRef.current = false;
        setSearchOpening(false);
      }
    }
  }

  function returnToSearchResults() {
    const origin = searchOriginRef.current;
    if (!origin || !validReferenceReturn(origin.origin)) return;
    const previous = origin.results;
    cancelSearchJump();
    searchPageTransition.current = null;
    setSearch(previous.query);
    setSearchTitles(false);
    setSearchSource(previous.source);
    setSearchLanguage(previous.language);
    setSearchPage(previous.page);
    searchScroll.current = previous.scrollTop;
    restoringSearchScroll.current = true;
    setSearchOpen(true);
    openTool('contents');
  }

  function visitBookReference(target: BookReferenceTarget, origin: ReferenceReturn) {
    const location = target.location;
    if (
      !location ||
      !validReferenceReturn(origin) ||
      referenceTargets.get(target.id) !== target ||
      restoring.current ||
      !ready ||
      missing ||
      switching ||
      !paragraphsById.has(location.paragraphId)
    )
      return;
    const index = paragraphChapters.get(location.paragraphId);
    if (index === undefined) return;
    const text = paragraphsById.get(location.paragraphId)!.text;
    pushReferenceReturn(origin);
    navigate(location.paragraphId, false);
    setReferenceSession(true);
    jumpAnchor.current = {
      chapter: index,
      paragraph: location.paragraphId,
      offset: 0,
      textOffset: location.offset,
      textSource: 'original',
      textQuote: safeReadingQuote(text, location.offset),
    };
    layoutAnchor.current = null;
    setPosition((previous) => ({
      ...previous,
      textOffset: location.offset,
      textSource: 'original',
      textQuote: safeReadingQuote(text, location.offset),
    }));
    // Source offsets belong to the original. Reveal it temporarily without
    // changing preferences, selecting an edition, or preparing new translations.
    setTemporaryOriginal({
      bookId: book.id,
      language: settings.language,
      readingMode: settings.readingMode,
    });
    openTool(null);
  }

  function openBookReference(link: BookReferenceLink, opener: HTMLElement) {
    if (
      navigation.suppressClick ||
      navigation.turning ||
      restoring.current ||
      !ready ||
      switching ||
      window.getSelection()?.toString().trim()
    )
      return;
    const target = referenceTargets.get(link.targetId);
    if (!target) return;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    noteRequest.current++;
    setSelectionMenu(null);
    setReferenceSession(true);
    const previous = referenceHistoryRef.current.at(-1);
    if (
      link.kind === 'backlink' &&
      previous &&
      validReferenceReturn(previous) &&
      !!target.location &&
      (target.location.paragraphId === previous.anchor.paragraph ||
        previous.referenceSources?.includes(target.location.paragraphId))
    ) {
      returnFromReference();
      return;
    }
    const origin = {
      ...captureReferenceReturn(),
      referenceSources: link.source.map((range) => range.paragraphId),
    };
    if (link.kind === 'footnote' || !target.location)
      setReferencePreview({ link, target, origin, opener });
    else visitBookReference(target, origin);
  }

  async function addCurrentBookmark() {
    if (bookmarkMutation.current) return;
    const root = readerRef.current;
    const anchor =
      root && ready && !switching && !restoring.current && !navigation.turning
        ? readReadingAnchor(root)
        : null;
    const index = anchor && paragraphChapters.get(anchor.paragraph);
    const paragraph = anchor && paragraphsById.get(anchor.paragraph);
    const source = anchor?.textSource || 'original';
    const passage =
      anchor &&
      root &&
      Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]')).find(
        (element) => element.dataset.paragraph === anchor.paragraph,
      );
    const textElement = passage?.querySelector<HTMLElement>(`[data-note-source="${source}"]`);
    const text = textElement?.textContent;
    if (!anchor || index == null || !paragraph || !textElement || !text)
      throw new Error(t('当前位置暂无可保存的正文。'));
    const textOffset = anchor.textOffset ?? 0;
    const translationKey = source === 'translation' ? textElement.dataset.noteKey : undefined;
    if (textOffset > text.length || (source === 'translation' && !translationKey))
      throw new Error(t('当前位置暂无可保存的正文。'));
    const bookmark = validateBookmark(book, {
      id: crypto.randomUUID(),
      bookId: book.id,
      position: {
        chapter: index,
        paragraph: paragraph.id,
        farthest: Math.max(position.farthest, index),
        offset: source === 'original' ? textOffset / Math.max(1, paragraph.text.length) : 0,
        textSource: source,
        textOffset,
        textQuote: text.slice(textOffset, textOffset + 32),
      },
      quote: text.slice(textOffset, textOffset + 280),
      label: '',
      ...(translationKey ? { translationKey } : {}),
      createdAt: Date.now(),
    });
    const token = activation.current;
    bookmarkMutation.current = true;
    try {
      const next = await storage.addBookmark(bookmark);
      if (token !== activation.current) return;
      setBookmarks(next);
      const saved = next.find(
        (item) => bookmarkLocationKey(item) === bookmarkLocationKey(bookmark),
      );
      setNotice(t(saved?.id === bookmark.id ? '书签已添加。' : '这个位置已有书签。'));
    } finally {
      bookmarkMutation.current = false;
    }
  }

  async function changeBookmark(bookmark: ReadingBookmark, label: string | null) {
    if (bookmarkMutation.current) return;
    const token = activation.current;
    bookmarkMutation.current = true;
    try {
      await storage.modifyBookmark(
        book.id,
        bookmark.id,
        label === null ? null : { label },
        bookmark,
      );
      const next = await storage.bookmarks(book.id);
      if (token !== activation.current) return;
      setBookmarks(next);
      setNotice(t(label === null ? '书签已删除。' : '书签已更新。'));
    } finally {
      bookmarkMutation.current = false;
    }
  }

  async function followBookmark(value: ReadingBookmark) {
    const bookmark = validateBookmark(book, value);
    const request = ++noteRequest.current;
    const token = activation.current;
    const scope = bookmarkScope.current;
    const origin = captureReferenceReturn();
    let translation =
      bookmark.position.textSource === 'translation'
        ? await savedPassageTranslation(
            book,
            bookmark.position.paragraph,
            bookmark.translationKey,
            legacyTranslations,
            settings,
          )
        : null;
    if (
      request !== noteRequest.current ||
      token !== activation.current ||
      scope !== bookmarkScope.current
    )
      return;
    let textOffset = bookmark.position.textOffset ?? 0;
    const quote = bookmark.position.textQuote;
    if (translation) {
      if (quote && translation.text.slice(textOffset, textOffset + quote.length) !== quote) {
        const found = translation.text.indexOf(quote);
        if (found >= 0 && translation.text.indexOf(quote, found + 1) < 0) textOffset = found;
        else translation = null;
      } else if (textOffset > translation.text.length) translation = null;
    }
    const fallback = bookmark.position.textSource === 'translation' && !translation;
    const paragraph = paragraphsById.get(bookmark.position.paragraph)!;
    const target: ReadingAnchor = fallback
      ? {
          chapter: bookmark.position.chapter,
          paragraph: paragraph.id,
          textSource: 'original',
          textOffset: 0,
          textQuote: paragraph.text.slice(0, 32),
          offset: 0,
        }
      : { ...bookmark.position, textOffset };
    navigate(paragraph.id, false);
    pushReferenceReturn(origin);
    setJumpHighlight(paragraph.id);
    // Commit the jump and disable automatic translation in the same render.
    setReferenceSession(true);
    setRevealed(translation);
    // Original bookmarks also bypass an unprepared translated chapter.
    setTemporaryOriginal({
      bookId: book.id,
      language: settings.language,
      readingMode: settings.readingMode,
    });
    layoutAnchor.current = null;
    jumpAnchor.current = target;
    setPosition((current) => ({
      ...current,
      chapter: bookmark.position.chapter,
      paragraph: target.paragraph,
      offset: target.offset,
      textSource: target.textSource,
      textOffset: target.textOffset,
      textQuote: target.textQuote,
    }));
    if (fallback) setNotice(t('书签的译文未保存在本机或已变化，已定位到原文。'));
  }

  async function followNote(note: Note) {
    const request = ++noteRequest.current;
    const token = activation.current;
    try {
      const translation = await savedNoteTranslation(book, note, legacyTranslations, settings);
      if (request !== noteRequest.current || token !== activation.current) return;
      followReference(note.paragraphId, 'notes');
      setRevealed(translation);
      if (note.anchor && (note.anchor.source === 'original' || translation)) {
        jumpAnchor.current = {
          paragraph: note.paragraphId,
          offset: 0,
          chapter: paragraphChapters.get(note.paragraphId),
          textOffset: note.anchor.start,
          textQuote: note.quote,
          textSource: note.anchor.source,
        };
      }
      if (note.anchor?.source === 'translation' && !translation) {
        setTemporaryOriginal({
          bookId: book.id,
          language: settings.language,
          readingMode: settings.readingMode,
        });
        setNotice(t('这条笔记的译文尚未保存在本机，已定位到原文。'));
      }
    } catch (error) {
      report(error);
    }
  }

  function restoreReference(snapshot: ReferenceReturn) {
    if (!surfaceReady || navigation.turning || restoring.current || !validReferenceReturn(snapshot))
      return false;
    const paragraph = paragraphsById.get(snapshot.anchor.paragraph)!;
    const index = paragraphChapters.get(paragraph.id)!;
    const sameContext =
      snapshot.context === JSON.stringify([bookmarkScope.current, bookTranslation.version]);
    let verifiedTranslation = false;
    if (sameContext && snapshot.anchor.textSource === 'translation' && snapshot.translationKey) {
      const reveal = snapshot.translation?.paragraph === paragraph.id ? snapshot.translation : null;
      // Published chapters outside the nearby cache window can still have a
      // stable rendered snapshot. Legacy/exact choices must use the current
      // per-paragraph key, not the controller's generic "legacy" version label.
      const key =
        reveal?.key ||
        bookTranslation.key(index, paragraph.id) ||
        (bookTranslation.version !== 'legacy' ? stableTranslations.key(index, paragraph) : '');
      const text =
        reveal?.text ||
        bookTranslation.text(index, paragraph.id) ||
        (bookTranslation.version !== 'legacy' ? stableTranslations.read(index, paragraph) : '');
      const offset = snapshot.anchor.textOffset;
      const quote = snapshot.anchor.textQuote;
      verifiedTranslation =
        key === snapshot.translationKey &&
        Number.isSafeInteger(offset) &&
        offset! >= 0 &&
        !!quote &&
        text.slice(offset, offset! + quote.length) === quote;
    }
    const translationFallback =
      snapshot.anchor.textSource === 'translation' && (!sameContext || !verifiedTranslation);
    const anchor: ReadingAnchor = translationFallback
      ? {
          chapter: index,
          paragraph: paragraph.id,
          textSource: 'original',
          textOffset: 0,
          offset: 0,
          textQuote: safeReadingQuote(paragraph.text, 0),
        }
      : { ...snapshot.anchor, chapter: index };
    navigate(paragraph.id, false);
    jumpAnchor.current = anchor;
    layoutAnchor.current = null;
    const { visualOffset: _visualOffset, ...positionAnchor } = anchor;
    setPosition((previous) => ({
      ...previous,
      ...positionAnchor,
      chapter: index,
      farthest: Math.max(previous.farthest, index),
    }));
    setSettings((current) => ({ ...current, navigationMode: snapshot.mode }));
    setSelected(sameContext && !translationFallback ? snapshot.selection : null);
    setRevealed(sameContext && !translationFallback ? snapshot.translation : null);
    setTemporaryOriginal(
      !sameContext || translationFallback
        ? { bookId: book.id, language: settings.language, readingMode: settings.readingMode }
        : snapshot.original,
    );
    setReferenceSession(true);
    if (snapshot.panel) openCompanion(snapshot.panel);
    else openTool(null);
    if (translationFallback)
      setNotice(
        locale.startsWith('zh')
          ? '阅读语言或译本已变化，已返回对应原文。'
          : 'The reading language or edition changed. Returned to the original passage.',
      );
    return true;
  }
  function returnFromReference() {
    if (!surfaceReady || navigation.turning) return;
    const history = referenceHistoryRef.current.filter(validReferenceReturn);
    const previous = history.at(-1);
    if (!previous) {
      replaceReferenceHistory([]);
      return;
    }
    if (restoreReference(previous)) replaceReferenceHistory(history.slice(0, -1));
  }
  function returnBeforeSearch() {
    const previous = searchOriginRef.current;
    if (!previous) return;
    if (!validReferenceReturn(previous.origin)) {
      replaceSearchOrigin(null);
      return;
    }
    if (!restoreReference(previous.origin)) return;
    replaceReferenceHistory(previous.history.filter(validReferenceReturn));
    replaceSearchOrigin(null);
  }
  function dismissReferenceHistory() {
    replaceReferenceHistory([]);
    replaceSearchOrigin(null);
  }

  function navigate(id: string, remember = true) {
    const index = book.chapters.findIndex((c) => c.paragraphs.some((p) => p.id === id));
    if (index < 0) return;
    if (remember && readerRef.current) {
      pushReferenceReturn(captureReferenceReturn());
      setJumpHighlight(id);
    }
    setScrollRange({
      bookId: book.id,
      start: Math.max(0, index - 1),
      end: Math.min(book.chapters.length - 1, index + 1),
    });
    setSelected(null);
    setSelectionMenu(null);
    setReferencePreview(null);
    setReferenceSession(false);
    setRevealed(null);
    noteRequest.current++;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    pendingPosition.current = null;
    advanceJumpRequest();
    scrollIntent.current = null;
    restoring.current = true;
    jumpAnchor.current = { paragraph: id, offset: 0, chapter: index };
    jumpEdge.current = 'start';
    window.getSelection()?.removeAllRanges();
    setPosition((p) => ({ chapter: index, paragraph: id, farthest: Math.max(p.farthest, index) }));
    setJump(id);
    setSidebarOpen(false);
  }
  function toChapter(index: number, edge: 'start' | 'end' = 'start') {
    const c = book.chapters[index];
    if (c?.paragraphs.length) {
      setSelected(null);
      navigate(
        edge === 'end' ? c.paragraphs[c.paragraphs.length - 1].id : c.paragraphs[0].id,
        false,
      );
      jumpEdge.current = edge;
    }
  }
  function markScrollIntent() {
    const root = readerRef.current;
    if (!tool && !illustration && !referencePreview) abandonPendingContentAnchor();
    if (continuous && root && !tool && !illustration && !referencePreview)
      scrollIntent.current = { top: root.scrollTop, until: performance.now() + 1500 };
  }
  function abandonPendingContentAnchor() {
    if (!pendingContentAnchor.current) return;
    pendingContentAnchor.current = null;
    if (readerRef.current) {
      forgetReadingAnchor(readerRef.current);
      navigation.refresh();
    }
  }
  function turnReadingPage(direction: -1 | 1) {
    abandonPendingContentAnchor();
    return navigation.turn(direction);
  }
  function saveScroll(scrolled = false) {
    const root = readerRef.current;
    if (switching || !ready || !root || referencePreview || root.dataset.turning === 'true') return;
    const intent = scrollIntent.current;
    const userMoved =
      scrolled &&
      continuous &&
      intent &&
      performance.now() <= intent.until &&
      Math.abs(root.scrollTop - intent.top) > 1;
    if (userMoved) intent.top = root.scrollTop;
    if (restoring.current) return;
    // Placeholder layout must not replace a saved within-paragraph position.
    // Explicit navigation clears this pending anchor before updating progress.
    if (pendingContentAnchor.current?.scope === contentScope) return;
    const anchor = readReadingAnchor(root);
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
    if (tool || referencePreview) return;
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
      readingScopeParagraphs(book, position, settings.scope).map(({ paragraph }) => paragraph.id),
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
        position.paragraph,
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
          position.paragraph,
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
    const measured = measureClient('note_save');
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
      measured();
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
  if (loadFailed)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sidebar px-6 text-center">
        <BookOpen size={38} className="text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl" role="alert">
          {t('打开失败，请重试。')}
        </h1>
        <Button
          className="rounded-full px-6"
          onClick={() => {
            setLoadFailed(false);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          {t('重试')}
        </Button>
        <Link className="text-sm text-primary" href={returnTo}>
          {t('返回{value0}', { value0: returnLabel })}
        </Link>
      </div>
    );
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
  // The sample is only an internal hook initializer until the requested book
  // and its local reading data have loaded. Never expose it as a placeholder.
  if (!surfaceReady) return <ReaderLoading />;
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
        <div className="min-w-0 text-sm text-muted-foreground">
          <div className="truncate">{book.title}</div>
          {!bookTranslation.sameLanguage && (needsLogin || bookTranslation.pending || bookTranslation.error) && (
            <div className="flex items-center gap-2 text-xs" role="status" aria-live="polite">
              {needsLogin ? (
                <button type="button" onClick={openLogin}>
                  {locale.startsWith('zh') ? '登录后自动翻译' : 'Sign in to translate'}
                </button>
              ) : !bookTranslation.online ? (
                <span>{locale.startsWith('zh') ? '离线 · 已保存译文可阅读' : 'Offline · saved translations available'}</span>
              ) : bookTranslation.error ? (
                <>
                  <span>{localize(bookTranslation.error)}</span>
                  <button type="button" onClick={bookTranslation.retry}>
                    {locale.startsWith('zh') ? '重试' : 'Retry'}
                  </button>
                </>
              ) : (
                <span>{locale.startsWith('zh') ? '翻译中' : 'Translating'} · {bookTranslation.progress}%</span>
              )}
            </div>
          )}
        </div>
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
          saveScroll(true);
        }}
        onWheel={(event) => {
          if (!event.ctrlKey && (event.deltaX || event.deltaY)) markScrollIntent();
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
          const root = event.currentTarget;
          const gutter = root.offsetWidth - root.clientWidth;
          const bounds = root.getBoundingClientRect();
          if (
            gutter > 0 &&
            event.target === root &&
            (event.clientX >= bounds.right - gutter || event.clientX <= bounds.left + gutter)
          )
            markScrollIntent();
        }}
        onPointerMove={(event) => {
          navigation.onPointerMove(event);
          const start = pointerStart.current;
          if (
            event.buttons &&
            start &&
            (Math.abs(event.clientY - start.y) > 8 || Math.abs(event.clientX - start.x) > 8)
          )
            markScrollIntent();
        }}
        onPointerUp={navigation.onPointerUp}
        onPointerCancel={navigation.onPointerCancel}
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            [
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'PageUp',
              'PageDown',
              'Home',
              'End',
              ' ',
            ].includes(event.key)
          )
            markScrollIntent();
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
                  turnReadingPage(
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
                    {!pdf && !hasChapterHeading && view !== 'translation' && (
                      <h1
                        className="chapter-title"
                        dir="auto"
                        lang={sourceLanguage === 'auto' ? undefined : sourceLanguage}
                      >
                        {visibleChapter.title}
                      </h1>
                    )}
                    {pdf && visibleChapter.sourcePage && (
                      <p className="mb-5 text-xs text-muted-foreground">
                        {t('PDF 第 {n} 页', { n: visibleChapter.sourcePage })}
                      </p>
                    )}
                    {visibleChapter.paragraphs.map((paragraph, index) => {
                      const savedTranslation =
                        revealedTranslation?.paragraph === paragraph.id
                          ? revealedTranslation
                          : null;
                      const translated = revealedTranslation
                        ? savedTranslation?.text || ''
                        : stableTranslations.read(chapterIndex, paragraph);
                      const translationKey =
                        savedTranslation?.key || stableTranslations.key(chapterIndex, paragraph);
                      const isTitle = index === 0 && hasChapterHeading;
                      const images = illustrations.get(paragraph.id);
                      const paragraphReferences = referencesByParagraph.get(paragraph.id) || [];
                      const paragraphNotes = notes.filter(
                        (note) => note.paragraphId === paragraph.id,
                      );
                      const passage = (
                        <Fragment key={paragraph.id}>
                          {images?.before.map((image) => (
                            <BookIllustration
                              key={image.placement.id}
                              image={image}
                              open={setIllustration}
                            />
                          ))}
                          <section
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
                                  lang={sourceLanguage === 'auto' ? undefined : sourceLanguage}
                                  dir="auto"
                                >
                                  <MarkedPassage
                                    text={paragraph.text}
                                    notes={paragraphNotes}
                                    references={paragraphReferences}
                                    openReference={openBookReference}
                                  />
                                </h1>
                              ) : (
                                <div
                                  className="passage-original"
                                  data-note-source="original"
                                  lang={sourceLanguage === 'auto' ? undefined : sourceLanguage}
                                  dir="auto"
                                >
                                  <MarkedPassage
                                    text={paragraph.text}
                                    notes={paragraphNotes}
                                    references={paragraphReferences}
                                    openReference={openBookReference}
                                  />
                                </div>
                              ))}
                            {view !== 'original' && translated && (
                              <div
                                data-translation
                                data-note-source="translation"
                                data-note-key={translationKey}
                                className={
                                  isTitle && view === 'translation'
                                    ? 'chapter-title'
                                    : 'passage-translation'
                                }
                                lang={savedTranslation?.language || settings.language}
                                dir="auto"
                              >
                                <MarkedPassage
                                  text={translated}
                                  notes={paragraphNotes}
                                  source="translation"
                                  translationKey={translationKey}
                                />
                              </div>
                            )}
                            {view === 'translation' && !translated && !!paragraph.text.trim() && (
                              <div className="translation-placeholder" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                              </div>
                            )}
                            {view === 'translation' &&
                              !!translated &&
                              paragraphReferences.length > 0 && (
                                <OriginalReferences
                                  references={paragraphReferences}
                                  paragraphs={paragraphsById}
                                  open={openBookReference}
                                />
                              )}
                            {!isTitle && (view !== 'translation' || translated) && (
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
                                  <PencilLine size={15} />
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
                          {images?.after.map((image) => (
                            <BookIllustration
                              key={image.placement.id}
                              image={image}
                              open={setIllustration}
                            />
                          ))}
                        </Fragment>
                      );
                      return paragraph.kind === 'heading' &&
                        paragraph.text.length < 240 &&
                        (images?.before.length || 0) + (images?.after.length || 0) === 1 ? (
                        <div key={paragraph.id} className="reader-illustrated-passage">
                          {passage}
                        </div>
                      ) : (
                        passage
                      );
                    })}
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
                    pdf={pdf}
                    next={book.chapters[chapterIndex + 1]}
                    index={chapterIndex}
                    turning={navigation.turning}
                    onChapter={navigation.changeChapter}
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
          <PencilLine size={20} strokeWidth={1.6} />
        </Button>
        <Button
          variant="plain"
          size="plain"
          className="reader-tool"
          aria-label={t('阅读语言')}
          title={t('阅读语言')}
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
      <ReadingNavigation
        mode={settings.navigationMode}
        chapterTitle={readingTitle}
        pdf={pdf}
        sourcePage={chapter.sourcePage}
        chapterPrevious={chapterNavigation.previous}
        chapterNext={chapterNavigation.next}
        onChapter={navigateChapter}
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
          void turnReadingPage(direction);
        }}
        onContents={() => setSidebarOpen(true)}
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
            aria-label={
              settings.navigationMode === 'paged'
                ? t('向前翻页')
                : t(chapterNavigation.previous?.kind === 'page' ? '上一原页' : '上一章')
            }
            disabled={
              navigation.turning ||
              (settings.navigationMode === 'paged'
                ? position.chapter === 0 && navigation.atStart
                : !chapterNavigation.previous)
            }
            onClick={() =>
              settings.navigationMode === 'paged'
                ? void turnReadingPage(-1)
                : chapterNavigation.previous && navigateChapter(chapterNavigation.previous)
            }
          >
            {book.pageDirection === 'rtl' ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </Button>
          <button
            className="flex min-h-8 min-w-0 flex-1 items-center gap-3"
            onClick={() => openTool('progress')}
            aria-label={t('调整阅读进度')}
          >
            <span className="min-w-0 flex-1 truncate text-start">{readingTitle}</span>
            {pdf && chapter.sourcePage && (
              <span className="shrink-0">{t('PDF 第 {n} 页', { n: chapter.sourcePage })}</span>
            )}
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
                  ? t(pdf ? '下一原页' : '下一章')
                  : t('向后翻页')
                : t(chapterNavigation.next?.kind === 'page' ? '下一原页' : '下一章')
            }
            disabled={
              navigation.turning ||
              (settings.navigationMode === 'paged'
                ? position.chapter === book.chapters.length - 1 && navigation.atEnd
                : !chapterNavigation.next)
            }
            onClick={() =>
              settings.navigationMode === 'paged'
                ? void turnReadingPage(1)
                : chapterNavigation.next && navigateChapter(chapterNavigation.next)
            }
          >
            {book.pageDirection === 'rtl' ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </Button>
        </div>
        <nav className="grid grid-cols-4" aria-label={t('手机阅读工具')}>
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
            onClick={() => openCompanion('notes')}
          >
            <PencilLine size={21} strokeWidth={1.6} />
            <span>{t('笔记')}</span>
          </Button>
          <Button
            variant="plain"
            size="plain"
            className="mobile-reader-tool"
            onClick={() => openTool('language')}
          >
            <Languages size={22} strokeWidth={1.6} />
            <span>{t('阅读语言')}</span>
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

      {referencePreview && (
        <BookReferencePreview
          link={referencePreview.link}
          target={referencePreview.target}
          paragraphs={paragraphsById}
          language={sourceLanguage}
          opener={referencePreview.opener}
          close={() => setReferencePreview(null)}
          visit={() => visitBookReference(referencePreview.target, referencePreview.origin)}
        />
      )}

      {(referenceReturn || searchOrigin) && surfaceReady && !tool && !referencePreview && (
        <div className="reference-return fixed bottom-10 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-full border bg-card p-1 shadow-lg">
          <Button
            variant="ghost"
            className="h-9 rounded-full px-4 text-xs"
            onClick={referenceReturn ? returnFromReference : returnBeforeSearch}
          >
            <ArrowLeft size={14} />
            {referenceReturn?.panel
              ? t('返回{value0}', {
                  value0: referenceReturn.panel === 'chat' ? t('AI 伴读') : t('笔记'),
                })
              : t('返回刚才位置')}
          </Button>
          {searchOrigin && (
            <Button
              variant="ghost"
              className="h-9 rounded-full px-4 text-xs"
              onClick={returnToSearchResults}
            >
              <Search size={14} />
              {locale.startsWith('zh') ? '返回搜索结果' : 'Back to results'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={t('留在当前原文')}
            onClick={dismissReferenceHistory}
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
        scrollCurrent={false}
      >
        <div className="shrink-0 px-7 pb-4">
          <p className="mb-1 line-clamp-2 text-base font-medium leading-relaxed">{book.title}</p>
          <p className="mb-5 text-xs text-muted-foreground">{book.author}</p>
          {searchOrigin && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-3 w-full justify-start rounded-full"
              onClick={returnBeforeSearch}
            >
              <ArrowLeft size={16} />
              {locale.startsWith('zh') ? '返回刚才阅读位置' : 'Back to reading position'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 w-full justify-start rounded-full"
            disabled={activeContent < 0 || !surfaceReady || searchOpening}
            onClick={() => {
              changeSearchCriteria({ query: '' });
              const ancestors = activeContentKey
                ? contentsOutlineAncestors(contentsOutline, activeContentKey)
                : [];
              setCollapsedContents(
                (keys) => new Set([...keys].filter((key) => !ancestors.includes(key))),
              );
              setContentsLocateRequest((request) => request + 1);
            }}
          >
            <LocateFixed size={16} />
            {t('定位正在读')}
          </Button>
          {hasPdfContents && (
            <div className="mb-4 flex gap-2" role="group" aria-label={t('目录')}>
              {[false, true].map((pages) => (
                <Button
                  key={String(pages)}
                  variant={pdfPages === pages ? 'secondary' : 'ghost'}
                  size="sm"
                  className="rounded-full"
                  aria-pressed={pdfPages === pages}
                  disabled={searchOpening}
                  onClick={() => {
                    if (searchOpeningRef.current) return;
                    setPdfPages(pages);
                    changeSearchCriteria({ query: '' });
                  }}
                >
                  {pages ? t('原页目录') : t('章节')}
                </Button>
              ))}
            </div>
          )}
          {hierarchicalContents && !searchingContents && (
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('目录')}>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setCollapsedContents(() => new Set())}
              >
                {t('展开所有目录')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() =>
                  setCollapsedContents(
                    () =>
                      new Set(
                        contentsOutline.nodes
                          .filter((node) => node.hasChildren)
                          .map((node) => node.key),
                      ),
                  )
                }
              >
                {t('收起所有目录')}
              </Button>
            </div>
          )}
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <Input
              className="h-10 rounded-full border-0 bg-muted ps-10 pe-9 text-sm shadow-none"
              placeholder={t(searchTitles ? '搜索目录标题' : '搜索书中内容')}
              data-reader-search
              aria-label={t(searchTitles ? '搜索目录标题' : '搜索书中内容')}
              maxLength={160}
              value={search}
              disabled={searchOpening}
              onChange={(event) => {
                changeSearchCriteria({ query: event.target.value });
              }}
            />
            {search && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1 rounded-full"
                disabled={searchOpening}
                onClick={() => changeSearchCriteria({ query: '' })}
                aria-label={t('清除搜索')}
              >
                <X size={14} />
              </Button>
            )}
          </div>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label={locale.startsWith('zh') ? '搜索来源' : 'Search source'}
          >
            <Button
              variant={searchTitles ? 'secondary' : 'ghost'}
              size="sm"
              className="rounded-full"
              aria-pressed={searchTitles}
              disabled={searchOpening}
              onClick={() => changeSearchCriteria({ titles: true })}
            >
              {t('目录标题')}
            </Button>
            {(['original', 'translation'] as const).map((source) => (
              <Button
                key={source}
                variant={!searchTitles && searchSource === source ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-full"
                aria-pressed={!searchTitles && searchSource === source}
                disabled={searchOpening}
                onClick={() => {
                  changeSearchCriteria({ source });
                }}
              >
                {source === 'original'
                  ? t('原文')
                  : locale.startsWith('zh')
                    ? '已保存译文'
                    : 'Saved translations'}
              </Button>
            ))}
          </div>
          {!searchTitles && searchSource === 'translation' && (
            <div className="mt-3 space-y-2">
              <select
                value={searchLanguage}
                disabled={searchOpening}
                aria-label={locale.startsWith('zh') ? '搜索译文语言' : 'Translation language'}
                className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                onChange={(event) => {
                  changeSearchCriteria({ language: event.target.value });
                }}
              >
                <option value="">
                  {locale.startsWith('zh') ? '所有已保存语言' : 'All saved languages'}
                </option>
                {readingLanguages.map(([code, name]) => (
                  <option key={code} value={code}>
                    {displayLanguage(code, locale) || name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <nav
          ref={attachContentsList}
          onScroll={(event) => {
            if (
              search.trim() &&
              !searchTitles &&
              searchResults.data &&
              !searchResults.loading &&
              !restoringSearchScroll.current
            )
              searchScroll.current = event.currentTarget.scrollTop;
          }}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6"
          aria-label={t('章节目录')}
        >
          {search.trim() && !searchTitles ? (
            <ReaderSearchMatches
              key={searchResults.identity}
              state={searchResults}
              source={searchSource}
              locale={locale}
              open={followSearchMatch}
              page={searchPage}
              changePage={changeSearchPage}
              opening={searchOpening}
              onReady={() => {
                const list = searchList.current;
                const identity = searchIdentity.current;
                if (list && search.trim())
                  requestAnimationFrame(() => {
                    if (
                      list.isConnected &&
                      searchIdentity.current === identity &&
                      searchList.current === list
                    ) {
                      list.scrollTop = searchScroll.current;
                      restoringSearchScroll.current = false;
                    }
                  });
              }}
            />
          ) : contentsProjection.rows.length ? (
            contentsProjection.rows.map((row) => (
              <div
                key={row.key}
                data-reader-content-index={row.index}
                className="flex items-start rounded-lg hover:bg-muted"
                style={{ paddingInlineStart: 4 + Math.min(row.depth, 5) * 16 }}
              >
                {hierarchicalContents &&
                  (row.hasChildren && !searchingContents ? (
                    <Button
                      variant="plain"
                      size="plain"
                      className="mt-2.5 flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted-foreground/10"
                      aria-label={t(row.collapsed ? '展开{value0}' : '收起{value0}', {
                        value0: row.entry.title,
                      })}
                      aria-expanded={!row.collapsed}
                      onClick={() =>
                        setCollapsedContents((keys) => {
                          const next = new Set(keys);
                          if (next.has(row.key)) next.delete(row.key);
                          else next.add(row.key);
                          return next;
                        })
                      }
                    >
                      {row.collapsed ? (
                        <ChevronRight className="rtl:rotate-180" size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </Button>
                  ) : (
                    <span aria-hidden className="w-9 shrink-0" />
                  ))}
                <Button
                  variant="plain"
                  size="plain"
                  aria-current={row.isActive ? 'location' : undefined}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-4 text-start text-sm leading-7 aria-[current=location]:text-primary ${row.isContext ? 'text-muted-foreground' : ''}`}
                  onClick={() => navigate(row.entry.paragraphId)}
                  disabled={switching}
                >
                  <span className="min-w-0 break-words">
                    {row.entry.title}
                    {hasPdfContents && !pdfPages && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t('PDF 第 {n} 页', {
                          n:
                            book.chapters[paragraphChapters.get(row.entry.paragraphId) ?? 0]
                              ?.sourcePage ?? '',
                        })}
                      </span>
                    )}
                  </span>
                  {row.isActive && <span className="shrink-0 text-[11px]">{t('正在读')}</span>}
                  {row.isActiveAncestor && row.collapsed && !searchingContents && (
                    <span className="shrink-0 text-[11px] text-primary">{t('包含当前位置')}</span>
                  )}
                </Button>
              </div>
            ))
          ) : (
            <p className="px-3 py-6 text-sm text-muted-foreground">{t('未找到匹配文字。')}</p>
          )}
        </nav>
        {searchTitles && contentsProjection.searching && (
          <p role="status" className="shrink-0 px-7 py-3 text-xs text-muted-foreground">
            {t('匹配 {count} 项', { count: contentsProjection.directMatchCount })}
          </p>
        )}
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
          settings={{ ...settings, readingMode: view }}
          update={updateAppearance}
        />
      </ReadingPanel>

      <ReadingPanel
        open={tool === 'more'}
        onOpenChange={(open) => !open && openTool(null)}
        title={t('阅读选项')}
        compact
      >
        <div className="grid gap-1 px-5 pb-6 text-sm">
          <button
            className="flex items-center gap-3 rounded-xl px-4 py-4 text-start hover:bg-muted"
            onClick={() => openTool('bookmarks')}
          >
            <Bookmark size={19} />
            {t('书签')}
            <span className="ms-auto text-muted-foreground">{bookmarks.length}</span>
          </button>
          <button
            className="flex items-center gap-3 rounded-xl px-4 py-4 text-start hover:bg-muted"
            onClick={() => openTool('progress')}
          >
            <ArrowUpRight size={19} />
            {t('阅读进度')}
          </button>
          {isPdfBook(book) && (
            <button
              className="flex items-center gap-3 rounded-xl px-4 py-4 text-start hover:bg-muted"
              onClick={() => openTool('pdf-original')}
            >
              <BookOpen size={19} />
              {t('PDF 原页')}
            </button>
          )}
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

      <BookmarksPanel
        book={book}
        bookmarks={bookmarks}
        open={tool === 'bookmarks'}
        onOpenChange={(open) => openTool(open ? 'bookmarks' : null)}
        add={addCurrentBookmark}
        visit={followBookmark}
        change={changeBookmark}
      />

      {illustration && (
        <IllustrationDialog image={illustration} close={() => setIllustration(null)} />
      )}
      {tool === 'pdf-original' && isPdfBook(book) && (
        <PdfOriginalDialog
          key={book.id}
          book={book}
          sourcePage={chapter.sourcePage || 1}
          close={() => openTool(null)}
          readPage={(index, evidence) => {
            if (!surfaceReady || restoring.current || navigation.turning) return;
            const page = book.chapters[index];
            const target =
              evidence && page?.sourcePage
                ? resolvePdfTextEvidence(book, page.sourcePage, evidence)
                : null;
            if (target) {
              const paragraph = paragraphsById.get(target.paragraph);
              if (!paragraph) return;
              navigate(target.paragraph);
              setReferenceSession(true);
              setTemporaryOriginal({
                bookId: book.id,
                language: settings.language,
                readingMode: settings.readingMode,
              });
              const anchor: ReadingAnchor = {
                chapter: target.chapter,
                paragraph: target.paragraph,
                textSource: 'original',
                textOffset: target.start,
                textQuote: safeReadingQuote(paragraph.text, target.start),
                offset: target.start / Math.max(1, paragraph.text.length),
              };
              layoutAnchor.current = null;
              jumpAnchor.current = anchor;
              setPosition((current) => ({ ...current, ...anchor }));
            } else if (page?.paragraphs[0] && index !== position.chapter)
              navigate(page.paragraphs[0].id);
            openTool(null);
          }}
        />
      )}

      <ReadingPanel
        open={tool === 'progress'}
        onOpenChange={(open) => !open && openTool(null)}
        title={t('阅读进度')}
        compact
      >
        <ReadingProgress
          key={tool === 'progress' ? position.paragraph : 'closed'}
          book={book}
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
          <div className="mt-5 flex justify-end">
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
            </div>
            <div
              ref={restoreChatScroll}
              onScroll={(event) => {
                chatScrollPosition.current = event.currentTarget.scrollTop;
              }}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-7 pb-5"
            >
              {messages.map((message, index) => (
                <div key={index} data-role={message.role} className="group/message pt-6">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    {message.role === 'assistant' ? t('AI 伴读') : t('你')}
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
            {notes.length > 0 && (
            <div className="flex justify-end py-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs font-normal"
                onClick={exportNotes}
              >
                <ArrowDownToLine size={14} />
                {t('导出')}
              </Button>
            </div>
            )}
            {!notes.length && !selected && (
              <div className="py-16 text-center text-muted-foreground">
                <p className="text-sm">{t('选中文字，留下一个想法。')}</p>
              </div>
            )}
            {notes.map((note) => (
              <div className="border-b py-5" key={note.id}>
                <Button
                  variant="plain"
                  size="plain"
                  className="mb-3 max-w-full text-start text-xs leading-6 text-muted-foreground"
                  onClick={() => {
                    void followNote(note);
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
          onSave={async (s) => {
            let next = s;
            if (authEnabled && user) {
              const config = await saveAIConnection(s);
              next = applyAIConnection(s, config);
              setAIConnection(config);
            }
            settingsEdited.current = true;
            setSettings(next);
            setNotice(t('设置已保存。'));
          }}
          close={() => setSettingsOpen(false)}
        />
      )}
      {helpOpen && (
        <Modal title={t('阅读帮助')} close={() => setHelpOpen(false)}>
          <div className="mt-5 text-[13px] leading-[1.9] text-muted-foreground [&_p]:my-[1em]">
            <p>
              {t(
                'ByPage · 逐页 是一个开源的多语言阅读器。书籍、阅读位置、译文和笔记保存在浏览器 IndexedDB 中；清除网站数据会移除它们。',
              )}
            </p>
            <p>
              {locale.startsWith('zh')
                ? '打开书后自动在后台翻译，离开后也会继续；回来即可看到最新进度和译文。在“阅读语言”中选择原文、双语或仅译文。AI 跟随阅读位置，选中文字可指定提问范围。'
                : 'Opening a book starts background translation, which continues after you leave. Return to see the latest progress and translations. Choose Original, Bilingual or Translation only in Reading language. AI follows your reading position, or the text you select.'}
            </p>
            <p>
              {t(
                '“截至最远章节”包括你曾打开的章节，不代表逐段读过。长书采用关键词检索，回答可能只参考部分原文。引用可点击核对。',
              )}
            </p>
            <p>{t('保留文字与页码出处。复杂表格、公式和图片不会还原为原版版式。')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
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
    </div>
  );
}
