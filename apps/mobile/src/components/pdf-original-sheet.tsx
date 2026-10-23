import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { requireNativeViewManager } from 'expo-modules-core';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import {
  discardPdf,
  getPdfOriginal,
  pdfOriginalAvailable,
  pdfNavigationAvailable,
  pdfThumbnailsAvailable,
  pdfSearchAvailable,
  pdfSearchEvidenceAvailable,
  pdfScopedOriginalAvailable,
  retainPdfOriginal,
  type PdfOriginal,
  type PdfTextEvidence,
} from '../adapters/pdf';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import type { LibraryLease } from '../adapters/library-scope';
import { Button, IconButton, styles } from './ui';

type Event<T> = (event: NativeSyntheticEvent<T>) => void;
type NavigationEvent = {
  documentId?: string;
  navigationId?: string;
  searchId?: string;
  searchIndex?: number;
  evidence?: PdfTextEvidence;
};
type EvidenceRequest = {
  documentId: string;
  navigationId: string;
  searchId: string;
  index: number;
  page: number;
  revision: number;
};
function validEvidence(value: unknown): value is PdfTextEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<PdfTextEvidence>;
  return (
    typeof evidence.quote === 'string' &&
    !!evidence.quote.trim() &&
    evidence.quote.length <= 640 &&
    typeof evidence.before === 'string' &&
    evidence.before.length <= 80 &&
    typeof evidence.after === 'string' &&
    evidence.after.length <= 80
  );
}
type PdfSearchEvent = {
  documentId: string;
  searchId: string;
  status: 'searching' | 'complete' | 'error';
  scannedPages: number;
  totalPages: number;
  matches: { page: number }[];
  limited: boolean;
  hasText: boolean;
};
type PdfSearch = {
  id: string;
  query: string;
  documentId: string;
  revision: number;
  status: 'idle' | PdfSearchEvent['status'];
  scannedPages: number;
  matches: { page: number }[];
  limited: boolean;
  hasText: boolean;
};
type NativePdfProps = ViewProps & {
  uri: string;
  libraryScope?: string;
  password: string;
  page: number;
  documentId?: string;
  navigationId?: string;
  thumbnails?: boolean;
  searchQuery?: string;
  searchId?: string;
  searchIndex?: number;
  onSearch?: Event<PdfSearchEvent>;
  onReady: Event<NavigationEvent & { totalPages: number; page: number }>;
  onPageChange: Event<NavigationEvent & { page: number }>;
  onError: Event<NavigationEvent & { code: string }>;
};
// A previously installed extraction-only development build has no PDF view manager.
const NativePdfView: ComponentType<NativePdfProps> | null =
  Platform.OS === 'ios' && pdfOriginalAvailable
    ? requireNativeViewManager<NativePdfProps>('ByPagePdf')
    : null;

export type PdfOriginalSheetProps = {
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  bookId: string;
  title?: string;
  sourcePage?: number;
  close: () => void;
  /** Receives a physical, one-based page. The caller resolves an existing text chapter. */
  onReadPage?: (page: number, evidence?: PdfTextEvidence) => void;
  canReadPage?: (page: number) => boolean;
};

export function PdfOriginalSheet(props: PdfOriginalSheetProps) {
  const library = useLibrary();
  return (
    <PdfOriginalContent
      key={`${library.handle.key}:${library.epoch}:${props.bookId}`}
      {...props}
      library={library}
    />
  );
}

function PdfOriginalContent({
  visible = true,
  onShow,
  onDismiss,
  bookId,
  title,
  sourcePage,
  close,
  onReadPage,
  canReadPage,
  library,
}: PdfOriginalSheetProps & { library: LibraryLease }) {
  const { colors, t } = useApp();
  const { blocked } = useLibraryController();
  const inaccessible = blocked || !visible || !library.isCurrent();
  const access = useRef({ blocked: inaccessible, revision: 0 });
  if (access.current.blocked !== inaccessible)
    access.current = { blocked: inaccessible, revision: access.current.revision + 1 };
  const [source, setSource] = useState<PdfOriginal | null>(null);
  const [phase, setPhase] = useState<
    'loading' | 'missing' | 'opening' | 'ready' | 'password' | 'error' | 'unavailable'
  >('loading');
  const [error, setError] = useState('');
  const [page, setPage] = useState(
    Number.isFinite(sourcePage) ? Math.max(1, Math.floor(sourcePage!)) : 1,
  );
  const [pageInput, setPageInput] = useState(String(page));
  const [pageError, setPageError] = useState('');
  const [thumbnails, setThumbnails] = useState(false);
  const [navigation, setNavigation] = useState(() => ({ page, id: Crypto.randomUUID() }));
  const [confirmedNavigation, setConfirmedNavigation] = useState('');
  const confirmedView = useRef('');
  const confirmedPage = useRef(page);
  const evidenceRequest = useRef<EvidenceRequest | null>(null);
  const confirmedEvidence = useRef<(EvidenceRequest & { evidence: PdfTextEvidence }) | null>(null);
  if (inaccessible) {
    evidenceRequest.current = null;
    confirmedEvidence.current = null;
  }
  const [total, setTotal] = useState(0);
  const [password, setPassword] = useState('');
  // Both values live only in this mounted sheet; no password is written to disk or diagnostics.
  const [viewPassword, setViewPassword] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Source/retry identities never contain the password, path, or book text.
  const documentId = useMemo(() => Crypto.randomUUID(), [source?.uri, attempt]);
  const currentView = useRef({ documentId, navigationId: navigation.id });
  currentView.current = { documentId, navigationId: navigation.id };
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState<PdfSearch>(() => ({
    id: Crypto.randomUUID(),
    query: '',
    documentId,
    revision: access.current.revision,
    status: 'idle',
    scannedPages: 0,
    matches: [],
    limited: false,
    hasText: false,
  }));
  const [searchIndex, setSearchIndex] = useState(-1);
  const activeSearch =
    !inaccessible &&
    phase === 'ready' &&
    search.documentId === documentId &&
    search.revision === access.current.revision
      ? search
      : null;
  // An inactive identity cancels work while the native modal is still dismissing.
  const nativeSearchId =
    activeSearch?.id ?? `${search.id}:inactive:${documentId}:${access.current.revision}`;
  const currentSearch = useRef({ id: nativeSearchId, documentId });
  currentSearch.current = { id: nativeSearchId, documentId };
  const [linking, setLinking] = useState(false);
  const alive = useRef(true);
  const linkBusy = useRef(false);
  const navigating =
    pdfNavigationAvailable && confirmedNavigation !== `${documentId}:${navigation.id}`;
  const readable =
    !inaccessible &&
    library.isCurrent() &&
    phase === 'ready' &&
    !navigating &&
    (canReadPage?.(page) ?? true);
  const inputNumber = /^\d+$/.test(pageInput.trim()) ? Number(pageInput.trim()) : NaN;

  function navigationPending() {
    return (
      pdfNavigationAvailable &&
      confirmedView.current !==
        `${currentView.current.documentId}:${currentView.current.navigationId}`
    );
  }

  function acceptEvent(event: NavigationEvent) {
    return (
      alive.current &&
      !access.current.blocked &&
      library.isCurrent() &&
      currentView.current.documentId === documentId &&
      (!pdfNavigationAvailable ||
        (event.documentId === documentId &&
          event.navigationId === currentView.current.navigationId))
    );
  }
  function confirmPage(event: NavigationEvent & { page: number }, pageCount: number) {
    if (
      !acceptEvent(event) ||
      !Number.isSafeInteger(event.page) ||
      event.page < 1 ||
      event.page > pageCount
    )
      return false;
    confirmedPage.current = event.page;
    const request = evidenceRequest.current;
    const evidence = event.evidence;
    if (
      pdfSearchEvidenceAvailable &&
      request &&
      request.documentId === documentId &&
      request.navigationId === currentView.current.navigationId &&
      request.searchId === currentSearch.current.id &&
      request.revision === access.current.revision &&
      event.searchId === request.searchId &&
      event.searchIndex === request.index &&
      event.page === request.page &&
      activeSearch?.id === request.searchId &&
      activeSearch.status === 'complete' &&
      activeSearch.matches[request.index]?.page === event.page &&
      validEvidence(evidence)
    ) {
      confirmedEvidence.current = {
        ...request,
        evidence: { quote: evidence.quote, before: evidence.before, after: evidence.after },
      };
    } else {
      evidenceRequest.current = null;
      confirmedEvidence.current = null;
    }
    setPage(event.page);
    setPageInput(String(event.page));
    setPageError('');
    confirmedView.current = `${documentId}:${currentView.current.navigationId}`;
    setConfirmedNavigation(confirmedView.current);
    return true;
  }
  function goToPage(next: number, matchIndex = -1) {
    if (
      access.current.blocked ||
      !library.isCurrent() ||
      !pdfNavigationAvailable ||
      navigating ||
      navigationPending() ||
      phase !== 'ready'
    )
      return;
    if (!Number.isSafeInteger(next) || next < 1 || next > total) {
      setPageError(t('pdfPageInvalid', { total }));
      return;
    }
    Keyboard.dismiss();
    setSearchIndex(matchIndex);
    setPageError('');
    setPageInput(String(next));
    const request = { page: next, id: Crypto.randomUUID() };
    confirmedEvidence.current = null;
    evidenceRequest.current =
      pdfSearchEvidenceAvailable &&
      matchIndex >= 0 &&
      activeSearch?.status === 'complete' &&
      activeSearch.id === currentSearch.current.id &&
      activeSearch.matches[matchIndex]?.page === next
        ? {
            documentId,
            navigationId: request.id,
            searchId: activeSearch.id,
            index: matchIndex,
            page: next,
            revision: access.current.revision,
          }
        : null;
    currentView.current = { documentId, navigationId: request.id };
    setNavigation(request);
  }

  function clearSearch() {
    evidenceRequest.current = null;
    confirmedEvidence.current = null;
    const id = Crypto.randomUUID();
    currentSearch.current = { id, documentId };
    setSearch({
      id,
      query: '',
      documentId,
      revision: access.current.revision,
      status: 'idle',
      scannedPages: 0,
      matches: [],
      limited: false,
      hasText: false,
    });
    setSearchIndex(-1);
  }

  function submitSearch() {
    if (
      access.current.blocked ||
      !library.isCurrent() ||
      !pdfSearchAvailable ||
      phase !== 'ready' ||
      navigating ||
      navigationPending()
    )
      return;
    const query = searchDraft.trim().replace(/\s+/g, ' ').slice(0, 160);
    Keyboard.dismiss();
    if (!query) {
      clearSearch();
      return;
    }
    const id = Crypto.randomUUID();
    evidenceRequest.current = null;
    confirmedEvidence.current = null;
    currentSearch.current = { id, documentId };
    setSearch({
      id,
      query,
      documentId,
      revision: access.current.revision,
      status: 'searching',
      scannedPages: 0,
      matches: [],
      limited: false,
      hasText: false,
    });
    setSearchIndex(-1);
  }

  function receiveSearch(event: PdfSearchEvent) {
    if (
      !alive.current ||
      access.current.blocked ||
      !library.isCurrent() ||
      event.documentId !== currentSearch.current.documentId ||
      event.searchId !== currentSearch.current.id ||
      !['searching', 'complete', 'error'].includes(event.status)
    )
      return;
    const matches =
      event.status === 'complete' && Array.isArray(event.matches)
        ? event.matches
            .slice(0, 2000)
            .filter(
              (match) => Number.isSafeInteger(match.page) && match.page >= 1 && match.page <= total,
            )
        : [];
    setSearch((previous) =>
      previous.id === event.searchId && previous.query
        ? {
            ...previous,
            status: event.status,
            matches,
            scannedPages: Number.isFinite(event.scannedPages)
              ? Math.max(0, Math.min(total, Math.floor(event.scannedPages)))
              : 0,
            limited: event.limited === true,
            hasText: event.hasText === true,
          }
        : previous,
    );
  }

  function goToMatch(direction: -1 | 1) {
    if (
      !activeSearch ||
      activeSearch.id !== currentSearch.current.id ||
      activeSearch.status !== 'complete' ||
      !activeSearch.matches.length
    )
      return;
    const count = activeSearch.matches.length;
    const next =
      searchIndex < 0
        ? direction === 1
          ? 0
          : count - 1
        : (searchIndex + direction + count) % count;
    goToPage(activeSearch.matches[next].page, next);
  }

  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      alive.current = false;
      setSource(null);
    };
    library.signal.addEventListener('abort', invalidate, { once: true });
    if (!NativePdfView) setPhase('unavailable');
    else if (library.isCurrent()) {
      void getPdfOriginal(library.handle, bookId)
        .then((value) => {
          if (!alive.current || !library.isCurrent()) return;
          setSource(value);
          setPhase(value ? 'opening' : 'missing');
        })
        .catch((error) => {
          if (alive.current && library.isCurrent())
            setPhase(String(error).includes('PDF_MODULE_UNAVAILABLE') ? 'unavailable' : 'error');
        });
    }
    return () => {
      alive.current = false;
      library.signal.removeEventListener('abort', invalidate);
    };
  }, [bookId, library]);

  function finish() {
    alive.current = false;
    clearSearch();
    setPassword('');
    setViewPassword('');
    if (library.isCurrent()) close();
  }

  function reopen() {
    if (access.current.blocked || !alive.current || !library.isCurrent()) return;
    evidenceRequest.current = null;
    confirmedEvidence.current = null;
    const request = { page, id: Crypto.randomUUID() };
    currentView.current = { documentId, navigationId: request.id };
    setNavigation(request);
    setAttempt((value) => value + 1);
    setPhase('opening');
  }

  async function linkOriginal() {
    if (access.current.blocked || linkBusy.current || !alive.current || !library.isCurrent())
      return;
    const revision = access.current.revision;
    const current = () =>
      alive.current &&
      library.isCurrent() &&
      !access.current.blocked &&
      access.current.revision === revision;
    linkBusy.current = true;
    setLinking(true);
    setError('');
    let pickedURI: string | undefined;
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selection.canceled) return;
      pickedURI = selection.assets[0]?.uri;
      if (!pickedURI || !current()) return;
      library.assertCurrent();
      const original = await retainPdfOriginal(library.handle, bookId, pickedURI);
      library.assertCurrent();
      if (!current()) return;
      setSource(original);
      setViewPassword('');
      setPassword('');
      reopen();
    } catch (error) {
      if (current())
        setError(
          String(error).includes('PDF_ORIGINAL_MISMATCH')
            ? t('pdfOriginalMismatch')
            : t('pdfOriginalSaveError'),
        );
    } finally {
      if (pickedURI) discardPdf(pickedURI);
      linkBusy.current = false;
      if (alive.current && library.isCurrent()) setLinking(false);
    }
  }

  function unlock() {
    if (access.current.blocked || !password || !library.isCurrent()) return;
    setViewPassword(password);
    setPassword('');
    setError('');
    reopen();
  }

  return (
    <Modal
      visible={!inaccessible}
      onShow={onShow}
      onDismiss={onDismiss}
      animationType={blocked ? 'none' : 'slide'}
      presentationStyle="fullScreen"
      onRequestClose={finish}
    >
      <SafeAreaProvider
        initialMetrics={initialWindowMetrics}
        style={{ flex: 1, backgroundColor: colors.surface, opacity: inaccessible ? 0 : 1 }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.sheetHeader, { borderColor: colors.border }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text accessibilityRole="header" style={[styles.subtitle, { color: colors.ink }]}>
                  {t('pdfOriginal')}
                </Text>
                {!!title && (
                  <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
                    {title}
                  </Text>
                )}
              </View>
              {pdfSearchAvailable && phase === 'ready' && (
                <IconButton
                  icon={searchOpen ? 'search' : 'search-outline'}
                  label={t(searchOpen ? 'pdfSearchClose' : 'pdfSearch')}
                  onPress={() => {
                    if (searchOpen) {
                      clearSearch();
                      Keyboard.dismiss();
                    }
                    setSearchOpen((value) => !value);
                  }}
                />
              )}
              <IconButton icon="close" label={t('close')} onPress={finish} />
            </View>
            {pdfSearchAvailable && searchOpen && phase === 'ready' && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    value={searchDraft}
                    onChangeText={(value) => {
                      evidenceRequest.current = null;
                      confirmedEvidence.current = null;
                      setSearchDraft(value);
                    }}
                    accessibilityLabel={t('pdfSearchInput')}
                    placeholder={t('pdfSearchInput')}
                    placeholderTextColor={colors.muted}
                    maxLength={160}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                    onSubmitEditing={submitSearch}
                    style={[
                      styles.input,
                      { flex: 1, color: colors.ink, borderColor: colors.border },
                    ]}
                  />
                  <IconButton
                    icon="search-outline"
                    label={t('pdfSearchSubmit')}
                    disabled={navigating || !searchDraft.trim()}
                    onPress={submitSearch}
                  />
                  <IconButton
                    icon="close-circle-outline"
                    label={t('pdfSearchClear')}
                    disabled={!searchDraft && !activeSearch?.query}
                    onPress={() => {
                      setSearchDraft('');
                      clearSearch();
                      Keyboard.dismiss();
                    }}
                  />
                </View>
                {activeSearch?.status === 'searching' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color={colors.accent} />
                    <Text
                      accessibilityLiveRegion="polite"
                      style={{ color: colors.muted, fontSize: 12 }}
                    >
                      {t('pdfSearching', { page: activeSearch.scannedPages, total })}
                    </Text>
                  </View>
                ) : activeSearch?.status === 'complete' ? (
                  <View style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text
                        accessibilityLiveRegion="polite"
                        style={{ flex: 1, color: colors.muted, fontSize: 12 }}
                      >
                        {activeSearch.matches.length
                          ? searchIndex < 0
                            ? t('pdfSearchFound', { count: activeSearch.matches.length })
                            : t('pdfSearchMatch', {
                                index: searchIndex + 1,
                                total: activeSearch.matches.length,
                                page: activeSearch.matches[searchIndex]?.page ?? page,
                              })
                          : t(activeSearch.hasText ? 'pdfSearchNoResults' : 'pdfSearchNoText')}
                      </Text>
                      {!!activeSearch.matches.length && (
                        <>
                          <IconButton
                            icon="chevron-up"
                            label={t('pdfSearchPrevious')}
                            disabled={navigating}
                            onPress={() => goToMatch(-1)}
                          />
                          <IconButton
                            icon="chevron-down"
                            label={t('pdfSearchNext')}
                            disabled={navigating}
                            onPress={() => goToMatch(1)}
                          />
                        </>
                      )}
                    </View>
                    {activeSearch.limited && (
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {t('pdfSearchLimited', { count: 2000 })}
                      </Text>
                    )}
                  </View>
                ) : activeSearch?.status === 'error' ? (
                  <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12 }}>
                    {t('pdfSearchError')}
                  </Text>
                ) : null}
              </View>
            )}
            {(phase === 'opening' || phase === 'ready') && source && NativePdfView ? (
              <View style={{ flex: 1 }}>
                <NativePdfView
                  key={documentId}
                  style={{ flex: 1 }}
                  uri={source.uri}
                  {...(pdfScopedOriginalAvailable
                    ? { libraryScope: library.handle.attachmentScope }
                    : {})}
                  password={viewPassword}
                  page={pdfNavigationAvailable ? navigation.page : page}
                  {...(pdfNavigationAvailable ? { documentId, navigationId: navigation.id } : {})}
                  {...(pdfThumbnailsAvailable ? { thumbnails } : {})}
                  {...(pdfSearchAvailable
                    ? {
                        searchQuery: activeSearch?.query ?? '',
                        searchId: nativeSearchId,
                        searchIndex: activeSearch ? searchIndex : -1,
                        onSearch: ({ nativeEvent }: NativeSyntheticEvent<PdfSearchEvent>) =>
                          receiveSearch(nativeEvent),
                      }
                    : {})}
                  onReady={({ nativeEvent }) => {
                    if (
                      !acceptEvent(nativeEvent) ||
                      !Number.isSafeInteger(nativeEvent.totalPages) ||
                      nativeEvent.totalPages < 1 ||
                      nativeEvent.totalPages > 1000 ||
                      !confirmPage(nativeEvent, nativeEvent.totalPages)
                    )
                      return;
                    setTotal(nativeEvent.totalPages);
                    setPhase('ready');
                  }}
                  onPageChange={({ nativeEvent }) => {
                    confirmPage(nativeEvent, total);
                  }}
                  onError={({ nativeEvent }) => {
                    if (!acceptEvent(nativeEvent)) return;
                    if (nativeEvent.code === 'PDF_PASSWORD') {
                      setError(viewPassword ? t('pdfPasswordWrong') : '');
                      setViewPassword('');
                      setPhase('password');
                    } else setPhase('error');
                  }}
                />
                {phase === 'opening' && (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 12,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <ActivityIndicator color={colors.accent} />
                    <Text style={{ color: colors.muted }}>{t('pdfOpening')}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20 }}>
                {phase === 'loading' ? (
                  <ActivityIndicator color={colors.accent} />
                ) : phase === 'password' ? (
                  <>
                    <Text style={{ color: colors.ink }}>{t('pdfPassword')}</Text>
                    <TextInput
                      secureTextEntry
                      autoComplete="off"
                      autoCorrect={false}
                      autoCapitalize="none"
                      value={password}
                      onChangeText={setPassword}
                      maxLength={256}
                      style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
                      accessibilityLabel={t('pdfPassword')}
                      returnKeyType="go"
                      onSubmitEditing={unlock}
                    />
                    <Button disabled={!password} onPress={unlock}>
                      {t('pdfUnlock')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 24 }}>
                      {t(
                        phase === 'unavailable'
                          ? 'pdfUnavailable'
                          : phase === 'missing'
                            ? 'pdfOriginalMissing'
                            : 'pdfOriginalError',
                      )}
                    </Text>
                    {phase === 'error' && source && (
                      <Button
                        secondary
                        onPress={() => {
                          setError('');
                          reopen();
                        }}
                      >
                        {t('retry')}
                      </Button>
                    )}
                    {phase !== 'unavailable' && (
                      <Button busy={linking} onPress={() => void linkOriginal()}>
                        {t('pdfOriginalLink')}
                      </Button>
                    )}
                  </>
                )}
                {!!error && (
                  <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
                    {error}
                  </Text>
                )}
              </View>
            )}
            {phase === 'ready' && (
              <View
                style={{
                  borderTopWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <IconButton
                    icon="chevron-back"
                    label={t('pdfPreviousPage')}
                    disabled={!pdfNavigationAvailable || navigating || page <= 1}
                    onPress={() => goToPage(page - 1)}
                  />
                  {pdfNavigationAvailable ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        accessibilityLabel={t('pdfPageInput')}
                        accessibilityHint={t('pdfPageInputHint', { total })}
                        value={pageInput}
                        onChangeText={(value) => {
                          setPageInput(value);
                          setPageError('');
                        }}
                        keyboardType="number-pad"
                        returnKeyType="go"
                        selectTextOnFocus
                        maxLength={12}
                        editable={!navigating}
                        onSubmitEditing={() => goToPage(inputNumber)}
                        style={[
                          styles.input,
                          {
                            width: 76,
                            color: colors.ink,
                            borderColor: colors.border,
                            textAlign: 'center',
                            fontVariant: ['tabular-nums'],
                          },
                        ]}
                      />
                      <Text style={{ color: colors.muted }}>/ {total}</Text>
                      <IconButton
                        icon="arrow-forward-circle-outline"
                        label={t('pdfGoToPage')}
                        disabled={navigating || !pageInput.trim()}
                        onPress={() => goToPage(inputNumber)}
                      />
                    </View>
                  ) : (
                    <Text style={{ color: colors.ink }}>{t('pageNumber', { page, total })}</Text>
                  )}
                  <IconButton
                    icon="chevron-forward"
                    label={t('pdfNextPage')}
                    disabled={!pdfNavigationAvailable || navigating || page >= total}
                    onPress={() => goToPage(page + 1)}
                  />
                </View>
                {navigating ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={{ color: colors.muted }}>
                      {t('pdfPageOpening', { page: navigation.page })}
                    </Text>
                  </View>
                ) : null}
                {!!pageError && (
                  <Text
                    accessibilityRole="alert"
                    style={{ color: colors.error, fontSize: 12, textAlign: 'center' }}
                  >
                    {pageError}
                  </Text>
                )}
                {pdfThumbnailsAvailable && (
                  <Button
                    secondary
                    icon="albums-outline"
                    onPress={() => setThumbnails((value) => !value)}
                  >
                    {t(thumbnails ? 'pdfHideThumbnails' : 'pdfShowThumbnails')}
                  </Button>
                )}
                {!pdfNavigationAvailable && (
                  <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>
                    {t('pdfNavigationUpdate')}
                  </Text>
                )}
                {onReadPage && (
                  <Button
                    secondary
                    disabled={!readable}
                    onPress={() => {
                      if (
                        !alive.current ||
                        access.current.blocked ||
                        !library.isCurrent() ||
                        !readable ||
                        navigationPending()
                      )
                        return;
                      const originalPage = confirmedPage.current;
                      if (!(canReadPage?.(originalPage) ?? true)) return;
                      const selected = confirmedEvidence.current;
                      const evidence =
                        pdfSearchEvidenceAvailable &&
                        selected &&
                        selected.documentId === currentView.current.documentId &&
                        selected.navigationId === currentView.current.navigationId &&
                        selected.searchId === currentSearch.current.id &&
                        selected.revision === access.current.revision &&
                        selected.page === originalPage
                          ? selected.evidence
                          : undefined;
                      finish();
                      onReadPage(originalPage, evidence);
                    }}
                  >
                    {t('pdfOriginalReadPage')}
                  </Button>
                )}
                {onReadPage && !navigating && !readable && (
                  <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
                    {t('pdfOriginalNoText')}
                  </Text>
                )}
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
