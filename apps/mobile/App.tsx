import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { catalog, resolveSavedPassage, safeReadingQuote, type Book } from '@bypage/reading-core';
import {
  HomeScreen,
  ProfileScreen,
  BookDetailScreen,
  PageHeader,
} from './src/screens/discovery-screens';
import { getLocales } from 'expo-localization';
import {
  AppContext,
  cleanPreferences,
  defaultPreferences,
  palettes,
  type Preferences,
} from './src/context';
import { translate, type TextKey } from './src/i18n';
import {
  listBooks,
  addBook,
  getPreference,
  setPreference,
  setBookSourceLanguage,
  getBook,
  getPosition,
  getTranslationDisplay,
  readExactTranslation,
  listNotes,
  markFinished,
  removeBook,
  type ShelfBook,
} from './src/adapters/database';
import {
  chooseImport,
  prepareImport,
  confirmImport,
  shareLibrary,
  type PendingImport,
  type PreparedImport,
  type PreparedPdfImport,
} from './src/adapters/files';
import { measured } from './src/adapters/diagnostics';
import { Button, Empty, Icon, Sheet, styles, type IconName } from './src/components/ui';
import {
  LibraryScreen,
  NotesScreen,
  type LibraryRoute,
  type NotesRoute,
  type ReadingTarget,
} from './src/screens/library-screens';
import { AccountScreen } from './src/screens/account-screen';
import { SearchScreen, type SearchRoute } from './src/screens/search-screen';
import { initializeAccount, refreshAccount } from './src/adapters/account';
import { readBookReadingPreferences } from './src/adapters/book-reading-preferences';
import { invalidateBookTranslationDisplay } from './src/adapters/translation-display';
import { PdfImportSheet } from './src/components/pdf-import-sheet';
import { discardPdf } from './src/adapters/pdf';
import { useSheetPresentation } from './src/components/use-sheet-presentation';
import { ReaderScreen, type OpenBook } from './src/screens/reader-screen';
import { useDocumentInbox } from './src/components/use-document-inbox';
import type { PendingDocument } from './modules/bypage-documents';
import { MoveBooksContent } from './src/components/collection-sheets';
import { useLibrary } from './src/library-context';
import { useLibraryController } from './src/library-controller';
import { RecoveryCountsView, RecoveryResultView } from './src/components/recovery-details';
import type { RecoveryRestoreResult } from './src/adapters/library-recovery-restore';
import { LibraryHost } from './src/library-host';
import { useLibrarySync } from './src/components/use-library-sync';
import { deviceLibrary } from './src/adapters/library-scope';

// Preferences belong to the device. Serialize across library-tree remounts too.
let devicePreferenceWrites: Promise<void> = Promise.resolve();
type ImportPanel = 'inbox' | 'pdf' | 'confirm' | 'recovered';
const importPanelGroup = (panel: ImportPanel) => (panel === 'recovered' ? 'confirm' : panel);
type ImportWork = {
  pdf: PreparedPdfImport | null;
  delivered: boolean;
  cancelled: boolean;
  readonly sourceId: string | null;
};

class RecoveryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          padding: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F7F6F1',
          gap: 20,
        }}
      >
        <Text style={{ fontSize: 24, color: '#245E46' }}>叶子阅读</Text>
        <Text style={{ color: '#242B2B', textAlign: 'center', lineHeight: 24 }}>
          Unable to display this page. Your saved library is still on this device.{'\n'}
          页面暂时无法显示，本机书架仍保留。
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ failed: false })}
          style={{ padding: 20 }}
        >
          <Text style={{ color: '#245E46' }}>Retry / 重试</Text>
        </Pressable>
      </View>
    );
  }
}

function Main() {
  const library = useLibrary();
  const libraryControl = useLibraryController();
  const [preferences, setPreferences] = useState<Preferences>({
    ...defaultPreferences,
    locale: getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en',
  });
  const preferenceState = useRef(preferences);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<'home' | 'library' | 'notes' | 'profile'>('home');
  const [page, setPage] = useState<'search' | 'account' | null>(null);
  const [detail, setDetail] = useState<Book | null>(null);
  const [notesRoute, setNotesRoute] = useState<NotesRoute>({
    query: '',
    page: 0,
    cursors: [null],
    view: 'books',
  });
  const [libraryRoute, setLibraryRoute] = useState<LibraryRoute>({
    filter: 'all',
    sort: 'sortDefault',
  });
  const [searchRoute, setSearchRoute] = useState<SearchRoute>({
    query: '',
    source: 'original',
    language: defaultPreferences.language,
    page: 0,
  });
  const [readerTools, setReaderTools] = useState(false);
  const [reader, setReader] = useState<OpenBook | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [pdfFile, setPdfFile] = useState<PreparedPdfImport | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [recovered, setRecovered] = useState<RecoveryRestoreResult | null>(null);
  const importSaving = useRef(false);
  const [importSaveError, setImportSaveError] = useState('');
  const [selected, setSelected] = useState<ShelfBook | null>(null);
  const [collectionMove, setCollectionMove] = useState(false);
  const collectionBusy = useRef(false);
  const selectedCollectionBooks = useMemo(() => (selected ? [selected.id] : []), [selected?.id]);
  const importPanel = useSheetPresentation<ImportPanel>({ library, group: importPanelGroup });
  const inboxOpen = importPanel.sheet === 'inbox';
  const [inboxError, setInboxError] = useState('');
  const importActive = useRef(false);
  const importWork = useRef<ImportWork | null>(null);
  const mainActive = useRef(false);
  const importBlocked = useRef(libraryControl.blocked);
  importBlocked.current = libraryControl.blocked;
  useLayoutEffect(() => {
    const invalidate = () => {
      if (importWork.current) importWork.current.cancelled = true;
    };
    if (libraryControl.blocked || !library.isCurrent()) invalidate();
    library.signal.addEventListener('abort', invalidate);
    return () => library.signal.removeEventListener('abort', invalidate);
  }, [library, libraryControl.blocked]);
  useLayoutEffect(() => {
    mainActive.current = true;
    return () => {
      mainActive.current = false;
      const work = importWork.current;
      importWork.current = null;
      // Once mounted, the PDF sheet must drain its engine before deleting this
      // copy. The parent only owns a prepared file that never reached its sheet.
      if (work?.pdf && !work.delivered) discardPdf(work.pdf.uri);
    };
  }, []);
  useLayoutEffect(() => {
    const work = importWork.current;
    if (work && importPanel.sheet === 'pdf' && work.pdf === pdfFile) work.delivered = true;
    if (importPanel.sheet !== null || busy || importSaving.current || !work) return;
    if (work.pdf && !work.delivered) discardPdf(work.pdf.uri);
    importWork.current = null;
    importActive.current = false;
    setPdfFile(null);
    setPending(null);
    setRecovered(null);
    setImportSaveError('');
  }, [importPanel.sheet, busy, pdfFile]);
  const setInboxOpen = (visible: boolean) => {
    if (!visible) {
      importPanel.request(null);
      return;
    }
    if (busy || importActive.current || importPanel.sheet !== null) return;
    setInboxError('');
    importPanel.request('inbox');
  };
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openSequence = useRef(0);
  const colors = palettes[preferences.theme];
  const t = useCallback(
    (key: TextKey, values?: Record<string, string | number>) =>
      translate(preferences.locale, key, values),
    [preferences.locale],
  );
  const notify = useCallback(
    (text: string) => {
      if (!library.isCurrent()) return;
      clearTimeout(toastTimer.current);
      setMessage(text);
      toastTimer.current = setTimeout(() => {
        if (library.isCurrent()) setMessage('');
      }, 3500);
    },
    [library],
  );
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const inbox = useDocumentInbox((error) => {
    const message = t(
      error === 'limit'
        ? 'inboxLimit'
        : error === 'unsupported'
          ? 'inboxUnsupported'
          : 'inboxReadError',
    );
    setInboxError(message);
    notify(message);
  });
  const previousInbox = useRef(new Set<string>());
  useEffect(() => {
    const added = inbox.items.some((item) => !previousInbox.current.has(item.id));
    previousInbox.current = new Set(inbox.items.map((item) => item.id));
    if (added && (reader || detail || page || pending || pdfFile || selected))
      notify(t('inboxReceived'));
  }, [inbox.items, reader, detail, page, pending, pdfFile, selected, notify, t]);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    library.assertCurrent();
    const sequence = ++refreshSequence.current;
    const next = await measured('library.load', () => listBooks(library.handle));
    library.assertCurrent();
    if (sequence !== refreshSequence.current) return;
    setBooks(next);
    setRevision((value) => value + 1);
  }, [library]);
  const syncChanged = useCallback(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  useLibrarySync(
    boot === 'ready' &&
      !reader &&
      !detail &&
      !busy &&
      !opening &&
      importPanel.sheet === null &&
      !pending &&
      !recovered &&
      !pdfFile &&
      !selected &&
      !collectionMove,
    syncChanged,
  );
  const bootstrap = useCallback(async () => {
    setBoot('loading');
    try {
      await devicePreferenceWrites;
      library.assertCurrent();
      const settings = await getPreference<Preferences>('reader', {
        ...defaultPreferences,
        locale: getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en',
      });
      library.assertCurrent();
      const clean = cleanPreferences(settings);
      initializeAccount();
      // Drop the legacy endpoint preference without touching books or account caches.
      if ('serverOrigin' in settings) {
        devicePreferenceWrites = devicePreferenceWrites
          .then(() => setPreference('reader', clean))
          .catch(() => notify(translate(clean.locale, 'error')));
        await devicePreferenceWrites;
        library.assertCurrent();
      }
      preferenceState.current = clean;
      setPreferences(clean);
      setSearchRoute((route) => ({ ...route, language: clean.language }));
      await refresh();
      if (library.isCurrent()) setBoot('ready');
    } catch {
      if (library.isCurrent()) setBoot('error');
    }
  }, [refresh, library, notify]);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  const patch = useCallback(
    (value: Partial<Preferences>) => {
      if (!library.isCurrent()) return;
      const next = cleanPreferences({ ...preferenceState.current, ...value });
      preferenceState.current = next;
      setPreferences(next);
      devicePreferenceWrites = devicePreferenceWrites
        .then(() => setPreference('reader', next))
        .catch(() => notify(translate(next.locale, 'error')));
    },
    [library, notify, preferences.language],
  );
  const open = useCallback(
    async (id: string, paragraph?: string, target?: ReadingTarget) => {
      if (!library.isCurrent()) return;
      const sequence = ++openSequence.current;
      setOpening(true);
      try {
        let addedToLibrary = false;
        const result = await measured('book.open', async () => {
          let book = await getBook(library.handle, id);
          if (!book) {
            const original = catalog.find((b) => b.id === id);
            if (original) {
              library.assertCurrent();
              await addBook(library.handle, original);
              book = original;
              addedToLibrary = true;
            }
          }
          if (!book) throw new Error('missing_book');
          const readingPreferences = await readBookReadingPreferences(
            library.handle,
            id,
            preferences,
          );
          let position = await getPosition(library.handle, id);
          const display = await getTranslationDisplay(library.handle, id);
          const translations = display.texts;
          let readingOverride: OpenBook['readingOverride'];
          let revealTranslation: OpenBook['revealTranslation'];
          let notice: 'noteOriginalFallback' | 'noteTranslationOpened' | undefined;
          if (paragraph) {
            const chapter = book.chapters.findIndex((c) =>
              c.paragraphs.some((p) => p.id === paragraph),
            );
            if (chapter >= 0) {
              const passage = book.chapters[chapter].paragraphs.find((p) => p.id === paragraph)!;
              const exact =
                target?.anchor?.source === 'translation' && target.anchor.translationKey
                  ? await readExactTranslation(library.handle, id, target.anchor.translationKey)
                  : null;
              const saved =
                target && (target.quote !== undefined || target.anchor?.source === 'translation')
                  ? resolveSavedPassage(passage, target, (key) => {
                      return exact?.key === key && exact.paragraphId === passage.id
                        ? exact.text
                        : undefined;
                    })
                  : undefined;
              const source = saved?.source || target?.anchor?.source || 'original';
              const textOffset = saved?.start ?? target?.anchor?.start ?? 0;
              const language = saved?.language || readingPreferences.language;
              const text = source === 'translation' ? exact?.text : passage.text;
              if (saved?.source === 'translation' && exact)
                revealTranslation = {
                  language: exact.language,
                  paragraph: exact.paragraphId,
                  key: exact.key,
                  text: exact.text,
                };
              position = {
                chapter,
                paragraph,
                farthest: Math.max(chapter, position?.farthest || 0),
                offset: textOffset / Math.max(1, text?.length || 1),
                textOffset,
                textSource: source,
                textQuote: safeReadingQuote(text || passage.text, textOffset),
              };
              if (saved?.fallback) notice = 'noteOriginalFallback';
              else if (saved?.source === 'translation') notice = 'noteTranslationOpened';
              if (target)
                readingOverride = {
                  language,
                  mode: saved?.fallback
                    ? 'original'
                    : source === 'translation'
                      ? readingPreferences.mode === 'translation'
                        ? 'translation'
                        : 'bilingual'
                      : readingPreferences.mode === 'translation'
                        ? 'bilingual'
                        : readingPreferences.mode,
                };
            }
          }
          return {
            library,
            book,
            position,
            translations,
            translationKeys: display.keys,
            readingPreferences,
            revealTranslation,
            notes: await listNotes(library.handle, id, 100000),
            readingOverride,
            notice,
          };
        });
        // Refresh the shelf after importing a catalog book before opening its reader.
        if (addedToLibrary) await refresh();
        if (library.isCurrent() && sequence === openSequence.current) {
          setReaderTools(false);
          const { notice, ...value } = result;
          setReader(value);
          if (notice) notify(t(notice));
        }
      } catch {
        if (library.isCurrent() && sequence === openSequence.current) notify(t('error'));
      } finally {
        if (library.isCurrent() && sequence === openSequence.current) setOpening(false);
      }
    },
    [library, preferences.language, preferences.mode, notify, t, refresh],
  );
  const closeReader = useCallback(() => {
    if (!library.isCurrent()) return;
    setReader(null);
    void refresh().catch(() => notify(t('error')));
  }, [library, refresh, notify, t]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (inboxOpen) {
        if (!busy) setInboxOpen(false);
        return true;
      }
      if (reader) {
        closeReader();
        return true;
      }
      if (detail) {
        setDetail(null);
        return true;
      }
      if (page) {
        setPage(null);
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [reader, tab, detail, page, closeReader, inboxOpen, busy]);
  const importBook = async (incoming?: PendingDocument) => {
    if (
      !mainActive.current ||
      !library.isCurrent() ||
      importBlocked.current ||
      importActive.current ||
      busy ||
      pending ||
      pdfFile ||
      (incoming
        ? importPanel.sheet !== 'inbox' ||
          importPanel.desiredSheet !== 'inbox' ||
          !importPanel.visible
        : importPanel.sheet !== null)
    )
      return;
    const work: ImportWork = {
      pdf: null,
      delivered: false,
      cancelled: false,
      sourceId: incoming?.id || null,
    };
    importWork.current = work;
    importActive.current = true;
    setImportSaveError('');
    setInboxError('');
    setBusy(true);
    let chosen: PreparedImport | null = null;
    const current = () =>
      mainActive.current &&
      importWork.current === work &&
      !work.cancelled &&
      library.isCurrent() &&
      !importBlocked.current;
    try {
      const labels = {
        unknown: t('unknown'),
        chapter: (n: number) => t('chapter', { n }),
      };
      chosen = incoming
        ? await measured('document.preview', () => prepareImport(library, incoming, labels))
        : await chooseImport(library, labels);
      if (!current()) {
        if (chosen?.kind === 'pdf') discardPdf(chosen.uri);
        return;
      }
      if (chosen?.kind === 'pdf') {
        work.pdf = chosen;
        setPdfFile(chosen);
        importPanel.request('pdf');
      } else if (chosen) {
        setPending(chosen);
        importPanel.request('confirm');
      }
      if (!chosen) {
        importWork.current = null;
        importActive.current = false;
      }
    } catch {
      if (chosen?.kind === 'pdf' && !work.delivered) discardPdf(chosen.uri);
      if (current()) {
        importWork.current = null;
        importActive.current = false;
        if (incoming) setInboxError(t('importError'));
        else notify(t('importError'));
      }
    } finally {
      if (mainActive.current && library.isCurrent()) setBusy(false);
    }
  };
  const cancelImport = () => {
    // Retain the host and its payload until the matching native dismissal ACK.
    importPanel.request(null);
  };
  const currentImport = (work: ImportWork) =>
    mainActive.current &&
    library.isCurrent() &&
    !importBlocked.current &&
    !work.cancelled &&
    importWork.current === work;
  const completeImport = async (count: number, work: ImportWork) => {
    // The book transaction has already committed. Follow-up failures must never
    // return to a confirmation that offers to submit that transaction again.
    if (!currentImport(work)) return;
    const incoming = work.sourceId;
    let refreshed = true;
    try {
      await refresh();
    } catch {
      refreshed = false;
    }
    if (!currentImport(work)) return;
    let cleared = true;
    if (incoming) {
      try {
        await inbox.dismiss(incoming);
      } catch {
        cleared = false;
      }
    }
    if (!currentImport(work)) return;
    cancelImport();
    setPage(null);
    setDetail(null);
    setTab('library');
    notify(
      t(
        refreshed
          ? cleared
            ? 'importSuccess'
            : 'inboxCleanupError'
          : cleared
            ? 'importRefreshError'
            : 'importRefreshCleanupError',
        { n: count },
      ),
    );
  };
  const completeRecovery = async (result: RecoveryRestoreResult, work: ImportWork) => {
    if (!currentImport(work)) return;
    const incoming = work.sourceId;
    // The restore has committed. A list refresh failure must not turn it into a
    // failed import or offer to submit the same archive again.
    setPending(null);
    setImportSaveError('');
    setRecovered(result);
    importPanel.request('recovered');
    if (library.handle.kind === 'device') {
      try {
        await refresh();
      } catch {
        if (currentImport(work))
          notify(
            preferences.locale === 'zh-CN'
              ? '副本已恢复，但书架刷新失败。请重新打开书架。'
              : 'The copy is restored, but the shelf could not refresh. Reopen the library.',
          );
      }
    }
    if (!currentImport(work)) return;
    if (incoming) {
      try {
        await inbox.dismiss(incoming);
      } catch {
        if (currentImport(work)) notify(t('inboxCleanupError', { n: 1 }));
      }
    }
  };
  const removeIncoming = async (id: string) => {
    if (
      importActive.current ||
      busy ||
      importPanel.sheet !== 'inbox' ||
      importPanel.desiredSheet !== 'inbox' ||
      !importPanel.visible
    )
      return;
    importActive.current = true;
    setInboxError('');
    setBusy(true);
    try {
      await inbox.dismiss(id);
    } catch {
      setInboxError(t('inboxReadError'));
    } finally {
      importActive.current = false;
      setBusy(false);
    }
  };
  const openAccount = useCallback(() => {
    if (!library.isCurrent()) return;
    setReader(null);
    setDetail(null);
    setPage('account');
  }, [library]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAccount();
    });
    return () => subscription.remove();
  }, []);
  const context = useMemo(
    () => ({ preferences, patch, colors, t, notify, openAccount }),
    [preferences, patch, colors, t, notify, openAccount],
  );
  const showBookActions = (book: ShelfBook) => {
    setCollectionMove(false);
    setSelected(book);
  };
  const actions = {
    books,
    open: (id: string, paragraph?: string, target?: ReadingTarget) => {
      void open(id, paragraph, target);
    },
    more: showBookActions,
  };
  const showNotes = (id?: string) => {
    setNotesRoute({ bookId: id, query: '', page: 0, cursors: [null], view: 'books' });
    setDetail(null);
    setPage(null);
    setTab('notes');
  };
  const detailSequence = useRef(0);
  const showDetail = async (id: string) => {
    if (!library.isCurrent()) return;
    const sequence = ++detailSequence.current;
    try {
      const book = (await getBook(library.handle, id)) || catalog.find((b) => b.id === id);
      if (library.isCurrent() && sequence === detailSequence.current && book) setDetail(book);
    } catch {
      notify(t('error'));
    }
  };
  const tabs: { key: typeof tab; icon: IconName }[] = [
    { key: 'home', icon: 'book-outline' },
    { key: 'library', icon: 'library-outline' },
    { key: 'notes', icon: 'create-outline' },
    { key: 'profile', icon: 'person-outline' },
  ];
  return (
    <AppContext.Provider value={context}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background }}
        edges={['top', 'bottom']}
      >
        <StatusBar
          hidden={!!reader && !readerTools}
          style={preferences.theme === 'night' ? 'light' : 'dark'}
        />
        {boot === 'ready' && !reader && !detail && !page && inbox.items.length > 0 && (
          <Pressable
            accessibilityRole="button"
            disabled={busy || importPanel.sheet !== null || !!pending || !!pdfFile}
            onPress={() => setInboxOpen(true)}
            style={{
              marginHorizontal: 20,
              marginVertical: 8,
              padding: 14,
              borderRadius: 14,
              backgroundColor: colors.soft,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Icon name="download-outline" color={colors.accent} />
            <Text style={{ color: colors.ink, flex: 1 }}>
              {t('inboxCount', { n: inbox.items.length })}
            </Text>
            <Icon name="chevron-forward" color={colors.muted} size={17} />
          </Pressable>
        )}
        {boot === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: colors.muted }}>{t('loading')}</Text>
          </View>
        ) : boot === 'error' ? (
          <Empty title={t('storageError')}>
            <Button onPress={() => void bootstrap()}>{t('retry')}</Button>
          </Empty>
        ) : reader ? (
          <ReaderScreen
            key={`${library.handle.key}:${library.epoch}:${reader.book.id}`}
            value={reader}
            close={closeReader}
            onToolsChange={setReaderTools}
          />
        ) : detail ? (
          <BookDetailScreen
            book={detail}
            onShelf={books.some((b) => b.id === detail.id)}
            noteCount={books.find((b) => b.id === detail.id)?.noteCount || 0}
            close={() => setDetail(null)}
            open={(paragraph) => void open(detail.id, paragraph)}
            updateSourceLanguage={async (language) => {
              library.assertCurrent();
              invalidateBookTranslationDisplay(library.handle, detail.id);
              const updated = await setBookSourceLanguage(library.handle, detail.id, language);
              library.assertCurrent();
              setDetail((current) => (current?.id === updated.id ? updated : current));
              await refresh();
            }}
            add={async () => {
              library.assertCurrent();
              await addBook(library.handle, detail);
              await refresh();
            }}
            notes={() => showNotes(detail.id)}
            more={
              books.some((b) => b.id === detail.id)
                ? () => showBookActions(books.find((b) => b.id === detail.id)!)
                : undefined
            }
          />
        ) : page ? (
          <View style={{ flex: 1 }}>
            <PageHeader title={t(page)} back={() => setPage(null)} />
            {page === 'search' ? (
              <SearchScreen
                {...actions}
                route={searchRoute}
                onRouteChange={setSearchRoute}
                revision={revision}
              />
            ) : (
              <AccountScreen />
            )}
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              {tab === 'home' && (
                <HomeScreen
                  downloaded={async (book) => {
                    if (!library.isCurrent()) return;
                    await addBook(library.handle, book);
                    if (!library.isCurrent()) return;
                    await refresh();
                    if (library.isCurrent()) setDetail(book);
                  }}
                  books={books}
                  detail={(id) => void showDetail(id)}
                  open={(id) => void open(id)}
                />
              )}
              {tab === 'library' && (
                <LibraryScreen
                  {...actions}
                  route={libraryRoute}
                  onRouteChange={setLibraryRoute}
                  importBook={() => void importBook()}
                  busy={busy}
                  search={() => setPage('search')}
                  refresh={refresh}
                />
              )}
              {tab === 'notes' && (
                <NotesScreen
                  {...actions}
                  revision={revision}
                  route={notesRoute}
                  onRouteChange={setNotesRoute}
                  onChanged={refresh}
                />
              )}
              {tab === 'profile' && <ProfileScreen importBook={() => void importBook()} />}
            </View>
            <View
              style={{
                flexDirection: 'row',
                paddingTop: 8,
                paddingBottom: 2,
                borderTopWidth: 1,
                borderColor: colors.border,
              }}
            >
              {tabs.map((item) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === item.key }}
                  accessibilityLabel={t(item.key)}
                  onPress={() => {
                    setTab(item.key);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 52,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  <Icon
                    name={item.icon}
                    size={23}
                    color={tab === item.key ? colors.accent : colors.muted}
                  />
                  <Text
                    style={{
                      color: tab === item.key ? colors.accent : colors.muted,
                      fontSize: 10,
                      fontWeight: tab === item.key ? '600' : '400',
                    }}
                  >
                    {t(item.key)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {(opening || (busy && importActive.current && !pending && !pdfFile && !inboxOpen)) && (
          <View
            style={{
              position: 'absolute',
              inset: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${colors.background}BB`,
            }}
          >
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        )}
        {!!message && (
          <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            style={{
              position: 'absolute',
              left: 24,
              right: 24,
              bottom: 98,
              backgroundColor: colors.ink,
              borderRadius: 14,
              padding: 16,
            }}
          >
            <Text
              style={{
                color: colors.background,
                textAlign: 'center',
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              {message}
            </Text>
          </View>
        )}
        {pdfFile && importPanel.sheet === 'pdf' && (
          <PdfImportSheet
            file={pdfFile}
            visible={importPanel.visible}
            onShow={importPanel.onShow}
            onDismiss={importPanel.onDismiss}
            close={cancelImport}
            onSavingChange={(saving) => {
              const work = importWork.current;
              if (!work || work.pdf !== pdfFile) return;
              importSaving.current = saving;
              if (mainActive.current && library.isCurrent()) setBusy(saving);
            }}
            save={async (book, destination) => {
              const work = importWork.current;
              if (destination !== library || !work || work.pdf !== pdfFile || !currentImport(work))
                throw new Error('library_scope_changed');
              destination.assertCurrent();
              await addBook(destination.handle, book);
              await completeImport(1, work);
            }}
          />
        )}
        <Sheet
          visible={
            (importPanel.sheet === 'confirm' || importPanel.sheet === 'recovered') &&
            importPanel.visible
          }
          onShow={
            importPanel.sheet === 'confirm' || importPanel.sheet === 'recovered'
              ? importPanel.onShow
              : undefined
          }
          onDismiss={
            importPanel.sheet === 'confirm' || importPanel.sheet === 'recovered'
              ? importPanel.onDismiss
              : undefined
          }
          title={
            recovered
              ? preferences.locale === 'zh-CN'
                ? '恢复完成'
                : 'Recovery complete'
              : t('importConfirm')
          }
          close={() => {
            if (busy || importSaving.current) return;
            cancelImport();
          }}
        >
          {recovered ? (
            <>
              {recovered && <RecoveryResultView result={recovered} />}
              <Button
                disabled={busy}
                onPress={() => {
                  if (!recovered || !library.isCurrent() || libraryControl.blocked) return;
                  if (library.handle.kind === 'device') {
                    const id = recovered.bookId;
                    cancelImport();
                    void open(id);
                  } else {
                    setBusy(true);
                    void libraryControl
                      .switchTo(deviceLibrary)
                      .catch(() => {
                        if (library.isCurrent()) notify(t('error'));
                      })
                      .finally(() => {
                        if (library.isCurrent()) setBusy(false);
                      });
                  }
                }}
              >
                {library.handle.kind === 'device'
                  ? t('read')
                  : preferences.locale === 'zh-CN'
                    ? '打开本机书库'
                    : 'Open device library'}
              </Button>
            </>
          ) : (
            <>
              <Text style={[styles.subtitle, { color: colors.ink }]}>
                {pending?.kind === 'book'
                  ? pending.book.title
                  : pending?.kind === 'recovery'
                    ? pending.archive.title
                    : t('importPreview', {
                        n: pending?.kind === 'library' ? pending.pack.backup.books.length : 0,
                        notes: pending?.kind === 'library' ? pending.pack.backup.notes.length : 0,
                      })}
              </Text>
              {pending?.kind === 'library' && (
                <Text numberOfLines={6} style={{ color: colors.muted, lineHeight: 24 }}>
                  {pending.pack.backup.books
                    .slice(0, 6)
                    .map((book) => book.title)
                    .join('\n')}
                </Text>
              )}
              <Text style={[styles.description, { color: colors.muted }]}>
                {pending?.kind === 'recovery'
                  ? preferences.locale === 'zh-CN'
                    ? '此恢复归档将创建独立的本机书籍副本，保留原书、进度、笔记和译文。不会覆盖现有书籍，也不会上传或重放归档中的待同步操作。'
                    : 'This recovery archive creates an independent device copy with its reading progress, notes and translations. Existing books are preserved. Pending operations in the archive are not uploaded or replayed.'
                  : t('importMerge')}
              </Text>
              {pending?.kind === 'recovery' && (
                <View style={{ gap: 10 }}>
                  <RecoveryCountsView counts={pending.archive.counts} />
                  {pending.archive.hasPdf && (
                    <Text style={{ color: colors.muted, lineHeight: 23 }}>
                      {preferences.locale === 'zh-CN'
                        ? '此文件包含解析后的 PDF 正文，不包含 PDF 原件。'
                        : 'This file contains parsed PDF text, without the original PDF file.'}
                    </Text>
                  )}
                </View>
              )}
              {pending?.kind === 'library' && !!pending.pack.collections?.length && (
                <Text style={[styles.description, { color: colors.muted }]}>
                  {t('importCollections', { n: pending.pack.collections.length })}
                </Text>
              )}
              {pending?.kind === 'library' && pending.pack.version === 2 && (
                <Text style={{ color: colors.muted, lineHeight: 23 }}>
                  {preferences.locale.startsWith('zh')
                    ? `精确译文版本 ${pending.pack.translationVersions.length} · 阅读选择 ${pending.pack.translationSelections.length}。已有选版保留，同键异文会停止导入。`
                    : `${pending.pack.translationVersions.length} exact translation versions · ${pending.pack.translationSelections.length} reading selections. Existing selections are kept; conflicting versions stop the import.`}
                </Text>
              )}
              {pending?.kind === 'book' && pending.book.sourceFormat === 'epub' && (
                <View style={{ gap: 8 }}>
                  {pending.book.media && (
                    <Text style={[styles.description, { color: colors.ink }]}>
                      {t('bookImageImportCount', {
                        kept: pending.book.media.placements.length,
                        skipped: Object.values(pending.book.media.diagnostics).reduce(
                          (sum, count) => sum + count,
                          0,
                        ),
                      })}
                    </Text>
                  )}
                  <Text style={[styles.description, { color: colors.muted }]}>
                    {t('epubContentHint')}
                  </Text>
                </View>
              )}
              <Button
                busy={busy}
                onPress={() => {
                  const work = importWork.current;
                  if (
                    !work ||
                    !currentImport(work) ||
                    !library.isCurrent() ||
                    !pending ||
                    importPanel.sheet !== 'confirm' ||
                    importPanel.desiredSheet !== 'confirm' ||
                    !importPanel.visible ||
                    busy ||
                    importSaving.current ||
                    libraryControl.blocked
                  )
                    return;
                  importSaving.current = true;
                  setImportSaveError('');
                  setBusy(true);
                  void confirmImport(library, pending)
                    .then((result) =>
                      result.recovery
                        ? completeRecovery(result.recovery, work)
                        : completeImport(result.count, work),
                    )
                    .catch((error: unknown) => {
                      if (!currentImport(work)) return;
                      setImportSaveError(
                        error instanceof Error && error.message === 'library_recovery_copy_removed'
                          ? preferences.locale === 'zh-CN'
                            ? '此归档的恢复副本已被删除。可从原账号导出阅读包后重新导入。'
                            : 'The previously restored copy was deleted. Export a reading pack from the original account to import it again.'
                          : t(
                              error instanceof Error && error.message === 'collection_limit'
                                ? 'collectionsImportLimit'
                                : 'error',
                            ),
                      );
                    })
                    .finally(() => {
                      importSaving.current = false;
                      if (mainActive.current && library.isCurrent() && importWork.current === work)
                        setBusy(false);
                    });
                }}
              >
                {pending?.kind === 'recovery'
                  ? preferences.locale === 'zh-CN'
                    ? '恢复到本机书库'
                    : 'Restore to device library'
                  : t('importConfirm')}
              </Button>
              {!!importSaveError && (
                <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 23 }}>
                  {importSaveError}
                </Text>
              )}
            </>
          )}
        </Sheet>
        <Sheet
          visible={inboxOpen && importPanel.visible}
          onShow={inboxOpen ? importPanel.onShow : undefined}
          onDismiss={inboxOpen ? importPanel.onDismiss : undefined}
          title={t('inboxTitle')}
          close={() => !busy && setInboxOpen(false)}
        >
          <Text style={[styles.description, { color: colors.muted }]}>
            {preferences.locale === 'zh-CN'
              ? '移除只删除待导入副本，原文件保留。'
              : 'Removing a pending copy keeps the original file.'}
          </Text>
          {!!inboxError && (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>
              {inboxError}
            </Text>
          )}
          <View style={{ gap: 18 }}>
            {inbox.items.map((item) => (
              <View
                key={item.id}
                style={{
                  gap: 10,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                  paddingBottom: 16,
                }}
              >
                <Text numberOfLines={2} style={{ color: colors.ink, fontSize: 16 }}>
                  {item.name}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {(item.size / (1024 * 1024)).toFixed(1)} MB
                </Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Button disabled={busy} onPress={() => void importBook(item)}>
                    {t('inboxPreview')}
                  </Button>
                  <Button secondary disabled={busy} onPress={() => void removeIncoming(item.id)}>
                    {t('inboxRemove')}
                  </Button>
                </View>
              </View>
            ))}
            {!inbox.items.length && <Text style={{ color: colors.muted }}>{t('inboxEmpty')}</Text>}
          </View>
        </Sheet>
        <Sheet
          visible={!!selected}
          title={collectionMove ? t('collectionsMove') : selected?.title || t('more')}
          close={() => {
            if (!busy && !collectionBusy.current) setSelected(null);
          }}
        >
          {collectionMove && selected ? (
            <MoveBooksContent
              key={selected.id}
              bookIds={selectedCollectionBooks}
              close={() => setSelected(null)}
              onMoved={refresh}
              onBusyChange={(working) => {
                collectionBusy.current = working;
              }}
            />
          ) : (
            <>
              <Button
                onPress={() => {
                  const id = selected!.id;
                  setSelected(null);
                  void open(id);
                }}
              >
                {t('continue')}
              </Button>
              <Button
                secondary
                onPress={() => {
                  const id = selected!.id;
                  setSelected(null);
                  void showDetail(id);
                }}
              >
                {t('detail')}
              </Button>
              <Button
                secondary
                disabled={busy}
                onPress={() => setCollectionMove(true)}
              >
                {t('collectionsMove')}
              </Button>
              <Button
                secondary
                disabled={busy}
                onPress={() => {
                  if (!library.isCurrent() || !selected) return;
                  setBusy(true);
                  void markFinished(library.handle, selected.id, !selected.finished)
                    .then(async () => {
                      await refresh();
                      setSelected(null);
                    })
                    .catch(() => notify(t('error')))
                    .finally(() => {
                      if (library.isCurrent()) setBusy(false);
                    });
                }}
              >
                {t(selected?.finished ? 'markReading' : 'markFinished')}
              </Button>
              <Button
                secondary
                busy={busy}
                onPress={() => {
                  if (!library.isCurrent() || !selected) return;
                  setBusy(true);
                  void shareLibrary(library, selected.id)
                    .catch(() => notify(t('error')))
                    .finally(() => {
                      if (library.isCurrent()) setBusy(false);
                    });
                }}
              >
                {t('export')}
              </Button>
              <Button
                secondary
                danger
                disabled={busy}
                onPress={() => {
                  if (!library.isCurrent() || !selected) return;
                  const target = selected;
                  Alert.alert(t('removeBook'), t('removeWarning'), [
                    { text: t('cancel'), style: 'cancel' },
                    {
                      text: t('delete'),
                      style: 'destructive',
                      onPress: () => {
                        if (!library.isCurrent()) return;
                        setBusy(true);
                        invalidateBookTranslationDisplay(library.handle, target.id);
                        void removeBook(library.handle, target.id)
                          .then(async () => {
                            await refresh();
                            setSelected(null);
                          })
                          .catch(() => notify(t('error')))
                          .finally(() => {
                            if (library.isCurrent()) setBusy(false);
                          });
                      },
                    },
                  ]);
                }}
              >
                {t('removeBook')}
              </Button>
            </>
          )}
        </Sheet>
      </SafeAreaView>
    </AppContext.Provider>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <RecoveryBoundary>
        <LibraryHost>{(lease) => <Main key={`${lease.handle.key}:${lease.epoch}`} />}</LibraryHost>
      </RecoveryBoundary>
    </SafeAreaProvider>
  );
}
