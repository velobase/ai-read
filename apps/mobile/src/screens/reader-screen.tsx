import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Alert, AppState, Pressable, Text, TextInput, View, type ViewToken } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  readingProgress,
  readingChapterNavigation,
  bookContents,
  effectiveBookLanguage,
  isPdfBook,
  resolvePdfTextEvidence,
  resolveSavedPassage,
  resolveQuotedRange,
  safeReadingQuote,
  type Book,
  type Bookmark,
  type Note,
  type NoteAnchor,
  type Paragraph,
  type Position,
  type BookReferenceTarget,
  type BookReferenceLink,
} from '@bypage/reading-core';
import { AppContext, useApp, type Preferences } from '../context';
import {
  saveBookReadingPreferences,
  type BookReadingPreferences,
} from '../adapters/book-reading-preferences';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import type { LibraryLease } from '../adapters/library-scope';
import {
  savePosition,
  saveNote,
  markFinished,
  listBookmarks,
  saveBookmark,
  renameBookmark,
  removeBookmark,
  readExactTranslation,
  selectParagraphTranslationVersion,
} from '../adapters/database';
import { measured } from '../adapters/diagnostics';
import { PaginatedChapter } from '../components/paginated-chapter';
import { BookSearchSheet } from '../components/book-search-sheet';
import { BookmarksSheet, type BookmarkFeedback } from '../components/bookmarks-sheet';
import { AssistantSheet } from '../components/assistant-sheet';
import { PdfOriginalSheet } from '../components/pdf-original-sheet';
import { ReadingNavigation } from '../components/reading-navigation';
import { useReaderLayoutChange } from '../components/use-reader-layout-change';
import { useReaderSheet } from '../components/use-reader-sheet';
import { ContentsSheet } from '../components/contents-sheet';
import { ReadingProgressPanel } from '../components/reading-progress-panel';
import { BookImage, BookImageViewer } from '../components/book-image';
import { bookImages, type BookImageReference } from '../adapters/book-media';
import { useChapterTranslation } from '../components/use-chapter-translation';
import { TranslationStatus } from '../components/translation-status';
import { buildSpeechPlan, type SpeechScope, type SpeechSource } from '../adapters/speech-plan';
import { useReaderSpeech } from '../components/use-reader-speech';
import { ReaderSpeechPanel } from '../components/reader-speech-panel';
import { ReaderNotesSheet } from '../components/reader-notes-sheet';
import {
  AnchoredParagraphList,
  AnchorPassageText,
  type VisibleAnchorCapture,
} from '../components/anchored-paragraph-list';
import { HighlightedPassage, passageRanges, type PassageSelection } from '../components/passage';
import { PassageSelectionSheet } from '../components/passage-selection-sheet';
import {
  referencesByParagraph,
  type ReadingReference,
  type ReferenceOrigin,
} from '../adapters/book-references';
import { ReferenceListSheet, ReferencePreviewSheet } from '../components/book-reference-sheet';
import { Button, Chip, Icon, IconButton, Sheet, styles } from '../components/ui';
import { TranslationVersionsContent } from '../components/translation-versions-sheet';
import { ReaderReturnActions } from '../components/reader-return-actions';
import { resolveReaderLocation, type ReaderLocationSnapshot } from '../adapters/reader-location';

type RevealedTranslation = { language: string; paragraph: string; key: string; text: string };
type ReaderSheet =
  | 'contents'
  | 'search'
  | 'bookTools'
  | 'assistant'
  | 'appearance'
  | 'actions'
  | 'note'
  | 'language'
  | 'progress'
  | 'notes'
  | 'bookmarks'
  | 'speech'
  | 'pdfOriginal'
  | 'translationVersions'
  | 'selection'
  | 'image'
  | 'referenceList'
  | 'referencePreview';
const readerSheetGroup = (sheet: ReaderSheet) =>
  sheet === 'language' || sheet === 'actions' || sheet === 'translationVersions'
    ? 'passageTools'
    : sheet;

export type OpenBook = {
  library: LibraryLease;
  book: Book;
  position?: Position;
  translations: Record<string, Record<string, string>>;
  translationKeys: Record<string, Record<string, string>>;
  notes: Note[];
  /** An explicit translated-note jump may reveal saved text even for the same language. */
  revealTranslation?: RevealedTranslation;
  /** A source jump applies only to this Reader session, never global preferences. */
  readingOverride?: ReadingOverride;
  readingPreferences: BookReadingPreferences;
};
type ReadingOverride = { language: string; mode: 'original' | 'bilingual' | 'translation' };
const emptyTranslations: Record<string, string> = {};
function savedQuoteOffset(text: string | undefined, offset: number, quote: string | undefined) {
  if (!text || !quote?.trim()) return null;
  if (text.slice(offset, offset + quote.length) === quote) return offset;
  const first = text.indexOf(quote);
  return first >= 0 && text.indexOf(quote, first + 1) < 0 ? first : null;
}
type ReferenceReturn = ReaderLocationSnapshot & {
  preferences: { language: string; mode: ReadingOverride['mode'] };
  referenceSources?: string[];
};
type ReadingLocation = Pick<
  ReaderLocationSnapshot,
  'position' | 'original' | 'reveal' | 'readingOverride'
>;
const emptyContentsCollapsed: ReadonlySet<string> = new Set();
export function ReaderScreen({
  value,
  close,
  onToolsChange,
}: {
  value: OpenBook;
  close: () => void;
  onToolsChange: (visible: boolean) => void;
}) {
  const library = useLibrary();
  const { registerFlush, blocked } = useLibraryController();
  const navigationBlock = useRef({ blocked, revision: 0 });
  if (navigationBlock.current.blocked !== blocked)
    navigationBlock.current = { blocked, revision: navigationBlock.current.revision + 1 };
  if (value.library !== library) throw new Error('reader_library_mismatch');
  const { book } = value;
  const sourceLanguage = effectiveBookLanguage(book);
  const app = useApp();
  const { colors, preferences: globalPreferences, patch: patchGlobal, t, notify } = app;
  const [bookPreferences, setBookPreferences] = useState(value.readingPreferences);
  const bookPreferencesRef = useRef(bookPreferences);
  const prefs = { ...globalPreferences, ...bookPreferences };
  const patch = (change: Partial<Preferences>) => {
    const { language, mode, ...appearance } = change;
    if (Object.keys(appearance).length) patchGlobal(appearance);
    if (language === undefined && mode === undefined) return;
    const next = {
      ...bookPreferencesRef.current,
      ...(language ? { language } : {}),
      ...(mode ? { mode } : {}),
    };
    bookPreferencesRef.current = next;
    setBookPreferences(next);
    void saveBookReadingPreferences(library.handle, book.id, next).catch((error) => {
      console.error(
        'Book reading preferences could not be saved',
        { bookId: book.id, libraryKey: library.handle.key },
        error,
      );
      if (library.isCurrent()) notify(t('error'));
    });
  };
  let initial: Position = value.position || {
    chapter: 0,
    paragraph: book.chapters[0].paragraphs[0].id,
    farthest: 0,
  };
  // A temporary bookmark language never changes preferences. On reopening, a
  // translated progress offset must still belong to the currently chosen text.
  if (initial.textSource === 'translation' && initial.textQuote) {
    const offset = savedQuoteOffset(
      value.revealTranslation?.paragraph === initial.paragraph
        ? value.revealTranslation.text
        : value.translations[value.readingOverride?.language || prefs.language]?.[
            initial.paragraph
          ],
      initial.textOffset || 0,
      initial.textQuote,
    );
    initial =
      offset === null
        ? { ...initial, textSource: 'original', textOffset: 0, offset: 0, textQuote: undefined }
        : { ...initial, textOffset: offset };
  }
  const [chapterIndex, setChapterIndex] = useState(initial.chapter);
  const [current, setCurrent] = useState(initial);
  const [jump, setJump] = useState(initial.paragraph);
  const [jumpRevision, setJumpRevision] = useState(0);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [jumpToEnd, setJumpToEnd] = useState(false);
  const sheetController = useReaderSheet<ReaderSheet>({ library, group: readerSheetGroup });
  const { sheet } = sheetController;
  const requestedSheet = useRef(sheetController.desiredSheet);
  requestedSheet.current = sheetController.desiredSheet;
  const setSheet = (next: ReaderSheet | null) => {
    // Closing or replacing a panel also invalidates an in-flight location read.
    // Its modal may remain mounted until UIKit acknowledges dismissal.
    if (requestedSheet.current !== next) navigationRequest.current++;
    requestedSheet.current = next;
    sheetController.request(next);
  };
  // Only the mounted host receives this presentation's callbacks. A late event
  // from a different, permanently mounted Sheet must not acknowledge a new one.
  const sheetProps = (...names: ReaderSheet[]) => {
    const mounted = sheet !== null && names.includes(sheet);
    return {
      visible: mounted && sheetController.visible,
      onShow: mounted ? sheetController.onShow : undefined,
      onDismiss: mounted ? sheetController.onDismiss : undefined,
    };
  };
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 1 });
  const [visibleParagraphs, setVisibleParagraphs] = useState([initial.paragraph]);
  const visibleParagraphsChanged = (ids: string[]) =>
    setVisibleParagraphs((previous) =>
      previous.length === ids.length && previous.every((id, index) => id === ids[index])
        ? previous
        : ids,
    );
  const [interacting, setInteracting] = useState(false);
  const interactionActive = useRef(false);
  const interactionRevision = useRef(0);
  const interactionSources = useRef(new Set<string>());
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const readingInteraction = (active: boolean, source = 'motion') => {
    clearTimeout(interactionTimer.current);
    interactionRevision.current++;
    if (active) {
      interactionSources.current.add(source);
      interactionActive.current = true;
      setInteracting(true);
    } else {
      interactionSources.current.delete(source);
      if (!interactionSources.current.size)
        interactionTimer.current = setTimeout(() => {
          interactionActive.current = false;
          setInteracting(false);
        }, 300);
    }
  };
  useEffect(() => () => clearTimeout(interactionTimer.current), []);
  const [toolsVisible, setToolsVisible] = useState(false);
  useEffect(() => onToolsChange(toolsVisible), [toolsVisible, onToolsChange]);
  const [selected, setSelected] = useState<PassageSelection | null>(null);
  const [versionTarget, setVersionTarget] = useState<{
    paragraphId: string;
    language: string;
  } | null>(null);
  const versionSelectionBusy = useRef(false);
  const onVersionBusyChange = useCallback((busy: boolean) => {
    versionSelectionBusy.current = busy;
  }, []);
  const [selectionEditor, setSelectionEditor] = useState<{
    bookId: string;
    passage: PassageSelection;
    returnTo: 'actions' | 'note';
  } | null>(null);
  const [selectedImage, setSelectedImage] = useState<BookImageReference | null>(null);
  const [referenceOriginal, setReferenceOriginal] = useState(false);
  const [readingOverride, setReadingOverride] = useState<ReadingOverride | null>(
    value.readingOverride || null,
  );
  const readingLanguage = readingOverride?.language || prefs.language;
  const [referenceHistory, setReferenceHistory] = useState<ReferenceReturn[]>([]);
  const referenceHistoryRef = useRef<ReferenceReturn[]>([]);
  const [returnBusy, setReturnBusy] = useState(false);
  const returning = useRef<symbol | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<
    (ReferenceReturn & { history: ReferenceReturn[] }) | null
  >(null);
  const searchOriginRef = useRef<typeof searchOrigin>(null);
  const replaceReferenceHistory = (next: ReferenceReturn[]) => {
    referenceHistoryRef.current = next.slice(-8);
    setReferenceHistory(referenceHistoryRef.current);
  };
  const replaceSearchOrigin = (next: typeof searchOrigin) => {
    searchOriginRef.current = next;
    setSearchOrigin(next);
  };
  const searchVisible = useRef(false);
  searchVisible.current = sheet === 'search' && sheetController.visible;
  const [pageReferences, setPageReferences] = useState<ReadingReference[]>([]);
  const [referenceChoices, setReferenceChoices] = useState<ReadingReference[] | null>(null);
  const [referencePreview, setReferencePreview] = useState<{
    label: string;
    kind: BookReferenceLink['kind'];
    target: BookReferenceTarget;
    origin: ReferenceReturn;
  } | null>(null);
  const openReferenceChoices = (references: ReadingReference[]) => {
    setReferenceChoices(references);
    setSheet('referenceList');
  };
  const openImage = (image: BookImageReference) => {
    setSelectedImage(image);
    setSheet('image');
  };
  const [revealedTranslation, setRevealedTranslation] = useState<RevealedTranslation | null>(
    value.revealTranslation || null,
  );
  const previousReadingPreferences = useRef({ mode: prefs.mode, language: prefs.language });
  useEffect(() => {
    const previous = previousReadingPreferences.current;
    if (previous.mode === prefs.mode && previous.language === prefs.language) return;
    previousReadingPreferences.current = { mode: prefs.mode, language: prefs.language };
    setReferenceOriginal(false);
    setReadingOverride(null);
  }, [prefs.mode, prefs.language]);
  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState(value.notes);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const bookmarkBusy = useRef(false);
  const bookmarkSource = useRef<{
    paragraph: string;
    textOffset: number;
    translationKey: string;
  } | null>(null);
  const capture = useRef<VisibleAnchorCapture | null>(null);
  const positionEpoch = useRef(0);
  const navigationRequest = useRef(0);
  const exiting = useRef(false);
  const idleSaveRun = useRef(0);
  const idleRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const isReaderCurrent = () => alive.current && library.isCurrent();
  useEffect(() => {
    alive.current = true;
    let active = true;
    setBookmarksLoading(true);
    void listBookmarks(library.handle, book)
      .then((items) => {
        if (active && library.isCurrent()) setBookmarks(items);
      })
      .catch(() => {
        if (active && library.isCurrent()) notify(t('error'));
      })
      .finally(() => {
        if (active && library.isCurrent()) setBookmarksLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [book, library]);
  const [saving, setSaving] = useState(false);
  const noteBusy = useRef(false);
  const [noteError, setNoteError] = useState('');
  useEffect(() => setNoteError(''), [selected]);
  const speech = useReaderSpeech({ visible: sheet === 'speech' && sheetController.visible });
  const currentSpeech = useRef(speech.state.current);
  currentSpeech.current = speech.state.current;
  const [speechSetup, setSpeechSetup] = useState<{
    position: Position;
    scope: SpeechScope;
    source: SpeechSource;
    language: string;
    selection?: PassageSelection;
  }>({ position: initial, scope: 'chapter', source: 'original', language: prefs.language });
  const speechLanguage = useRef(prefs.language);
  const speechContext = useRef('');
  useEffect(() => {
    const context = `${library.handle.key}:${library.epoch}:${book.id}:${sourceLanguage}:${prefs.language}:${prefs.mode}`;
    if (speechContext.current && speechContext.current !== context) void speech.stop();
    speechContext.current = context;
  }, [library, book.id, sourceLanguage, prefs.language, prefs.mode, speech.stop]);
  const [chapterQuery, setChapterQuery] = useState('');
  const [pdfPages, setPdfPages] = useState(false);
  const [contentsCollapsed, setContentsCollapsed] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const latest = useRef(initial);
  const persisted = useRef('');
  const saveChain = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveErrorShown = useRef(false);
  const readyToTrack = useRef(false);
  const chapter = book.chapters[chapterIndex];
  const pdf = isPdfBook(book);
  const chapterNavigation = useMemo(
    () =>
      readingChapterNavigation(book, { chapter: current.chapter, paragraph: current.paragraph }),
    [book, current.chapter, current.paragraph],
  );
  const chapterTitle = chapterNavigation.current?.title || chapter.title;
  const sourcePageLabel =
    pdf && chapter.sourcePage ? t('pdfPage', { n: chapter.sourcePage }) : undefined;
  const chapterStartsWithTitle =
    chapter.paragraphs[0]?.kind === 'heading' &&
    chapter.paragraphs[0].text.trim() === chapter.title.trim();
  const continuous = prefs.turnMode === 'scroll' && prefs.scrollFlow === 'continuous';
  const paragraphIndex = useMemo(
    () =>
      new Map(
        book.chapters.flatMap((chapter, index) =>
          chapter.paragraphs.map(
            (paragraph, offset) =>
              [paragraph.id, { chapter: index, paragraph, offset, first: offset === 0 }] as const,
          ),
        ),
      ),
    [book],
  );
  const allParagraphs = useMemo(
    () => book.chapters.flatMap((chapter) => chapter.paragraphs),
    [book],
  );
  const paragraphReferences = useMemo(() => referencesByParagraph(book), [book]);
  const referenceLinks = useMemo(
    () => new Map(book.references?.links.map((link) => [link.id, link]) || []),
    [book],
  );
  const referenceTargets = useMemo(
    () => new Map(book.references?.targets.map((target) => [target.id, target]) || []),
    [book],
  );
  const imagesByParagraph = useMemo(() => {
    const entries = new Map<
      string,
      { before: BookImageReference[]; after: BookImageReference[] }
    >();
    for (const image of bookImages(book)) {
      const entry = entries.get(image.placement.paragraphId) || { before: [], after: [] };
      entry[image.placement.position].push(image);
      entries.set(image.placement.paragraphId, entry);
    }
    return entries;
  }, [book, library]);
  const scrollParagraphs = continuous ? allParagraphs : chapter.paragraphs;
  const translation = useChapterTranslation(book, value.translations, current, {
    language: readingLanguage,
    initialKeys: value.translationKeys,
  });
  const [displayedTranslation, setDisplayedTranslation] = useState({
    language: readingLanguage,
    saved: translation.saved,
    keys: translation.savedKeys,
  });
  const displayed =
    displayedTranslation.language === readingLanguage
      ? displayedTranslation
      : { language: readingLanguage, saved: translation.saved, keys: translation.savedKeys };
  const baseTranslations = displayed.saved[readingLanguage] || emptyTranslations;
  const baseTranslationKeys = displayed.keys[readingLanguage] || emptyTranslations;
  const translations = useMemo(
    () =>
      revealedTranslation?.language === readingLanguage
        ? { ...baseTranslations, [revealedTranslation.paragraph]: revealedTranslation.text }
        : baseTranslations,
    [baseTranslations, revealedTranslation, readingLanguage],
  );
  const translationKeys = useMemo(
    () =>
      revealedTranslation?.language === readingLanguage
        ? { ...baseTranslationKeys, [revealedTranslation.paragraph]: revealedTranslation.key }
        : baseTranslationKeys,
    [baseTranslationKeys, revealedTranslation, readingLanguage],
  );
  // An explicit saved-note/search jump can still reveal an existing same-language translation.
  // The default remains original, without changing global preferences or translation identities.
  const revealSavedTranslation =
    revealedTranslation?.language === readingLanguage &&
    paragraphIndex.get(revealedTranslation.paragraph)?.chapter === chapterIndex &&
    !!translations[revealedTranslation.paragraph];
  const readingMode = referenceOriginal
    ? 'original'
    : readingOverride?.mode ||
      (translation.sameLanguage ? (revealSavedTranslation ? 'bilingual' : 'original') : prefs.mode);
  const speechPlan = useMemo(
    () =>
      buildSpeechPlan({
        book,
        position: speechSetup.position,
        scope: speechSetup.scope,
        source: speechSetup.source,
        translations:
          speechSetup.language === readingLanguage
            ? translations
            : translation.saved[speechSetup.language] || emptyTranslations,
        translationKeys:
          speechSetup.language === readingLanguage
            ? translationKeys
            : translation.savedKeys[speechSetup.language] || emptyTranslations,
        sourceLanguage,
        targetLanguage: speechSetup.language,
        selection: speechSetup.selection,
      }),
    [
      book,
      speechSetup,
      translation.saved,
      translation.savedKeys,
      sourceLanguage,
      readingLanguage,
      translations,
      translationKeys,
    ],
  );
  const speechActive = ['loading', 'speaking', 'paused'].includes(speech.state.status);
  const bookmarkContext = useRef('');
  bookmarkContext.current = `${positionEpoch.current}:${jumpRevision}:${layoutRevision}:${readingMode}:${readingLanguage}:${prefs.turnMode}:${prefs.scrollFlow}:${prefs.fontSize}:${prefs.lineHeight}:${prefs.serif}`;
  const currentText = useRef({ translations, translationKeys, readingMode });
  currentText.current = { translations, translationKeys, readingMode };
  const scrollAnchor = useMemo(() => {
    const snapshot = { ...latest.current };
    const hasTranslation = !!translations[snapshot.paragraph];
    const source =
      readingMode === 'original' || !hasTranslation
        ? 'original'
        : readingMode === 'translation'
          ? 'translation'
          : snapshot.textSource || 'original';
    let textOffset = source === (snapshot.textSource || 'original') ? snapshot.textOffset || 0 : 0;
    if (source === 'translation' && textOffset > 0) {
      // A newly prepared/replaced translation or a language change cannot inherit
      // an offset into a different text, even when the paragraph id is unchanged.
      textOffset =
        savedQuoteOffset(translations[snapshot.paragraph], textOffset, snapshot.textQuote) ?? 0;
    }
    return {
      ...snapshot,
      textSource: source,
      // Offsets belong to one source; never apply an original offset to translated text.
      textOffset,
    };
  }, [
    jumpRevision,
    layoutRevision,
    prefs.turnMode,
    prefs.scrollFlow,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.serif,
    readingMode,
    readingLanguage,
  ]);
  const focusedParagraph =
    chapter.paragraphs.find((p) => p.id === current.paragraph) || chapter.paragraphs[0];
  const focusSource =
    readingMode !== 'original' &&
    current.textSource === 'translation' &&
    translations[focusedParagraph.id]
      ? 'translation'
      : 'original';
  const focusText =
    focusSource === 'translation' ? translations[focusedParagraph.id] : focusedParagraph.text;
  let focusOffset =
    current.paragraph === focusedParagraph.id && (current.textSource || 'original') === focusSource
      ? Math.min(current.textOffset || 0, Math.max(0, focusText.length - 1))
      : 0;
  // Reader positions and exported note anchors use UTF-16, but never half an emoji.
  if (
    focusOffset > 0 &&
    /[\uD800-\uDBFF]/.test(focusText[focusOffset - 1]) &&
    /[\uDC00-\uDFFF]/.test(focusText[focusOffset] || '')
  )
    focusOffset--;
  const currentFocus: PassageSelection = selected || {
    paragraph: focusedParagraph,
    source: focusSource,
    text: focusText,
    start: focusOffset,
    end: focusOffset + safeReadingQuote(focusText, focusOffset, 1500).length,
    ...(focusSource === 'translation'
      ? { language: readingLanguage, translationKey: translationKeys[focusedParagraph.id] }
      : {}),
  };
  const percent = Math.round(readingProgress(book.chapters, current) * 100);
  const availableReferences: ReadingReference[] =
    prefs.turnMode === 'paged'
      ? pageReferences
      : [
          ...new Map(
            (paragraphReferences.get(current.paragraph) || []).map(
              (link) =>
                [
                  link.id,
                  {
                    id: link.id,
                    label: link.label,
                    origin: {
                      paragraph: current.paragraph,
                      textSource: focusSource,
                      textOffset: focusSource === 'original' ? link.start : focusOffset,
                    },
                  },
                ] as const,
            ),
          ).values(),
        ];

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const position = { ...latest.current };
    const key = JSON.stringify(position);
    if (persisted.current === key) return saveChain.current;
    persisted.current = key;
    saveChain.current = saveChain.current
      .then(() => savePosition(library.handle, book, position))
      .catch(() => {
        persisted.current = '';
        if (library.isCurrent() && !saveErrorShown.current) {
          saveErrorShown.current = true;
          notify(t('progressError'));
        }
      });
    return saveChain.current;
  }, [book, library, notify, t]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const track = (
    id: string,
    textOffset = 0,
    textSource: 'original' | 'translation' = 'original',
  ) => {
    if (!isReaderCurrent()) return;
    const entry = paragraphIndex.get(id);
    if (!entry) return;
    const text = textSource === 'translation' ? translations[id] : entry.paragraph.text;
    if (text === undefined) return;
    textOffset = Math.max(0, Math.min(text.length, Number.isFinite(textOffset) ? textOffset : 0));
    if (
      textOffset > 0 &&
      /[\uD800-\uDBFF]/.test(text[textOffset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[textOffset] || '')
    )
      textOffset--;
    const position: Position = {
      chapter: entry.chapter,
      paragraph: id,
      textOffset,
      textSource,
      textQuote: safeReadingQuote(text, textOffset),
      farthest: Math.max(latest.current.farthest, entry.chapter),
      offset: Math.min(1, textOffset / Math.max(1, text.length)),
    };
    if (JSON.stringify(position) === JSON.stringify(latest.current)) return;
    latest.current = position;
    setCurrent(position);
    if (continuous) setChapterIndex(entry.chapter);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), 350);
  };
  const viewCallback = useRef<(info: { viewableItems: ViewToken<Paragraph>[] }) => void>(() => {});
  viewCallback.current = ({ viewableItems }) => {
    visibleParagraphsChanged(
      viewableItems.filter((item) => item.isViewable).map((item) => item.item.id),
    );
    const first = viewableItems.find((item) => item.isViewable)?.item;
    // A delayed viewability callback must not replace a captured line in the
    // same paragraph with its start. Crossing paragraphs still supplies a fallback.
    if (first && readyToTrack.current && first.id !== latest.current.paragraph)
      track(
        first.id,
        0,
        readingMode === 'translation' && translations[first.id] ? 'translation' : 'original',
      );
  };
  const viewChanged = useRef((info: { viewableItems: ViewToken<Paragraph>[] }) =>
    viewCallback.current(info),
  ).current;
  const capturePosition = async (timeoutMs?: number) => {
    if (prefs.turnMode !== 'scroll' || !readyToTrack.current || !isReaderCurrent()) return false;
    const instance = capture.current;
    if (!instance) return false;
    const epoch = positionEpoch.current;
    const context = bookmarkContext.current;
    const texts = translations;
    // With no intervening movement/reflow, retain the exact semantic point that
    // was restored. Repeated +/- must not keep truncating it to each new line start.
    const point = await instance.capture({ timeoutMs, preserveRestored: true });
    if (
      !point ||
      !isReaderCurrent() ||
      !readyToTrack.current ||
      positionEpoch.current !== epoch ||
      bookmarkContext.current !== context ||
      capture.current !== instance
    )
      return false;
    const entry = paragraphIndex.get(point.paragraph);
    const source = point.textSource || 'original';
    const text = source === 'translation' ? texts[point.paragraph] : entry?.paragraph.text;
    const currentTranslation = currentText.current.translations[point.paragraph];
    const offset = point.textOffset || 0;
    if (
      !entry ||
      !text ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= text.length ||
      !point.textQuote ||
      text.slice(offset, offset + point.textQuote.length) !== point.textQuote ||
      (source === 'translation' &&
        (currentText.current.readingMode === 'original' || currentTranslation !== text)) ||
      (source === 'original' &&
        currentText.current.readingMode === 'translation' &&
        !!currentTranslation)
    )
      return false;
    track(point.paragraph, offset, source);
    return true;
  };
  const capturePositionRef = useRef(capturePosition);
  capturePositionRef.current = capturePosition;
  useEffect(() => {
    if (interacting || sheet || interactionActive.current || !library.isCurrent()) return;
    if (
      displayedTranslation.language === readingLanguage &&
      displayedTranslation.saved[readingLanguage] === translation.saved[readingLanguage] &&
      displayedTranslation.keys[readingLanguage] === translation.savedKeys[readingLanguage]
    )
      return;
    let alive = true;
    const revision = interactionRevision.current;
    void (async () => {
      if (readingMode !== 'original' && prefs.turnMode === 'scroll')
        await capturePositionRef.current(180);
      if (
        !alive ||
        interactionActive.current ||
        revision !== interactionRevision.current ||
        !library.isCurrent()
      )
        return;
      // Capture before inserting text; remount restores the same semantic reading point.
      setDisplayedTranslation({
        language: readingLanguage,
        saved: translation.saved,
        keys: translation.savedKeys,
      });
      if (readingMode !== 'original') {
        readyToTrack.current = false;
        setLayoutRevision((value) => value + 1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    translation.saved,
    translation.savedKeys,
    displayedTranslation,
    readingLanguage,
    interacting,
    sheet,
    library,
    prefs.turnMode,
    readingMode,
  ]);
  useEffect(
    () =>
      registerFlush(async () => {
        library.assertCurrent();
        await capturePositionRef.current(180);
        library.assertCurrent();
        await flushRef.current();
        if (persisted.current !== JSON.stringify(latest.current))
          throw new Error('progress_save_failed');
      }),
    [library, registerFlush],
  );
  const layoutChanges = useReaderLayoutChange({
    preferences: prefs,
    context: bookmarkContext.current,
    capture: () => capturePositionRef.current(140),
    apply: (change) => {
      invalidatePositionWork();
      if (
        prefs.turnMode === 'scroll' ||
        change.turnMode === 'scroll' ||
        change.fontSize !== undefined ||
        change.lineHeight !== undefined ||
        change.serif !== undefined
      )
        readyToTrack.current = false;
      // The current source/line is frozen before new typography reaches native Text.
      setLayoutRevision((revision) => revision + 1);
      patch(change);
    },
  });
  const invalidatePositionWork = () => {
    positionEpoch.current++;
    bookmarkContext.current += `:invalid-${positionEpoch.current}`;
    idleSaveRun.current++;
    clearTimeout(idleRetry.current);
    layoutChanges.cancel();
  };
  const saveIdlePosition = () => {
    const run = ++idleSaveRun.current;
    const context = bookmarkContext.current;
    clearTimeout(idleRetry.current);
    const current = () =>
      isReaderCurrent() && run === idleSaveRun.current && context === bookmarkContext.current;
    void capturePositionRef.current().then((saved) => {
      if (!current()) return;
      if (saved) void flushRef.current();
      else {
        // A late visible-cell layout can invalidate the first measurement. Retry
        // once after it settles, without turning idle capture into a polling loop.
        idleRetry.current = setTimeout(() => {
          if (!current()) return;
          void capturePositionRef.current().then((captured) => {
            if (captured && current()) void flushRef.current();
          });
        }, 180);
      }
    });
  };
  useEffect(() => {
    void flushRef.current();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        clearTimeout(interactionTimer.current);
        interactionSources.current.clear();
        interactionActive.current = false;
        interactionRevision.current++;
        setInteracting(false);
      } else {
        // Save the last trusted point immediately; native layout may be suspended
        // before a best-effort bounded capture finishes in the background.
        void flushRef.current();
        void capturePositionRef.current(120).then(() => void flushRef.current());
      }
    });
    return () => {
      subscription.remove();
      positionEpoch.current++;
      idleSaveRun.current++;
      clearTimeout(idleRetry.current);
      void flushRef.current();
    };
  }, []);
  useEffect(() => {
    const revoke = () => {
      alive.current = false;
      readyToTrack.current = false;
      layoutChanges.cancel();
      positionEpoch.current++;
      idleSaveRun.current++;
      clearTimeout(idleRetry.current);
      void speech.stop();
      // Already captured progress belongs to this handle even after its UI lease ends.
      void flushRef.current();
    };
    library.signal.addEventListener('abort', revoke, { once: true });
    if (!library.isCurrent()) revoke();
    return () => library.signal.removeEventListener('abort', revoke);
  }, [library, speech.stop]);
  const stop = () => {
    void speech.stop();
  };
  const isNavigationCurrent = () => isReaderCurrent() && !navigationBlock.current.blocked;
  const navigationContext = () => `${bookmarkContext.current}:${navigationBlock.current.revision}`;
  const captureReturn = async (): Promise<ReferenceReturn | null> => {
    if (!isNavigationCurrent() || !readyToTrack.current) return null;
    const context = navigationContext();
    const texts = currentText.current;
    const point =
      prefs.turnMode === 'paged'
        ? { ...latest.current }
        : await capture.current?.capture({ preserveRestored: true });
    if (
      !point ||
      !isNavigationCurrent() ||
      !readyToTrack.current ||
      context !== navigationContext()
    )
      return null;
    const entry = paragraphIndex.get(point.paragraph);
    const source = point.textSource || 'original';
    const text =
      source === 'translation' ? texts.translations[point.paragraph] : entry?.paragraph.text;
    const key =
      texts.readingMode !== 'original' && texts.translations[point.paragraph]
        ? texts.translationKeys[point.paragraph]
        : undefined;
    if (
      !entry ||
      !text ||
      (source === 'translation' &&
        (!key ||
          texts.readingMode === 'original' ||
          currentText.current.translations[point.paragraph] !== text ||
          currentText.current.translationKeys[point.paragraph] !== key))
    )
      return null;
    const offset = Math.max(0, Math.min(text.length - 1, point.textOffset || 0));
    const range = resolveQuotedRange(
      text,
      point.textQuote || safeReadingQuote(text, offset),
      offset,
    );
    if (!range) return null;
    return {
      bookId: book.id,
      position: {
        ...point,
        chapter: entry.chapter,
        textSource: source,
        textOffset: range.start,
        textQuote: safeReadingQuote(text, range.start),
        offset: range.start / text.length,
        farthest: Math.max(latest.current.farthest, entry.chapter),
      },
      original: referenceOriginal,
      reveal: revealedTranslation,
      readingOverride: { language: readingLanguage, mode: readingMode },
      language: readingLanguage,
      translationKey: key,
      preferences: { language: prefs.language, mode: prefs.mode },
    };
  };
  const pushReturn = (snapshot: ReferenceReturn) => {
    const history = referenceHistoryRef.current;
    const previous = history.at(-1);
    const same =
      previous?.position.paragraph === snapshot.position.paragraph &&
      previous.position.textSource === snapshot.position.textSource &&
      previous.position.textOffset === snapshot.position.textOffset &&
      previous.translationKey === snapshot.translationKey &&
      previous.language === snapshot.language &&
      previous.readingOverride?.mode === snapshot.readingOverride?.mode &&
      previous.original === snapshot.original;
    replaceReferenceHistory([...(same ? history.slice(0, -1) : history), snapshot]);
  };
  const stayHere = () => {
    navigationRequest.current++;
    returning.current = null;
    setReturnBusy(false);
    replaceReferenceHistory([]);
  };
  const navigate = async (
    index: number,
    paragraph = book.chapters[index]?.paragraphs[0].id,
    end = false,
    anchor?: NoteAnchor,
    quote?: string,
    guard: () => boolean = () => true,
    options: { remember?: boolean; sequential?: boolean } = {},
  ) => {
    const ticket = ++navigationRequest.current;
    const context = navigationContext();
    const owns = () =>
      isNavigationCurrent() &&
      guard() &&
      ticket === navigationRequest.current &&
      context === navigationContext();
    if (!owns()) return false;
    if (!book.chapters[index] || !paragraph) return false;
    const target = book.chapters[index].paragraphs.find((p) => p.id === paragraph);
    if (!target) return false;
    const origin = options.remember === false ? null : await captureReturn();
    if (!owns()) return false;
    if (options.remember !== false && !origin) {
      notify(t('readerPositionCaptureError'));
      return false;
    }
    let exact: Awaited<ReturnType<typeof readExactTranslation>> = null;
    try {
      if (anchor?.source === 'translation' && anchor.translationKey)
        exact = await readExactTranslation(library.handle, book.id, anchor.translationKey);
    } catch {
      if (owns()) notify(t('error'));
      return false;
    }
    if (!owns()) return false;
    invalidatePositionWork();
    const saved =
      quote !== undefined || anchor?.source === 'translation'
        ? resolveSavedPassage(target, { anchor, quote }, (key) =>
            exact?.key === key && exact.paragraphId === paragraph ? exact.text : undefined,
          )
        : undefined;
    stop();
    if (!options.sequential) setReferenceOriginal(false);
    bookmarkSource.current = null;
    setSelected(null);
    if (!options.sequential)
      setRevealedTranslation(
        saved?.source === 'translation' && exact
          ? { language: exact.language, paragraph, key: exact.key, text: exact.text }
          : null,
      );
    readyToTrack.current = false;
    const lastSource =
      readingMode !== 'original' && translations[paragraph] ? 'translation' : 'original';
    const lastText = lastSource === 'translation' ? translations[paragraph] : target.text;
    const next: Position = {
      textOffset: saved?.start ?? anchor?.start ?? (end ? Math.max(0, lastText.length - 1) : 0),
      textSource: saved?.source ?? anchor?.source ?? (end ? lastSource : 'original'),
      chapter: index,
      paragraph,
      farthest: Math.max(latest.current.farthest, index),
      offset: 0,
    };
    let override: ReadingOverride | null = null;
    if (saved) {
      override = {
        language: saved.language || prefs.language,
        mode: saved.fallback
          ? 'original'
          : saved.source === 'translation'
            ? prefs.mode === 'translation'
              ? 'translation'
              : 'bilingual'
            : prefs.mode === 'translation'
              ? 'bilingual'
              : prefs.mode,
      };
      next.textQuote = safeReadingQuote(saved.quote, 0);
      if (saved.fallback) notify(t('noteOriginalFallback'));
      else if (saved.source === 'translation') notify(t('noteTranslationOpened'));
    } else if (anchor)
      override = {
        language: prefs.language,
        mode: prefs.mode === 'translation' ? 'bilingual' : prefs.mode,
      };
    if (!options.sequential) setReadingOverride(override);
    if (origin) pushReturn(origin);
    latest.current = next;
    setCurrent(next);
    setChapterIndex(index);
    setJump(paragraph);
    setJumpToEnd(end);
    setJumpRevision((n) => n + 1);
    setSheet(null);
    void flushRef.current();
    return true;
  };
  const applyLocation = (snapshot: ReadingLocation, keepSpeech = false) => {
    if (!isNavigationCurrent()) return;
    invalidatePositionWork();
    if (!keepSpeech) stop();
    bookmarkSource.current = null;
    setSelected(null);
    readyToTrack.current = false;
    const position = {
      ...snapshot.position,
      farthest: Math.max(latest.current.farthest, snapshot.position.farthest),
    };
    latest.current = position;
    setCurrent(position);
    setChapterIndex(position.chapter);
    setJump(position.paragraph);
    setJumpToEnd(false);
    setJumpRevision((revision) => revision + 1);
    setReferenceOriginal(snapshot.original);
    setReadingOverride(snapshot.readingOverride || null);
    setRevealedTranslation(snapshot.reveal);
    setSheet(null);
    void flushRef.current();
  };
  const jumpToOriginalReference = (paragraph: string, offset: number, origin: ReferenceReturn) => {
    const entry = paragraphIndex.get(paragraph);
    if (
      !entry ||
      !entry.paragraph.text ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > entry.paragraph.text.length
    )
      return false;
    const quote = safeReadingQuote(
      entry.paragraph.text,
      Math.min(offset, entry.paragraph.text.length - 1),
    );
    const start = resolveQuotedRange(entry.paragraph.text, quote, offset)?.start;
    if (start === undefined || !isNavigationCurrent()) return false;
    pushReturn(origin);
    applyLocation({
      position: {
        chapter: entry.chapter,
        paragraph: entry.paragraph.id,
        textSource: 'original',
        textOffset: start,
        textQuote: safeReadingQuote(entry.paragraph.text, start),
        farthest: Math.max(latest.current.farthest, entry.chapter),
        offset: start / entry.paragraph.text.length,
      },
      original: true,
      reveal: null,
    });
    return true;
  };
  const readReference = (target: BookReferenceTarget, origin: ReferenceReturn) => {
    if (!isNavigationCurrent() || !target.location || referenceTargets.get(target.id) !== target)
      return;
    const entry = paragraphIndex.get(target.location.paragraphId);
    if (!entry || book.chapters[entry.chapter].id !== target.location.chapterId) return;
    navigationRequest.current++;
    jumpToOriginalReference(entry.paragraph.id, target.location.offset, origin);
  };
  const openCitation = async (
    index: number,
    paragraph: string,
    anchor: NoteAnchor,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const target = paragraphIndex.get(paragraph);
    if (
      signal.aborted ||
      !readyToTrack.current ||
      !target ||
      target.chapter !== index ||
      anchor.source !== 'original'
    )
      return false;
    const ticket = ++navigationRequest.current;
    const context = navigationContext();
    const origin = await captureReturn();
    if (
      signal.aborted ||
      !isNavigationCurrent() ||
      !origin ||
      ticket !== navigationRequest.current ||
      context !== navigationContext() ||
      !readyToTrack.current
    )
      return false;
    return jumpToOriginalReference(paragraph, anchor.start, origin);
  };
  const openReference = async (id: string, origin: ReferenceOrigin) => {
    const link = referenceLinks.get(id);
    const source = link?.source.find((range) => range.paragraphId === origin.paragraph);
    const entry = paragraphIndex.get(origin.paragraph);
    const target = link && referenceTargets.get(link.targetId);
    if (!isNavigationCurrent() || !link || !source || !entry || !target) return;
    const previous = referenceHistoryRef.current.at(-1);
    if (
      link.kind === 'backlink' &&
      target.location &&
      previous &&
      (target.location.paragraphId === previous.position.paragraph ||
        previous.referenceSources?.includes(target.location.paragraphId))
    ) {
      returnFromReference();
      return;
    }
    const ticket = ++navigationRequest.current;
    const context = navigationContext();
    const snapshot = await captureReturn();
    if (
      !isNavigationCurrent() ||
      ticket !== navigationRequest.current ||
      context !== navigationContext()
    )
      return;
    if (!snapshot) {
      notify(t('readerPositionCaptureError'));
      return;
    }
    snapshot.referenceSources = link.source.map((range) => range.paragraphId);
    if (link.kind === 'footnote' || !target.location) {
      setReferencePreview({
        kind: link.kind,
        label: entry.paragraph.text.slice(source.start, source.end),
        target,
        origin: snapshot,
      });
      setSheet('referencePreview');
    } else readReference(target, snapshot);
  };
  const restoreReturn = async (
    snapshot: ReferenceReturn,
    current: () => boolean,
    commit: () => void,
  ) => {
    if (returning.current || !isNavigationCurrent()) return;
    const operation = Symbol();
    returning.current = operation;
    setReturnBusy(true);
    const ticket = ++navigationRequest.current;
    const context = navigationContext();
    const owns = () =>
      returning.current === operation &&
      isNavigationCurrent() &&
      current() &&
      ticket === navigationRequest.current &&
      context === navigationContext();
    try {
      const resolved = await resolveReaderLocation(library, book, snapshot, {
        allowTranslation:
          snapshot.preferences.language === prefs.language &&
          snapshot.preferences.mode === prefs.mode,
        signal: library.signal,
        isCurrent: owns,
      });
      if (!owns()) return;
      if (!resolved) {
        notify(t('readerReturnUnavailable'));
        return;
      }
      applyLocation(resolved);
      commit();
      if (resolved.fallback) notify(t('readerReturnOriginalFallback'));
    } catch (error) {
      if (owns() && !(error instanceof Error && error.name === 'AbortError'))
        notify(t('readerReturnUnavailable'));
    } finally {
      if (returning.current === operation) {
        returning.current = null;
        if (isReaderCurrent()) setReturnBusy(false);
      }
    }
  };
  const returnFromReference = () => {
    const snapshot = referenceHistoryRef.current.at(-1);
    if (!snapshot) return;
    return restoreReturn(
      snapshot,
      () => referenceHistoryRef.current.at(-1) === snapshot,
      () => replaceReferenceHistory(referenceHistoryRef.current.slice(0, -1)),
    );
  };
  const openSearchHit = async (
    index: number,
    paragraph: string,
    anchor: NoteAnchor,
    quote: string,
    isCurrent: () => boolean,
  ) => {
    const ticket = ++navigationRequest.current;
    const context = navigationContext();
    try {
      const previous = searchOriginRef.current;
      const snapshot = previous || (await captureReturn());
      if (
        !isNavigationCurrent() ||
        !searchVisible.current ||
        requestedSheet.current !== 'search' ||
        ticket !== navigationRequest.current ||
        !isCurrent() ||
        context !== navigationContext()
      )
        return false;
      if (!snapshot || !readyToTrack.current) {
        notify(t('searchPositionError'));
        return false;
      }
      if (!paragraphIndex.has(paragraph)) return false;
      const origin = previous || { ...snapshot, history: [...referenceHistoryRef.current] };
      // Resolve the quoted range again against the current saved cache. A stale
      // translated result cannot apply its offsets to replacement text.
      if (!(await navigate(index, paragraph, false, anchor, quote, isCurrent, { remember: false })))
        return false;
      // A new result starts a new excursion. The independent origin retains the
      // pre-search history, not the previous result's footnote branch.
      replaceReferenceHistory([]);
      replaceSearchOrigin(origin);
      return true;
    } catch {
      if (isReaderCurrent()) notify(t('searchPositionError'));
      return false;
    }
  };
  const returnBeforeSearch = () => {
    const origin = searchOriginRef.current;
    if (!origin) return;
    return restoreReturn(
      origin,
      () => searchOriginRef.current === origin,
      () => {
        replaceReferenceHistory(origin.history);
        replaceSearchOrigin(null);
      },
    );
  };
  const addBookmark = async (): Promise<BookmarkFeedback | undefined> => {
    if (bookmarkBusy.current) return;
    if (!readyToTrack.current) {
      return { message: t('bookmarkCaptureError'), error: true };
    }
    bookmarkBusy.current = true;
    setBookmarkSaving(true);
    const context = bookmarkContext.current;
    try {
      const anchor =
        prefs.turnMode === 'paged' ? { ...latest.current } : await capture.current?.capture();
      if (!isReaderCurrent()) return;
      if (!anchor || context !== bookmarkContext.current) {
        return { message: t('bookmarkCaptureError'), error: true };
      }
      const entry = paragraphIndex.get(anchor.paragraph);
      if (!entry) return { message: t('bookmarkCaptureError'), error: true };
      const source = anchor.textSource || 'original';
      const text = source === 'translation' ? translations[anchor.paragraph] : entry.paragraph.text;
      if (!text) {
        return { message: t('bookmarkCaptureError'), error: true };
      }
      const offset = Math.max(0, Math.min(text.length - 1, anchor.textOffset || 0));
      const retained = bookmarkSource.current;
      const translationKey =
        source === 'translation'
          ? retained?.paragraph === anchor.paragraph &&
            retained.textOffset === offset &&
            retained.translationKey.split(':')[0] === readingLanguage
            ? retained.translationKey
            : translationKeys[anchor.paragraph]
          : undefined;
      const candidate: Bookmark = {
        id: Crypto.randomUUID(),
        bookId: book.id,
        label: '',
        createdAt: Date.now(),
        quote: text.slice(offset, offset + 280),
        position: {
          chapter: entry.chapter,
          paragraph: anchor.paragraph,
          textSource: source,
          textOffset: offset,
          textQuote: text.slice(offset, offset + 64),
          offset: offset / text.length,
          farthest: Math.max(latest.current.farthest, entry.chapter),
        },
        ...(translationKey ? { translationKey } : {}),
      };
      library.assertCurrent();
      const saved = await saveBookmark(library.handle, book, candidate);
      if (!isReaderCurrent()) return;
      setBookmarks((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      return { message: t(saved.id === candidate.id ? 'bookmarkSaved' : 'bookmarkExists') };
    } catch (error) {
      if (isReaderCurrent())
        return {
          message: t(
            error instanceof Error && error.message === 'bookmark_limit'
              ? 'bookmarkLimit'
              : 'error',
          ),
          error: true,
        };
    } finally {
      bookmarkBusy.current = false;
      if (isReaderCurrent()) setBookmarkSaving(false);
    }
  };
  const openBookmark = async (bookmark: Bookmark) => {
    const ticket = ++navigationRequest.current;
    const context = navigationContext();
    const owns = () =>
      isNavigationCurrent() &&
      ticket === navigationRequest.current &&
      context === navigationContext();
    const entry = paragraphIndex.get(bookmark.position.paragraph);
    if (!entry) return;
    const origin = await captureReturn();
    if (!owns()) return;
    if (!origin) {
      notify(t('readerPositionCaptureError'));
      return;
    }
    const position = { ...bookmark.position };
    let override: ReadingOverride = { language: prefs.language, mode: 'original' };
    let fallback = false;
    let reveal: RevealedTranslation | null = null;
    if (position.textSource === 'translation') {
      const language = bookmark.translationKey?.split(':')[0] || '';
      let exact: Awaited<ReturnType<typeof readExactTranslation>> = null;
      try {
        if (bookmark.translationKey)
          exact = await readExactTranslation(library.handle, book.id, bookmark.translationKey);
      } catch {
        if (owns()) notify(t('error'));
        return;
      }
      if (!owns()) return;
      const text =
        exact?.paragraphId === position.paragraph && exact.language === language
          ? exact.text
          : undefined;
      const quote = position.textQuote;
      const offset = savedQuoteOffset(text, position.textOffset || 0, quote);
      if (offset !== null && text && bookmark.translationKey) {
        position.textOffset = offset;
        position.offset = offset / text.length;
        override = { language, mode: prefs.mode === 'translation' ? 'translation' : 'bilingual' };
        bookmarkSource.current = {
          paragraph: position.paragraph,
          textOffset: offset,
          translationKey: bookmark.translationKey,
        };
        reveal = { language, paragraph: position.paragraph, key: bookmark.translationKey, text };
      } else {
        fallback = true;
        position.textSource = 'original';
        position.textOffset = 0;
        position.offset = 0;
        position.textQuote = entry.paragraph.text.slice(0, 64);
      }
    }
    if (!owns()) return;
    if (position.textSource !== 'translation') bookmarkSource.current = null;
    pushReturn(origin);
    applyLocation({ position, original: false, reveal, readingOverride: override });
    if (fallback) notify(t('bookmarkOriginalFallback'));
    else if (position.textSource === 'translation') notify(t('bookmarkTranslationOpened'));
  };
  const openSpeech = async (passage?: PassageSelection) => {
    if (noteBusy.current) return;
    // Reopening the player should not replace the frozen range currently playing.
    if (speechActive && !passage) {
      setSheet('speech');
      return;
    }
    if (passage) {
      const entry = paragraphIndex.get(passage.paragraph.id);
      if (!entry) return;
      stop();
      setSpeechSetup({
        position: {
          chapter: entry.chapter,
          paragraph: passage.paragraph.id,
          textSource: passage.source,
          textOffset: passage.start,
          farthest: latest.current.farthest,
        },
        scope: 'selection',
        source: passage.source,
        language: passage.language || readingLanguage,
        selection: passage,
      });
    } else {
      const context = bookmarkContext.current;
      const anchor =
        prefs.turnMode === 'paged' ? { ...latest.current } : await capture.current?.capture();
      if (!isReaderCurrent()) return;
      if (!anchor || context !== bookmarkContext.current) {
        notify(t('speechPositionError'));
        return;
      }
      const entry = paragraphIndex.get(anchor.paragraph);
      if (!entry) return;
      // A fresh range must not retain the completed run's preview or controls.
      stop();
      setSpeechSetup({
        position: { ...anchor, chapter: entry.chapter, farthest: latest.current.farthest },
        scope: 'chapter',
        source:
          readingMode === 'translation'
            ? 'translation'
            : readingMode === 'original'
              ? 'original'
              : anchor.textSource || 'original',
        language: readingLanguage,
      });
    }
    setSheet('speech');
  };
  const startSpeech = () => {
    speechLanguage.current = speechSetup.language;
    void speech.start(speechPlan, prefs.speechRate);
  };
  const showSpeechPassage = async () => {
    const spoken = speech.state.current;
    if (!spoken?.text) return;
    const context = bookmarkContext.current;
    const entry = paragraphIndex.get(spoken.paragraphId);
    let reveal: RevealedTranslation | null = null;
    let text = entry?.paragraph.text;
    if (spoken.source === 'translation') {
      try {
        const exact = spoken.translationKey
          ? await readExactTranslation(library.handle, book.id, spoken.translationKey)
          : null;
        text = exact?.paragraphId === spoken.paragraphId ? exact.text : undefined;
        if (exact && text)
          reveal = { language: exact.language, paragraph: exact.paragraphId, key: exact.key, text };
      } catch {
        if (isReaderCurrent()) notify(t('speechTextChanged'));
        return;
      }
    }
    if (
      !isReaderCurrent() ||
      context !== bookmarkContext.current ||
      currentSpeech.current?.paragraphId !== spoken.paragraphId ||
      currentSpeech.current.translationKey !== spoken.translationKey ||
      currentSpeech.current.text !== spoken.text
    )
      return;
    // A voice run holds a frozen translation. Do not apply its offsets to a replacement edition.
    if (!entry || text !== spoken.text) {
      notify(t('speechTextChanged'));
      return;
    }
    let textOffset = Math.max(0, Math.min(text.length - 1, spoken.textOffset));
    const code = text.charCodeAt(textOffset),
      previous = text.charCodeAt(textOffset - 1);
    if (code >= 0xdc00 && code <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) textOffset--;
    bookmarkSource.current = null;
    replaceReferenceHistory([]);
    applyLocation(
      {
        position: {
          chapter: entry.chapter,
          paragraph: spoken.paragraphId,
          textSource: spoken.source,
          textOffset,
          textQuote: text.slice(textOffset, textOffset + 64),
          farthest: Math.max(latest.current.farthest, entry.chapter),
          offset: textOffset / Math.max(1, text.length),
        },
        original: false,
        reveal,
        readingOverride: {
          language: speechLanguage.current,
          mode: spoken.source === 'original' ? 'original' : 'bilingual',
        },
      },
      true,
    );
  };
  const passageIsCurrent = (passage: PassageSelection) => {
    const paragraph = paragraphIndex.get(passage.paragraph.id)?.paragraph;
    if (passage.source === 'translation' && (!passage.language || !passage.translationKey))
      return false;
    const text =
      passage.source === 'translation'
        ? (passage.language === readingLanguage
            ? translations
            : translation.saved[passage.language!] || emptyTranslations)[passage.paragraph.id]
        : paragraph?.text;
    const keys =
      passage.language === readingLanguage
        ? translationKeys
        : translation.savedKeys[passage.language!] || emptyTranslations;
    if (passage.source === 'translation' && keys[passage.paragraph.id] !== passage.translationKey)
      return false;
    if (!paragraph || text !== passage.text) return false;
    const range = resolveQuotedRange(text, text.slice(passage.start, passage.end), passage.start);
    return range?.start === passage.start && range?.end === passage.end;
  };
  const adjustSelection = (returnTo: 'actions' | 'note') => {
    if (!selected || noteBusy.current) return;
    if (!passageIsCurrent(selected)) {
      setNoteError(t('selectionChanged'));
      return;
    }
    setNoteError('');
    setSelectionEditor({ bookId: book.id, passage: selected, returnTo });
    setSheet('selection');
  };
  const addNote = async (text: string, passage = selected, dismiss = true): Promise<boolean> => {
    if (!isReaderCurrent() || !passage || noteBusy.current) return false;
    if (
      passage.source === 'original'
        ? !passageIsCurrent(passage)
        : !passage.translationKey ||
          !passage.language ||
          !paragraphIndex.has(passage.paragraph.id) ||
          !Number.isSafeInteger(passage.start) ||
          !Number.isSafeInteger(passage.end) ||
          passage.start < 0 ||
          passage.end <= passage.start ||
          passage.end > passage.text.length
    ) {
      if (dismiss) setNoteError(t('selectionChanged'));
      return false;
    }
    // Keep saved notes compatible with reading-pack limits; never shorten a quote.
    if (passage.end - passage.start > 20000) {
      if (dismiss) setNoteError(t('selectionNoteTooLong'));
      return false;
    }
    noteBusy.current = true;
    setNoteError('');
    setSaving(true);
    const note: Note = {
      id: Crypto.randomUUID(),
      bookId: book.id,
      paragraphId: passage.paragraph.id,
      quote: passage.text.slice(passage.start, passage.end),
      anchor: {
        source: passage.source,
        start: passage.start,
        end: passage.end,
        ...(passage.source === 'translation'
          ? {
              translationKey: passage.translationKey,
            }
          : {}),
      },
      text: text.trim(),
      createdAt: Date.now(),
    };
    try {
      if (passage.source === 'translation') {
        const exact = await readExactTranslation(library.handle, book.id, passage.translationKey!);
        library.assertCurrent();
        if (!isReaderCurrent()) return false;
        if (
          !exact ||
          exact.paragraphId !== passage.paragraph.id ||
          exact.language !== passage.language ||
          exact.text !== passage.text
        )
          throw new Error('selection_changed');
      }
      await measured('note.save', () => saveNote(library.handle, note));
      if (!isReaderCurrent()) return true;
      setNotes((old) => [note, ...old]);
      if (dismiss) setSheet(null);
      setNoteText('');
      notify(t(text.trim() ? 'saved' : 'savedHighlight'));
      return true;
    } catch {
      if (isReaderCurrent() && dismiss) setNoteError(t('noteSavedError'));
      return false;
    } finally {
      noteBusy.current = false;
      if (isReaderCurrent()) setSaving(false);
    }
  };
  const openVersions = (passage?: PassageSelection) => {
    if (!isReaderCurrent() || noteBusy.current) return;
    setVersionTarget({
      paragraphId: passage?.paragraph.id || current.paragraph,
      language:
        passage?.source === 'translation' ? passage.language || readingLanguage : readingLanguage,
    });
    setSheet('translationVersions');
  };
  const chooseVersion = async (key: string, guard: () => boolean) => {
    if (!isReaderCurrent() || !guard()) return;
    const context = bookmarkContext.current;
    const owns = () => isReaderCurrent() && guard() && context === bookmarkContext.current;
    if (prefs.turnMode === 'scroll' && !(await capturePositionRef.current(300)))
      throw new Error('position_unavailable');
    if (!owns()) return;
    const position = { ...latest.current };
    const version = await selectParagraphTranslationVersion(library, book.id, key, {
      signal: library.signal,
      isCurrent: owns,
    });
    if (!owns()) return;
    const refreshed = await translation.refresh();
    if (!owns()) return;
    if (!refreshed) throw new Error('translation_refresh_failed');
    const retainedReveal =
      revealedTranslation?.language === version.language &&
      revealedTranslation.paragraph !== version.paragraphId
        ? revealedTranslation
        : null;
    const displayedText =
      retainedReveal?.paragraph === position.paragraph
        ? retainedReveal.text
        : refreshed[version.language]?.[position.paragraph];
    rebaseTranslatedPosition(position, displayedText);
    stop();
    invalidatePositionWork();
    bookmarkSource.current = null;
    setSelected(null);
    setRevealedTranslation(retainedReveal);
    setReferenceOriginal(false);
    setReadingOverride({
      language: version.language,
      mode: readingMode === 'original' ? 'bilingual' : readingMode,
    });
    latest.current = position;
    setCurrent(position);
    readyToTrack.current = false;
    setJump(position.paragraph);
    setJumpRevision((value) => value + 1);
    setLayoutRevision((value) => value + 1);
    setSheet(null);
    void flushRef.current();
  };
  const rebaseTranslatedPosition = (position: Position, translatedText?: string) => {
    if (position.textSource !== 'translation') return;
    if (!translatedText) {
      position.textSource = 'original';
      position.textOffset = 0;
      position.textQuote = undefined;
      position.offset = 0;
      return;
    }
    position.textOffset =
      savedQuoteOffset(translatedText, position.textOffset || 0, position.textQuote) ?? 0;
    position.textQuote = safeReadingQuote(translatedText, position.textOffset);
    position.offset = position.textOffset / Math.max(1, translatedText.length);
  };
  const changeReadingLanguage = (change: Partial<BookReadingPreferences>) => {
    if (!isReaderCurrent()) return;
    const next = {
      language: readingLanguage,
      mode: readingOverride?.mode || prefs.mode,
      ...change,
    };
    const position = { ...latest.current };
    rebaseTranslatedPosition(
      position,
      next.mode === 'original' ? undefined : translation.saved[next.language]?.[position.paragraph],
    );
    invalidatePositionWork();
    stop();
    bookmarkSource.current = null;
    setRevealedTranslation(null);
    setReferenceOriginal(false);
    setReadingOverride(null);
    latest.current = position;
    setCurrent(position);
    readyToTrack.current = false;
    setJump(position.paragraph);
    setJumpRevision((value) => value + 1);
    setLayoutRevision((value) => value + 1);
    patch(next);
  };
  const finishReading = async (dismiss = false) => {
    if (!isReaderCurrent()) return;
    try {
      await markFinished(library.handle, book.id, true);
      if (!isReaderCurrent()) return;
      if (dismiss) setSheet(null);
      notify(t('finished'));
    } catch {
      if (isReaderCurrent()) notify(t('error'));
    }
  };
  const exit = async () => {
    if (!isReaderCurrent() || exiting.current) return;
    exiting.current = true;
    invalidatePositionWork();
    const epoch = positionEpoch.current;
    stop();
    try {
      await capturePositionRef.current(160);
      if (!isReaderCurrent() || epoch !== positionEpoch.current) return;
      invalidatePositionWork();
      await flushRef.current();
      if (isReaderCurrent() && positionEpoch.current === epoch + 1) close();
    } finally {
      exiting.current = false;
    }
  };
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
  const contentsScope = JSON.stringify([
    book.id,
    hasPdfContents && pdfPages ? 'pages' : 'chapters',
  ]);
  const contents = useMemo(() => {
    const chapters = new Map(book.chapters.map((item, index) => [item.id, index]));
    return (hasPdfContents && pdfPages ? pageContents : chapterContents).flatMap((item, order) => {
      const index = chapters.get(item.chapterId);
      const paragraph = paragraphIndex.get(item.paragraphId);
      if (index === undefined || !paragraph || paragraph.chapter !== index) return [];
      return [
        {
          ...item,
          chapter: index,
          offset: paragraph.offset,
          order,
          key: `${item.chapterId}:${item.paragraphId}:${order}`,
          sourcePage: hasPdfContents && !pdfPages ? book.chapters[index].sourcePage : undefined,
        },
      ];
    });
  }, [book, paragraphIndex, chapterContents, pageContents, hasPdfContents, pdfPages]);
  const activeContentKey = useMemo(() => {
    const position = paragraphIndex.get(current.paragraph);
    if (!position) return undefined;
    let active: (typeof contents)[number] | undefined;
    for (const entry of contents) {
      if (
        entry.chapter > position.chapter ||
        (entry.chapter === position.chapter && entry.offset > position.offset) ||
        (!(hasPdfContents && !pdfPages) && entry.chapter !== position.chapter)
      )
        continue;
      // A nested heading is active only after its own paragraph is reached. When
      // parent/child anchors coincide, select the deepest entry rather than the whole chapter.
      if (
        !active ||
        entry.chapter > active.chapter ||
        (entry.chapter === active.chapter &&
          (entry.offset > active.offset ||
            (entry.offset === active.offset && entry.depth >= active.depth)))
      )
        active = entry;
    }
    return active?.key;
  }, [contents, current.paragraph, paragraphIndex, hasPdfContents, pdfPages]);
  return (
    <AppContext.Provider value={{ ...app, preferences: prefs, patch }}>
      <View
        style={{ flex: 1, backgroundColor: colors.background }}
        onTouchStart={() => readingInteraction(true, 'touch')}
        onTouchEnd={() => readingInteraction(false, 'touch')}
        onTouchCancel={() => readingInteraction(false, 'touch')}
      >
        <View style={{ height: 54, paddingHorizontal: 28, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
            {chapterTitle}
          </Text>
          {sourcePageLabel && chapterNavigation.current?.kind === 'chapter' && (
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 10, marginTop: 3 }}>
              {sourcePageLabel}
            </Text>
          )}
        </View>
        {toolsVisible && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 54,
              zIndex: 4,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              borderBottomWidth: 0.5,
              borderColor: colors.border,
            }}
          >
            <IconButton icon="chevron-back" label={t('back')} onPress={() => void exit()} />
            <Text numberOfLines={1} style={{ flex: 1, color: colors.muted, fontSize: 13 }}>
              {book.title}
            </Text>
            {speechActive && (
              <IconButton
                icon="headset-outline"
                label={t('speechControls')}
                active
                onPress={() => void openSpeech()}
              />
            )}
            <IconButton
              icon="ellipsis-horizontal"
              label={t('more')}
              onPress={() => setSheet('bookTools')}
            />
          </View>
        )}
        <View style={{ paddingHorizontal: 28 }}>
          <TranslationStatus
            status={translation.loadError ? 'error' : translation.status}
            progress={translation.progress}
            canRetry={translation.canRetry}
            retry={translation.retry}
          />
        </View>
        {prefs.turnMode === 'paged' ? (
          <PaginatedChapter
            key={`${chapterIndex}:${jump}:${jumpRevision}`}
            book={book}
            chapter={chapter}
            translations={translations}
            translationKeys={translationKeys}
            readingMode={readingMode}
            readingLanguage={readingLanguage}
            onVisibleParagraphs={visibleParagraphsChanged}
            onInteractionChange={readingInteraction}
            onReadyChange={(ready) => {
              if (isReaderCurrent()) readyToTrack.current = ready;
            }}
            onImage={openImage}
            onReference={openReference}
            onReferences={(references) =>
              setPageReferences((previous) =>
                JSON.stringify(previous) === JSON.stringify(references) ? previous : references,
              )
            }
            anchor={latest.current}
            startAtEnd={jumpToEnd}
            notes={notes}
            onPosition={(id, offset, source) => {
              if (!isReaderCurrent()) return;
              setJumpToEnd(false);
              track(id, offset, source);
            }}
            onPage={(page, total) => {
              if (!isReaderCurrent()) return;
              setPageInfo((previous) =>
                previous.page === page && previous.total === total ? previous : { page, total },
              );
            }}
            onTap={() => setToolsVisible((v) => !v)}
            onSelect={(selection) => {
              if (!isReaderCurrent()) return;
              setSelected(selection);
              setNoteText('');
              setSheet('actions');
            }}
            onBoundary={(direction) => {
              if (!isReaderCurrent()) return;
              if (chapterIndex + direction >= 0 && chapterIndex + direction < book.chapters.length)
                navigate(
                  chapterIndex + direction,
                  direction < 0 ? book.chapters[chapterIndex - 1].paragraphs.at(-1)!.id : undefined,
                  direction < 0,
                  undefined,
                  undefined,
                  undefined,
                  { remember: false, sequential: true },
                );
              else if (direction === 1) {
                setToolsVisible(true);
                setSheet('progress');
              }
            }}
          />
        ) : (
          <AnchoredParagraphList
            key={`${continuous ? 'continuous' : chapterIndex}:${jump}:${jumpRevision}:${layoutRevision}:${readingMode}:${readingLanguage}:${prefs.fontSize}:${prefs.lineHeight}:${prefs.serif}:${book.media?.revision || ''}:${book.references?.revision || ''}`}
            items={scrollParagraphs}
            captureRef={capture}
            anchor={scrollAnchor}
            onRestoring={() => {
              readyToTrack.current = false;
            }}
            onRestored={() => {
              readyToTrack.current = true;
            }}
            onScrollBeginDrag={() => readingInteraction(true)}
            onMomentumScrollBegin={() => readingInteraction(true)}
            onScrollIdle={() => {
              readingInteraction(false);
              saveIdlePosition();
            }}
            keyExtractor={(p) => p.id}
            onViewableItemsChanged={viewChanged}
            viewabilityConfig={{ viewAreaCoveragePercentThreshold: 1, minimumViewTime: 180 }}
            contentContainerStyle={{
              paddingHorizontal: 26,
              paddingBottom: 64,
              maxWidth: 790,
              width: '100%',
              alignSelf: 'center',
            }}
            ListHeaderComponent={
              !continuous && (pdf || (readingMode !== 'translation' && !chapterStartsWithTitle)) ? (
                <Pressable
                  onPress={() => setToolsVisible((v) => !v)}
                  style={{ paddingTop: pdf ? 8 : 24, paddingBottom: pdf ? 14 : 26, gap: 14 }}
                >
                  {pdf && (
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {sourcePageLabel || chapter.title}
                    </Text>
                  )}
                  {readingMode !== 'translation' && !pdf && !chapterStartsWithTitle && (
                    <Text
                      accessibilityRole="header"
                      style={{
                        color: colors.ink,
                        fontFamily: prefs.serif ? 'Georgia' : undefined,
                        fontSize: 30,
                        lineHeight: 39,
                      }}
                    >
                      {chapter.title}
                    </Text>
                  )}
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const translation = translations[item.id];
              const entry = paragraphIndex.get(item.id);
              const itemChapter = book.chapters[entry?.chapter ?? chapterIndex];
              const sourceIsChapterTitle =
                entry?.first &&
                item.kind === 'heading' &&
                item.text.trim() === itemChapter.title.trim();
              const showOriginal = readingMode !== 'translation';
              const paragraphText = (source: 'original' | 'translation', text: string) => (
                <Pressable
                  key={source}
                  accessibilityRole="button"
                  accessibilityLabel={text}
                  accessibilityHint={t('noteHint')}
                  onPress={() => setToolsVisible((visible) => !visible)}
                  onLongPress={() => {
                    setSelected({
                      paragraph: item,
                      source,
                      text,
                      start: 0,
                      end: text.length,
                      language: readingLanguage,
                      ...(source === 'translation'
                        ? { translationKey: translationKeys[item.id] }
                        : {}),
                    });
                    setNoteText('');
                    setSheet('actions');
                  }}
                >
                  <AnchorPassageText
                    paragraph={item.id}
                    source={source}
                    text={text}
                    style={{
                      color:
                        source === 'translation' && readingMode === 'bilingual'
                          ? colors.muted
                          : colors.ink,
                      fontSize:
                        source === 'translation' && readingMode === 'bilingual'
                          ? prefs.fontSize - 2
                          : item.kind === 'heading'
                            ? prefs.fontSize + 3
                            : prefs.fontSize,
                      lineHeight: prefs.fontSize * prefs.lineHeight,
                      fontFamily:
                        source === 'original'
                          ? item.kind === 'code'
                            ? 'Menlo'
                            : prefs.serif
                              ? 'Georgia'
                              : undefined
                          : undefined,
                      fontStyle: item.kind === 'quote' ? 'italic' : 'normal',
                      fontWeight: item.kind === 'heading' ? '600' : '400',
                      textAlign:
                        source === 'original' && book.pageDirection === 'rtl' ? 'right' : 'left',
                      writingDirection:
                        source === 'original' && book.pageDirection === 'rtl' ? 'rtl' : 'auto',
                    }}
                  >
                    <HighlightedPassage
                      text={text}
                      ranges={passageRanges(notes, item.id, text, source, translationKeys[item.id])}
                      links={source === 'original' ? paragraphReferences.get(item.id) : undefined}
                      onLink={(link) =>
                        openReference(link.id, {
                          paragraph: item.id,
                          textOffset: link.start,
                          textSource: 'original',
                        })
                      }
                      onLinkLongPress={() => {
                        setSelected({
                          paragraph: item,
                          source,
                          text,
                          start: 0,
                          end: text.length,
                          language: readingLanguage,
                          ...(source === 'translation'
                            ? { translationKey: translationKeys[item.id] }
                            : {}),
                        });
                        setNoteText('');
                        setSheet('actions');
                      }}
                    />
                  </AnchorPassageText>
                </Pressable>
              );
              return (
                <View style={{ marginBottom: 22, gap: 13 }}>
                  {continuous && pdf && entry?.first && (
                    <Text style={{ color: colors.muted, paddingTop: 8, fontSize: 11 }}>
                      {itemChapter.sourcePage
                        ? t('pdfPage', { n: itemChapter.sourcePage })
                        : itemChapter.title}
                    </Text>
                  )}
                  {readingMode !== 'translation' &&
                    continuous &&
                    !pdf &&
                    entry?.first &&
                    !sourceIsChapterTitle && (
                      <Text
                        accessibilityRole="header"
                        style={{
                          color: colors.ink,
                          paddingTop: 24,
                          paddingBottom: 18,
                          fontSize: 30,
                          lineHeight: 39,
                          fontFamily: prefs.serif ? 'Georgia' : undefined,
                        }}
                      >
                        {itemChapter.title}
                      </Text>
                    )}
                  {imagesByParagraph.get(item.id)?.before.map((image) => (
                    <BookImage key={image.placement.id} image={image} open={openImage} />
                  ))}
                  {showOriginal && paragraphText('original', item.text)}
                  {readingMode !== 'original' &&
                    translation &&
                    paragraphText('translation', translation)}
                  {readingMode !== 'original' && !!item.text.trim() && !translation && (
                    <Text
                      style={{
                        color: colors.muted,
                        fontSize: 13,
                        lineHeight: 24,
                        paddingVertical: 12,
                      }}
                    >
                      {t('translationPending')}
                    </Text>
                  )}
                  {imagesByParagraph.get(item.id)?.after.map((image) => (
                    <BookImage key={image.placement.id} image={image} open={openImage} />
                  ))}
                  {!!paragraphReferences.get(item.id)?.length && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        const source =
                          readingMode === 'translation' && translation ? 'translation' : 'original';
                        const references = new Map(
                          (paragraphReferences.get(item.id) || []).map(
                            (link) =>
                              [
                                link.id,
                                {
                                  id: link.id,
                                  label: link.label,
                                  origin: {
                                    paragraph: item.id,
                                    textSource: source,
                                    textOffset:
                                      source === 'original'
                                        ? link.start
                                        : current.paragraph === item.id &&
                                            current.textSource === 'translation'
                                          ? current.textOffset || 0
                                          : 0,
                                  },
                                },
                              ] as const,
                          ),
                        );
                        openReferenceChoices([...references.values()]);
                      }}
                      style={{ alignSelf: 'flex-start', paddingVertical: 8 }}
                    >
                      <Text style={{ color: colors.accent, fontSize: 12 }}>
                        {t('bookReferences')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            }}
            // FlatList mounts its footer outside the visible row window. Do not expose
            // a finished-book announcement to accessibility while reading an earlier chapter.
            ListFooterComponent={
              <View style={{ gap: 18, paddingTop: 10 }}>
                {!continuous && chapterIndex + 1 < book.chapters.length ? (
                  <Button
                    onPress={() =>
                      navigate(
                        chapterIndex + 1,
                        undefined,
                        false,
                        undefined,
                        undefined,
                        undefined,
                        {
                          remember: false,
                          sequential: true,
                        },
                      )
                    }
                    secondary
                    icon="arrow-forward"
                  >
                    {t(pdf ? 'nextOriginalPage' : 'next')}
                  </Button>
                ) : chapterIndex === book.chapters.length - 1 ? (
                  <>
                    <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('end')}</Text>
                    <Button onPress={() => void finishReading()} icon="checkmark">
                      {t('markFinished')}
                    </Button>
                  </>
                ) : null}
              </View>
            }
          />
        )}
        {sheet === 'image' && selectedImage && (
          <BookImageViewer
            key={selectedImage.placement.id}
            image={selectedImage}
            {...sheetProps('image')}
            close={() => setSheet(null)}
          />
        )}
        <View
          pointerEvents={toolsVisible ? 'none' : 'auto'}
          accessibilityElementsHidden={toolsVisible}
          importantForAccessibility={toolsVisible ? 'no-hide-descendants' : 'auto'}
          style={{
            height: 32,
            paddingHorizontal: 27,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 10, color: colors.muted }}>
            {prefs.turnMode === 'paged'
              ? t('pageNumber', pageInfo)
              : `${chapterIndex + 1} / ${book.chapters.length}`}
          </Text>
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
            {!toolsVisible && searchOrigin && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSheet('search')}
                style={{ padding: 7 }}
              >
                <Text style={{ fontSize: 11, color: colors.accent }}>
                  {t('searchReturnResults')}
                </Text>
              </Pressable>
            )}
            {!toolsVisible && !!referenceHistory.length && (
              <ReaderReturnActions
                compact
                busy={returnBusy}
                onReturn={returnFromReference}
                onStay={stayHere}
              />
            )}
            {!toolsVisible && prefs.turnMode === 'paged' && !!pageReferences.length && (
              <Pressable
                accessibilityRole="button"
                onPress={() => openReferenceChoices(pageReferences)}
                style={{ padding: 7 }}
              >
                <Text style={{ fontSize: 11, color: colors.accent }}>{t('bookReferences')}</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(toolsVisible ? 'hideTools' : 'showTools')}
            onPress={() => setToolsVisible((v) => !v)}
            style={{ paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <Text style={{ fontSize: 10, color: colors.muted }}>
              {t('progress', { n: percent })}
            </Text>
          </Pressable>
        </View>
        {toolsVisible && (
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 4,
              backgroundColor: colors.surface,
              borderTopWidth: 0.5,
              borderColor: colors.border,
            }}
          >
            {(!!referenceHistory.length || !!availableReferences.length || !!searchOrigin) && (
              <View
                style={{
                  flexDirection: 'row',
                  borderBottomWidth: 0.5,
                  borderColor: colors.border,
                  paddingHorizontal: 12,
                }}
              >
                {searchOrigin && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSheet('search')}
                    style={{ flex: 1, minHeight: 44, padding: 10, justifyContent: 'center' }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 12, textAlign: 'center' }}>
                      {t('searchReturnResults')}
                    </Text>
                  </Pressable>
                )}
                {!!referenceHistory.length && (
                  <ReaderReturnActions
                    busy={returnBusy}
                    onReturn={returnFromReference}
                    onStay={stayHere}
                  />
                )}
                {!!availableReferences.length && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openReferenceChoices(availableReferences)}
                    style={{ flex: 1, minHeight: 44, padding: 10, justifyContent: 'center' }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 12, textAlign: 'center' }}>
                      {t('bookReferences')}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-around',
                paddingVertical: 10,
              }}
            >
              {[
                { sheet: 'contents', icon: 'list-outline', label: 'chapters' },
                { sheet: 'notes', icon: 'create-outline', label: 'notes' },
                { sheet: 'language', icon: 'language-outline', label: 'readingLanguage' },
                { sheet: 'appearance', icon: 'text-outline', label: 'typesetting' },
              ].map((item) => (
                <Pressable
                  key={item.sheet}
                  accessibilityRole="button"
                  onPress={() => setSheet(item.sheet as typeof sheet)}
                  style={{ alignItems: 'center', gap: 5, minWidth: 52 }}
                >
                  <Icon
                    name={item.icon as import('../components/ui').IconName}
                    size={23}
                    color={colors.muted}
                  />
                  <Text style={{ color: colors.muted, fontSize: 10 }}>
                    {t(item.label as import('../i18n').TextKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {sheet === 'selection' && selectionEditor && (
          <PassageSelectionSheet
            {...sheetProps('selection')}
            selection={selectionEditor.passage}
            close={() => {
              const target = selectionEditor?.returnTo;
              if (target) setSheet(target);
            }}
            onConfirm={(passage) => {
              if (!selectionEditor) return;
              const target = selectionEditor.returnTo;
              if (selectionEditor.bookId === book.id && passageIsCurrent(passage)) {
                setSelected(passage);
                setNoteError('');
              } else setNoteError(t('selectionChanged'));
              setSheet(target);
            }}
          />
        )}
        <AssistantSheet
          book={book}
          position={current}
          focus={currentFocus}
          {...sheetProps('assistant')}
          close={() => setSheet(null)}
          open={openCitation}
          save={(answer, focus) => addNote(answer, focus, false)}
        />
        <BookmarksSheet
          book={book}
          bookmarks={bookmarks}
          {...sheetProps('bookmarks')}
          loading={bookmarksLoading}
          saving={bookmarkSaving}
          close={() => setSheet(null)}
          add={addBookmark}
          open={openBookmark}
          rename={async (bookmark, label) => {
            library.assertCurrent();
            try {
              await renameBookmark(library.handle, book, bookmark.id, label, bookmark);
              if (isReaderCurrent())
                setBookmarks((items) =>
                  items.map((item) => (item.id === bookmark.id ? { ...item, label } : item)),
                );
            } catch (error) {
              const items = await listBookmarks(library.handle, book);
              if (isReaderCurrent()) setBookmarks(items);
              throw error;
            }
          }}
          remove={async (bookmark) => {
            library.assertCurrent();
            try {
              await removeBookmark(library.handle, book, bookmark.id, bookmark);
              if (isReaderCurrent())
                setBookmarks((items) => items.filter((item) => item.id !== bookmark.id));
            } catch (error) {
              const items = await listBookmarks(library.handle, book);
              if (isReaderCurrent()) setBookmarks(items);
              throw error;
            }
          }}
        />
        {sheet === 'referenceList' && referenceChoices && (
          <ReferenceListSheet
            references={referenceChoices}
            open={(reference) => openReference(reference.id, reference.origin)}
            {...sheetProps('referenceList')}
            close={() => setSheet(null)}
          />
        )}
        {sheet === 'referencePreview' && referencePreview && (
          <ReferencePreviewSheet
            book={book}
            target={referencePreview.target}
            label={referencePreview.label}
            kind={referencePreview.kind}
            {...sheetProps('referencePreview')}
            close={() => setSheet(null)}
            read={
              referencePreview.target.location
                ? () => readReference(referencePreview.target, referencePreview.origin)
                : undefined
            }
          />
        )}
        <BookSearchSheet
          book={book}
          translations={translations}
          translationKeys={translationKeys}
          language={readingLanguage}
          {...sheetProps('search')}
          close={() => setSheet(null)}
          open={openSearchHit}
          returning={returnBusy}
          returnToReading={searchOrigin ? returnBeforeSearch : undefined}
        />
        {sheet === 'pdfOriginal' && isPdfBook(book) && (
          <PdfOriginalSheet
            {...sheetProps('pdfOriginal')}
            bookId={book.id}
            title={book.title}
            sourcePage={chapter.sourcePage || 1}
            close={() => setSheet(null)}
            canReadPage={(page) => book.chapters.some((item) => item.sourcePage === page)}
            onReadPage={(page, evidence) => {
              if (!isNavigationCurrent()) return;
              const hit = evidence ? resolvePdfTextEvidence(book, page, evidence) : null;
              if (hit) {
                // PDF text offsets belong to its extraction engine. Only a verified
                // quote in our immutable paragraph may become a reader anchor.
                void navigate(
                  hit.chapter,
                  hit.paragraph,
                  false,
                  { source: 'original', start: hit.start, end: hit.end },
                  hit.quote,
                );
                return;
              }
              // Checking this page's source should keep the exact text position and visual page.
              if (page === chapter.sourcePage) {
                setSheet(null);
                return;
              }
              const index = book.chapters.findIndex((item) => item.sourcePage === page);
              const paragraph = book.chapters[index]?.paragraphs[0];
              if (paragraph) navigate(index, paragraph.id);
            }}
          />
        )}
        <Sheet {...sheetProps('bookTools')} title={book.title} close={() => setSheet(null)}>
          <Button secondary icon="bookmark-outline" onPress={() => setSheet('bookmarks')}>
            {t('bookmarks')}
          </Button>
          <Button secondary icon="headset-outline" onPress={() => void openSpeech()}>
            {t(speechActive ? 'speechControls' : 'listen')}
          </Button>
          {!!referenceHistory.length && (
            <ReaderReturnActions
              busy={returnBusy}
              onReturn={returnFromReference}
              onStay={stayHere}
            />
          )}
          {!!availableReferences.length && (
            <Button
              secondary
              icon="link-outline"
              onPress={() => {
                openReferenceChoices(availableReferences);
              }}
            >
              {t('bookReferences')}
            </Button>
          )}
          <Button
            icon="sparkles-outline"
            onPress={() => {
              setSelected(null);
              setSheet('assistant');
            }}
          >
            {t('aiCompanion')}
          </Button>
          <Button icon="search-outline" onPress={() => setSheet('search')}>
            {t('searchBook')}
          </Button>
          {isPdfBook(book) && (
            <Button secondary icon="document-text-outline" onPress={() => setSheet('pdfOriginal')}>
              {t('pdfOriginal')}
            </Button>
          )}
          <Button secondary icon="compass-outline" onPress={() => setSheet('progress')}>
            {t('readingProgress')}
          </Button>
          <Button
            secondary
            icon="checkmark-circle-outline"
            onPress={() => void finishReading(true)}
          >
            {t('markFinished')}
          </Button>
        </Sheet>
        <Sheet
          {...sheetProps('progress')}
          title={t('readingProgress')}
          close={() => setSheet(null)}
        >
          {sheet === 'progress' && (
            <ReadingProgressPanel book={book} paragraph={current.paragraph} navigate={navigate} />
          )}
        </Sheet>
        <ReaderNotesSheet
          book={book}
          position={current}
          notes={notes}
          {...sheetProps('notes')}
          close={() => setSheet(null)}
          add={() => {
            const paragraph =
              chapter.paragraphs.find((p) => p.id === latest.current.paragraph) ||
              chapter.paragraphs[0];
            const source =
              readingMode === 'translation' && translations[paragraph.id]
                ? 'translation'
                : 'original';
            const text = source === 'translation' ? translations[paragraph.id] : paragraph.text;
            setSelected({
              paragraph,
              source,
              text,
              start: 0,
              end: text.length,
              language: readingLanguage,
              ...(source === 'translation'
                ? { translationKey: translationKeys[paragraph.id] }
                : {}),
            });
            setNoteText('');
            setSheet('note');
          }}
          open={(note) => {
            const entry = paragraphIndex.get(note.paragraphId);
            if (entry) navigate(entry.chapter, note.paragraphId, false, note.anchor, note.quote);
          }}
          onSaved={(note) => {
            if (!isReaderCurrent() || note.bookId !== book.id) return;
            setNotes((previous) =>
              previous.map((existing) =>
                existing.bookId === note.bookId && existing.id === note.id ? note : existing,
              ),
            );
          }}
        />
        {sheet === 'contents' && (
          <ContentsSheet
            key={book.id}
            {...sheetProps('contents')}
            entries={contents}
            activeKey={activeContentKey}
            query={chapterQuery}
            setQuery={setChapterQuery}
            collapsedKeys={contentsCollapsed.get(contentsScope) || emptyContentsCollapsed}
            initialLocate={!contentsCollapsed.has(contentsScope)}
            onCollapsedKeysChange={(keys) => {
              if (!isNavigationCurrent() || requestedSheet.current !== 'contents') return;
              setContentsCollapsed((previous) =>
                new Map(previous).set(contentsScope, new Set(keys)),
              );
            }}
            hasPdfContents={hasPdfContents}
            pdfPages={pdfPages}
            setPdfPages={setPdfPages}
            close={() => setSheet(null)}
            search={() => setSheet('search')}
            navigate={navigate}
          />
        )}
        {/* Switching among these views reuses the same native presentation. */}
        <Sheet
          {...sheetProps('language', 'actions', 'translationVersions')}
          title={
            sheet === 'translationVersions'
              ? prefs.locale.startsWith('zh')
                ? '这段的译文版本'
                : 'Saved versions of this passage'
              : sheet === 'actions'
                ? t('more')
                : t('readingLanguage')
          }
          close={() => {
            if (sheet === 'translationVersions' && versionSelectionBusy.current) return;
            if (sheet === 'actions' && noteBusy.current) return;
            setSheet(null);
          }}
          tall={sheet === 'translationVersions'}
          scrollable={sheet !== 'translationVersions'}
        >
          {sheet === 'translationVersions' && versionTarget ? (
            <TranslationVersionsContent
              key={`${book.id}:${versionTarget.language}:${versionTarget.paragraphId}`}
              bookId={book.id}
              paragraphId={versionTarget.paragraphId}
              language={versionTarget.language}
              currentKey={
                translation.savedKeys[versionTarget.language]?.[versionTarget.paragraphId]
              }
              choose={chooseVersion}
              onBusyChange={onVersionBusyChange}
            />
          ) : sheet === 'actions' ? (
            <>
              <Text
                numberOfLines={4}
                style={{ color: colors.muted, fontFamily: 'Georgia', lineHeight: 25 }}
              >
                {selected?.text.slice(selected.start, selected.end)}
              </Text>
              {!!noteError && (
                <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
                  {noteError}
                </Text>
              )}
              <Button
                secondary
                disabled={saving}
                icon="text-outline"
                onPress={() => adjustSelection('actions')}
              >
                {t('adjustSelection')}
              </Button>
              <Button
                busy={saving}
                secondary
                icon="color-wand-outline"
                onPress={() => void addNote('')}
              >
                {t('highlight')}
              </Button>
              <Button
                secondary
                disabled={saving}
                icon="sparkles-outline"
                onPress={() => {
                  if (!noteBusy.current) setSheet('assistant');
                }}
              >
                {t('aiAskPassage')}
              </Button>
              <Button
                disabled={saving}
                icon="create-outline"
                onPress={() => {
                  if (!noteBusy.current) setSheet('note');
                }}
              >
                {t('addNote')}
              </Button>
              <Button
                secondary
                disabled={saving}
                icon="documents-outline"
                onPress={() => openVersions(selected || undefined)}
              >
                {prefs.locale.startsWith('zh') ? '译文版本' : 'Saved translation versions'}
              </Button>
              <Button
                secondary
                disabled={saving}
                icon="volume-medium-outline"
                onPress={() => void openSpeech(selected || currentFocus)}
              >
                {t('listen')}
              </Button>
            </>
          ) : (
            <>
              {!!readingOverride && (
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
                  {t('bookmarkTemporaryMode')}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {(['original', 'bilingual', 'translation'] as const).map((mode) => (
                  <Chip
                    key={mode}
                    active={readingMode === mode}
                    onPress={() => changeReadingLanguage({ mode })}
                  >
                    {t(mode === 'translation' ? 'translationOnly' : mode)}
                  </Chip>
                ))}
              </View>
              <View accessibilityLabel={t('translationLanguage')} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries({
                  'zh-CN': '简体中文',
                  'zh-TW': '繁體中文',
                  en: 'English',
                  ja: '日本語',
                  ko: '한국어',
                  de: 'Deutsch',
                  fr: 'Français',
                  es: 'Español',
                  pt: 'Português',
                  ar: 'العربية',
                  ...Object.fromEntries(
                    Object.keys(translation.saved)
                      .filter(
                        (key) =>
                          ![
                            'zh-CN',
                            'zh-TW',
                            'en',
                            'ja',
                            'ko',
                            'de',
                            'fr',
                            'es',
                            'pt',
                            'ar',
                          ].includes(key),
                      )
                      .map((key) => [key, key]),
                  ),
                }).map(([language, label]) => (
                  <Chip
                    key={language}
                    active={readingLanguage === language}
                    onPress={() => changeReadingLanguage({ language })}
                  >
                    {label}
                  </Chip>
                ))}
              </View>
            </>
          )}
        </Sheet>
        <Sheet {...sheetProps('appearance')} title={t('typesetting')} close={() => setSheet(null)}>
          <View
            style={[
              styles.spread,
              { backgroundColor: colors.background, borderRadius: 24, paddingHorizontal: 6 },
            ]}
          >
            <IconButton
              icon="remove"
              label={`${t('fontSize')} −`}
              disabled={prefs.fontSize <= 15}
              onPress={() =>
                layoutChanges.change((current) => ({
                  fontSize: Math.max(15, current.fontSize - 1),
                }))
              }
            />
            <Text style={{ color: colors.ink, fontSize: 17 }}>
              {t('fontSize')} · {prefs.fontSize}
            </Text>
            <IconButton
              icon="add"
              label={`${t('fontSize')} +`}
              disabled={prefs.fontSize >= 30}
              onPress={() =>
                layoutChanges.change((current) => ({
                  fontSize: Math.min(30, current.fontSize + 1),
                }))
              }
            />
          </View>
          <View style={styles.spread}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{t('lineHeight')}</Text>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {[1.5, 1.75, 2].map((lineHeight) => (
                <Chip
                  key={lineHeight}
                  active={prefs.lineHeight === lineHeight}
                  onPress={() => layoutChanges.change({ lineHeight })}
                >{`${lineHeight}×`}</Chip>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip active={prefs.serif} onPress={() => layoutChanges.change({ serif: true })}>
              {t('serif')}
            </Chip>
            <Chip active={!prefs.serif} onPress={() => layoutChanges.change({ serif: false })}>
              {t('sans')}
            </Chip>
            <Chip active={prefs.theme === 'paper'} onPress={() => patch({ theme: 'paper' })}>
              {t('paper')}
            </Chip>
            <Chip active={prefs.theme === 'night'} onPress={() => patch({ theme: 'night' })}>
              {t('night')}
            </Chip>
          </View>
          <ReadingNavigation onChange={layoutChanges.change} />
        </Sheet>
        <Sheet {...sheetProps('speech')} title={t('listen')} close={() => setSheet(null)}>
          <ReaderSpeechPanel
            speech={speech}
            plan={speechPlan}
            scope={speechSetup.scope}
            source={speechSetup.source}
            targetLanguage={speechSetup.language}
            selectionAvailable={!!speechSetup.selection}
            onScope={(scope) => {
              stop();
              setSpeechSetup((setup) => ({ ...setup, scope }));
            }}
            onSource={(source) => {
              stop();
              setSpeechSetup((setup) => ({
                ...setup,
                source,
                ...(source !== setup.source
                  ? {
                      selection: undefined,
                      scope: setup.scope === 'selection' ? 'paragraph' : setup.scope,
                    }
                  : {}),
              }));
            }}
            onStart={startSpeech}
            onShowPassage={showSpeechPassage}
          />
        </Sheet>
        <Sheet
          {...sheetProps('note')}
          title={t('addNote')}
          close={() => {
            if (!saving) setSheet(null);
          }}
        >
          <Text
            numberOfLines={6}
            style={{ color: colors.muted, lineHeight: 24, fontFamily: 'Georgia' }}
          >
            {selected?.text.slice(selected.start, selected.end)}
          </Text>
          <Button
            secondary
            disabled={saving}
            icon="text-outline"
            onPress={() => adjustSelection('note')}
          >
            {t('adjustSelection')}
          </Button>
          {!!noteError && (
            <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
              {noteError}
            </Text>
          )}
          <TextInput
            autoFocus
            multiline
            maxLength={50000}
            value={noteText}
            onChangeText={setNoteText}
            placeholder={t('notePlaceholder')}
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                minHeight: 160,
                color: colors.ink,
                borderColor: colors.border,
                textAlignVertical: 'top',
              },
            ]}
          />
          <Button busy={saving} onPress={() => void addNote(noteText)}>
            {t('save')}
          </Button>
        </Sheet>
      </View>
    </AppContext.Provider>
  );
}
