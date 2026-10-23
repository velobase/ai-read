import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { normalizeSearch, type Note, type NoteAnchor } from '@bypage/reading-core';
import {
  readNotesPage,
  removeNote,
  markFinished,
  removeBook,
  type ShelfBook,
  type NotePageCursor,
} from '../adapters/database';
import { shareDiagnostics, shareLibrary } from '../adapters/files';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { ReadingNavigation } from '../components/reading-navigation';
import { NotesExportSheet, type NotesExportScope } from '../components/notes-export-sheet';
import { NoteEditorSheet } from '../components/note-editor-sheet';
import { NoteExcerpt } from '../components/note-excerpt';
import { useSheetPresentation } from '../components/use-sheet-presentation';
import { PrivacySheet } from '../components/privacy-sheet';
import { supportUrl } from '../content/privacy';
import { BookTile, Cover } from '../components/book-card';
import {
  CollectionManagerSheet,
  MoveBooksSheet,
  useCollectionSnapshot,
} from '../components/collection-sheets';
import {
  Button,
  Chip,
  Empty,
  Icon,
  IconButton,
  SectionLabel,
  Sheet,
  styles,
} from '../components/ui';

export type ReadingTarget = { anchor?: NoteAnchor; quote?: string };
export type NotesRoute = {
  bookId?: string;
  query: string;
  page: number;
  /** Start cursor for each visited page; the first page always starts at null. */
  cursors: (NotePageCursor | null)[];
  view?: 'books' | 'recent';
};
export type LibraryRoute = {
  filter: 'all' | 'reading' | 'unread' | 'finished';
  sort: 'sortDefault' | 'sortRecent' | 'sortProgress' | 'sortTitle';
  /** Undefined includes every book; null is the ungrouped shelf. */
  collectionId?: string | null;
};
type BookActions = {
  books: ShelfBook[];
  open: (id: string, paragraph?: string, target?: ReadingTarget) => void;
  more: (book: ShelfBook) => void;
};
export function LibraryScreen({
  books,
  open,
  more,
  importBook,
  busy,
  search,
  refresh,
  route,
  onRouteChange,
}: BookActions & {
  importBook: () => void;
  busy: boolean;
  search: () => void;
  refresh: () => Promise<void>;
  route: LibraryRoute;
  onRouteChange: (route: LibraryRoute) => void;
}) {
  const { colors, t, notify } = useApp();
  const library = useLibrary();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 350 || fontScale > 1.3 ? 2 : width > 700 ? 5 : 3;
  const coverWidth = (Math.min(width, 900) - 44 - (columns - 1) * 22) / columns;
  const { filter, sort, collectionId } = route;
  const collections = useCollectionSnapshot();
  const { snapshot, loading: loadingCollections, failed: collectionsFailed } = collections;
  const [selection, setSelection] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const mounted = useRef(true);
  const [moving, setMoving] = useState<string[] | null>(null);
  const panels = useSheetPresentation<'options' | 'collections'>({
    library,
    group: (sheet) => sheet,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [library]);
  useEffect(() => {
    // Book removal cascades membership rows without a collection-only event.
    void collections.refresh();
  }, [books, collections.refresh]);
  useEffect(() => {
    if (
      typeof collectionId === 'string' &&
      snapshot &&
      !loadingCollections &&
      !collectionsFailed &&
      !snapshot.groups.some((group) => group.id === collectionId) &&
      !workingRef.current
    ) {
      setSelection(false);
      setSelected(new Set());
      onRouteChange({ ...route, collectionId: undefined });
    }
  }, [collectionId, snapshot, loadingCollections, collectionsFailed, route, onRouteChange]);
  const membership = (id: string) =>
    snapshot && Object.hasOwn(snapshot.memberships, id) ? snapshot.memberships[id] : undefined;
  const inCollection = (book: ShelfBook) =>
    collectionId === undefined ||
    (!!snapshot &&
      !collectionsFailed &&
      (collectionId === null ? !membership(book.id) : membership(book.id) === collectionId));
  const collectionBooks = books.filter(inCollection);
  const filtered = books
    .filter(inCollection)
    .filter(
      (b) =>
        filter === 'all' ||
        (filter === 'finished'
          ? b.finished
          : filter === 'reading'
            ? !b.finished && (b.lastOpened > 0 || b.hasPosition)
            : !b.finished && !b.lastOpened && !b.hasPosition),
    )
    .slice()
    .sort((a, b) =>
      sort === 'sortTitle'
        ? a.title.localeCompare(b.title)
        : sort === 'sortProgress'
          ? b.progress - a.progress
          : sort === 'sortRecent'
            ? b.importedAt - a.importedAt
            : 0,
    );
  const visibleIds = new Set(filtered.map((book) => book.id));
  const visibleIdentity = JSON.stringify([...visibleIds]);
  const selectedIds = [...selected].filter((id) => visibleIds.has(id));
  useEffect(() => {
    if (!library.isCurrent() || workingRef.current || moving) return;
    const visible = new Set<string>(JSON.parse(visibleIdentity));
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleIdentity, moving, working]);
  const toggle = (id: string) =>
    setSelected((old) => {
      if (workingRef.current || moving || !visibleIds.has(id)) return old;
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const finishSelection = () => {
    if (workingRef.current) return;
    setSelection(false);
    setSelected(new Set());
  };
  const changeRoute = (change: Partial<LibraryRoute>) => {
    if (!library.isCurrent() || workingRef.current || moving) return;
    finishSelection();
    onRouteChange({ ...route, ...change });
  };
  const batch = (remove = false) => {
    if (!library.isCurrent() || !selectedIds.length || workingRef.current || moving) return;
    const ids = [...selectedIds];
    workingRef.current = true;
    setWorking(true);
    void (async () => {
      for (const id of ids) {
        library.assertCurrent();
        if (remove) await removeBook(library.handle, id);
        else await markFinished(library.handle, id, true);
      }
      library.assertCurrent();
      await refresh();
      library.assertCurrent();
      await collections.refresh();
      if (mounted.current && library.isCurrent()) {
        setSelection(false);
        setSelected(new Set());
      }
    })()
      .catch(async () => {
        if (!library.isCurrent()) return;
        notify(t('error'));
        // Existing batch actions can partially finish before a later book fails.
        await Promise.allSettled([refresh(), collections.refresh()]);
      })
      .finally(() => {
        if (!library.isCurrent()) return;
        workingRef.current = false;
        if (mounted.current && library.isCurrent()) setWorking(false);
      });
  };
  const blocked = working || moving !== null;
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        key={columns}
        initialNumToRender={12}
        maxToRenderPerBatch={6}
        windowSize={5}
        numColumns={columns}
        data={filtered}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: 16,
          paddingBottom: selection ? 104 : 30,
          maxWidth: 900,
          width: '100%',
          alignSelf: 'center',
        }}
        columnWrapperStyle={{ gap: 22 }}
        renderItem={({ item }) => (
          <BookTile
            book={item}
            width={coverWidth}
            selection={selection}
            selected={selected.has(item.id)}
            open={() => {
              if (!library.isCurrent() || workingRef.current || moving) return;
              if (selection) toggle(item.id);
              else open(item.id);
            }}
            more={() => {
              if (!library.isCurrent() || workingRef.current || moving) return;
              if (selection) toggle(item.id);
              else more(item);
            }}
          />
        )}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 24 }}>
            <View style={styles.spread}>
              <Text
                accessibilityRole="header"
                style={{ fontSize: 28, fontWeight: '700', color: colors.ink, flex: 1 }}
              >
                {selection ? t('selectedCount', { n: selectedIds.length }) : t('library')}
              </Text>
              {selection ? (
                <Button secondary disabled={blocked} onPress={finishSelection}>
                  {t('cancel')}
                </Button>
              ) : (
                <View style={{ flexDirection: 'row' }}>
                  <IconButton
                    icon="search-outline"
                    label={t('search')}
                    disabled={blocked}
                    onPress={search}
                  />
                  <IconButton
                    icon="add"
                    label={t('import')}
                    disabled={busy || blocked}
                    onPress={importBook}
                  />
                  <IconButton
                    icon="ellipsis-horizontal"
                    label={t('more')}
                    disabled={blocked}
                    onPress={() => panels.request('options')}
                  />
                </View>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 4 }}
            >
              {(['all', 'reading', 'finished', 'unread'] as const).map((key) => (
                <Chip
                  key={key}
                  active={filter === key}
                  disabled={blocked}
                  onPress={() => changeRoute({ filter: key })}
                >
                  {t(key)}
                </Chip>
              ))}
            </ScrollView>
            {collectionId !== undefined && (
              <Pressable
                accessibilityRole="button"
                disabled={blocked}
                onPress={() => panels.request('options')}
                style={styles.spread}
              >
                <Text style={{ color: colors.muted, fontSize: 14 }}>
                  {collectionId === null
                    ? t('collectionsUngrouped')
                    : snapshot?.groups.find((group) => group.id === collectionId)?.name ||
                      t('collectionsTitle')}
                </Text>
                <Icon name="chevron-down" size={16} color={colors.muted} />
              </Pressable>
            )}
            {collectionsFailed && (
              <View style={{ gap: 8 }}>
                <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13 }}>
                  {t('collectionsLoadError')}
                </Text>
                <Button secondary disabled={blocked} onPress={() => void collections.refresh()}>
                  {t('retry')}
                </Button>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          collectionId !== undefined && (!snapshot || collectionsFailed) ? null : (
            <Empty
              title={t(
                !books.length
                  ? 'empty'
                  : collectionId !== undefined && !collectionBooks.length
                    ? 'collectionsGroupEmpty'
                    : 'noResults',
              )}
            >
              {!books.length ? (
                <Button onPress={importBook} busy={busy} disabled={blocked}>
                  {t('import')}
                </Button>
              ) : (
                <Button
                  secondary
                  disabled={blocked}
                  onPress={() => changeRoute({ collectionId: undefined, filter: 'all' })}
                >
                  {t('collectionsAll')}
                </Button>
              )}
            </Empty>
          )
        }
      />
      <Sheet
        visible={panels.sheet === 'options' && panels.visible}
        title={t('more')}
        close={() => panels.request(null)}
        onShow={panels.onShow}
        onDismiss={panels.onDismiss}
      >
        <View style={{ gap: 4 }}>
          {(['sortDefault', 'sortRecent', 'sortProgress', 'sortTitle'] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="radio"
              accessibilityState={{ checked: sort === key }}
              disabled={blocked}
              onPress={() => {
                changeRoute({ sort: key });
                panels.request(null);
              }}
              style={[styles.spread, { minHeight: 44 }]}
            >
              <Text style={{ color: colors.ink, fontSize: 16 }}>{t(key)}</Text>
              {sort === key && <Icon name="checkmark" color={colors.accent} />}
            </Pressable>
          ))}
        </View>
        <SectionLabel>{t('collectionsTitle')}</SectionLabel>
        <View style={{ gap: 4 }}>
          {[
            { id: undefined, name: t('collectionsAll') },
            { id: null, name: t('collectionsUngrouped') },
            ...(snapshot?.groups || []),
          ].map((group) => (
            <Pressable
              key={group.id ?? String(group.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: collectionId === group.id }}
              disabled={
                blocked || (group.id !== undefined && (loadingCollections || collectionsFailed))
              }
              onPress={() => {
                changeRoute({ collectionId: group.id });
                panels.request(null);
              }}
              style={[styles.spread, { minHeight: 44 }]}
            >
              <Text style={{ color: colors.ink, fontSize: 16 }}>{group.name}</Text>
              {collectionId === group.id && <Icon name="checkmark" color={colors.accent} />}
            </Pressable>
          ))}
        </View>
        <Button
          secondary
          disabled={blocked}
          onPress={() => {
            finishSelection();
            panels.request('collections');
          }}
        >
          {t('collectionsManage')}
        </Button>
        <Button
          secondary
          disabled={blocked || !filtered.length}
          onPress={() => {
            panels.request(null);
            setSelection(true);
          }}
        >
          {t('select')}
        </Button>
      </Sheet>
      {selection && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.surface,
            borderTopWidth: 0.5,
            borderColor: colors.border,
            padding: 14,
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-around',
            gap: 12,
          }}
        >
          <Pressable
            disabled={blocked}
            accessibilityRole="button"
            onPress={() => {
              if (!workingRef.current && !moving) setSelected(new Set(filtered.map((b) => b.id)));
            }}
          >
            <Text style={{ color: colors.accent, fontSize: 13 }}>{t('selectAll')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={blocked || !selectedIds.length}
            onPress={() => {
              if (workingRef.current || moving || !selectedIds.length) return;
              setMoving([...selectedIds]);
            }}
          >
            <Text
              style={{ color: colors.accent, fontSize: 13, opacity: selectedIds.length ? 1 : 0.4 }}
            >
              {t('collectionsMove')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={blocked || !selectedIds.length}
            onPress={() => batch()}
          >
            <Text
              style={{ color: colors.accent, fontSize: 13, opacity: selectedIds.length ? 1 : 0.4 }}
            >
              {t('markFinished')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={blocked || !selectedIds.length}
            onPress={() =>
              Alert.alert(t('removeBook'), t('removeWarning'), [
                { text: t('cancel'), style: 'cancel' },
                { text: t('delete'), style: 'destructive', onPress: () => batch(true) },
              ])
            }
          >
            <Text
              style={{ color: colors.error, fontSize: 13, opacity: selectedIds.length ? 1 : 0.4 }}
            >
              {t('delete')}
            </Text>
          </Pressable>
        </View>
      )}
      <MoveBooksSheet
        bookIds={moving}
        close={() => setMoving(null)}
        onMoved={async () => {
          try {
            library.assertCurrent();
            await refresh();
            library.assertCurrent();
            await collections.refresh();
          } finally {
            if (mounted.current && library.isCurrent()) {
              setSelection(false);
              setSelected(new Set());
            }
          }
        }}
      />
      <CollectionManagerSheet
        visible={panels.sheet === 'collections' && panels.visible}
        close={() => panels.request(null)}
        onShow={panels.onShow}
        onDismiss={panels.onDismiss}
      />
    </View>
  );
}
export function NotesScreen({
  books,
  open,
  revision,
  route,
  onRouteChange,
  onChanged,
}: Omit<BookActions, 'more'> & {
  revision: number;
  route: NotesRoute;
  onRouteChange: (route: NotesRoute) => void;
  onChanged: () => Promise<void>;
}) {
  const { colors, t, notify } = useApp();
  const library = useLibrary();
  // App-owned route survives opening a passage and returning to this notebook.
  const { bookId, query, view = 'books' } = route;
  const page =
    Number.isSafeInteger(route.page) &&
    route.page >= 0 &&
    (route.page === 0 || route.cursors?.[route.page])
      ? route.page
      : 0;
  const after = page > 0 ? route.cursors[page] || undefined : undefined;
  const list = useRef<FlatList<Note | ShelfBook>>(null);
  const pageTransition = useRef<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<NotePageCursor>();
  const [loadedScope, setLoadedScope] = useState('');
  const [routeRevision, setRouteRevision] = useState(0);
  const [exporting, setExporting] = useState<{ route: string; scope: NotesExportScope } | null>(
    null,
  );
  const needle = normalizeSearch(query.trim());
  const scope = JSON.stringify([
    library.handle.key,
    library.epoch,
    bookId,
    needle,
    view,
    page,
    after,
  ]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const showBooks = !bookId && !needle && view === 'books';
  const bookMap = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const notebookBooks = useMemo(() => books.filter((book) => book.noteCount > 0), [books]);
  const requestSequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current++;
      request.current?.abort();
    };
  }, [library]);
  const changeRoute = (next: NotesRoute) => {
    if (!library.isCurrent() || mutation.current) return;
    const nextScope = JSON.stringify([
      library.handle.key,
      library.epoch,
      next.bookId,
      normalizeSearch(next.query.trim()),
      next.view || 'books',
      next.page,
      next.page > 0 ? next.cursors[next.page] || undefined : undefined,
    ]);
    // Equivalent spelling/case/spacing or the already selected tab may update
    // the input without invalidating a read whose effect dependencies are unchanged.
    if (nextScope !== scope) {
      requestSequence.current++;
      request.current?.abort();
      // If multiple route actions return to this same scope before a render,
      // restart the read that the first action already cancelled.
      setRouteRevision((value) => value + 1);
    }
    setExporting(null);
    setSelected(null);
    list.current?.scrollToOffset({ offset: 0, animated: false });
    onRouteChange(next);
  };
  const changeCriteria = (change: Partial<Pick<NotesRoute, 'bookId' | 'query' | 'view'>>) => {
    pageTransition.current = null;
    changeRoute({ ...route, ...change, page: 0, cursors: [null] });
  };
  const setBookId = (id?: string) => changeCriteria({ bookId: id, query: '' });
  const refresh = useCallback(async () => {
    if (!library.isCurrent() || !mounted.current || scopeRef.current !== scope) return;
    const sequence = ++requestSequence.current;
    request.current?.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    library.signal.addEventListener('abort', abort, { once: true });
    request.current = controller;
    setLoading(true);
    setFailed(false);
    setNextCursor(undefined);
    try {
      const result = showBooks
        ? { notes: [], nextCursor: undefined }
        : await readNotesPage(library.handle, {
            bookId,
            query: needle,
            after,
            limit: 60,
            signal: controller.signal,
          });
      if (
        !library.isCurrent() ||
        controller.signal.aborted ||
        sequence !== requestSequence.current ||
        scopeRef.current !== scope
      )
        return;
      setNotes(result.notes);
      setNextCursor(result.nextCursor);
      setLoadedScope(scope);
      return true;
    } catch {
      if (
        !library.isCurrent() ||
        controller.signal.aborted ||
        sequence !== requestSequence.current ||
        scopeRef.current !== scope
      )
        return;
      setNotes([]);
      setLoadedScope(scope);
      setFailed(true);
      return false;
    } finally {
      library.signal.removeEventListener('abort', abort);
      if (library.isCurrent() && sequence === requestSequence.current) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [library, bookId, needle, after, scope, showBooks]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), needle ? 220 : 0);
    return () => {
      clearTimeout(timer);
      requestSequence.current++;
      request.current?.abort();
    };
  }, [revision, routeRevision, refresh, needle]);
  useEffect(() => {
    // Also invalidate an export when the route is replaced outside this screen.
    setExporting(null);
  }, [scope]);
  const currentScope = loadedScope === scope;
  const visibleNotes = currentScope ? notes : [];
  const pending = !showBooks && (loading || !currentScope);
  const hasError = !showBooks && currentScope && failed;
  const changePage = (target: number) => {
    if (
      !library.isCurrent() ||
      mutation.current ||
      pageTransition.current === scope ||
      !Number.isSafeInteger(target) ||
      target < 0 ||
      target === page ||
      (target !== 0 && Math.abs(target - page) !== 1)
    )
      return;
    let cursors = route.cursors || [null];
    if (target > page) {
      if (pending || hasError || !nextCursor) return;
      // A refreshed page supplies its current next boundary. Never reuse a
      // future cursor left over from before an edit, deletion or new import.
      cursors = [...cursors.slice(0, page + 1), nextCursor];
    } else if (target === 0) cursors = [null];
    else if (!cursors[target]) return;
    pageTransition.current = scope;
    changeRoute({ ...route, page: target, cursors });
  };
  const edit = (note: Note) => {
    if (!library.isCurrent() || mutation.current || pending || pageTransition.current === scope)
      return;
    setSelected(note);
  };
  const noteSaved = (note: Note) => {
    if (!mounted.current || !library.isCurrent()) return;
    setNotes((current) =>
      current.map((item) => (item.bookId === note.bookId && item.id === note.id ? note : item)),
    );
    notify(t('saved'));
    // The editor has committed already. Refresh failures must not suggest saving again.
    void Promise.allSettled([refresh(), onChanged()]).then((results) => {
      if (
        mounted.current &&
        library.isCurrent() &&
        (results.some((result) => result.status === 'rejected') ||
          (results[0].status === 'fulfilled' && results[0].value === false))
      )
        notify(t('noteSavedRefreshError'));
    });
  };
  const remove = async (note: Note) => {
    if (!library.isCurrent() || mutation.current || !mounted.current || scopeRef.current !== scope)
      return;
    mutation.current = true;
    setBusy(true);
    try {
      await removeNote(library.handle, note);
      if (!mounted.current || !library.isCurrent()) return;
      setNotes((current) =>
        current.filter((item) => item.bookId !== note.bookId || item.id !== note.id),
      );
      const refreshed = await Promise.allSettled([refresh(), onChanged()]);
      if (
        mounted.current &&
        library.isCurrent() &&
        (refreshed.some((result) => result.status === 'rejected') ||
          (refreshed[0].status === 'fulfilled' && refreshed[0].value === false))
      )
        notify(t('error'));
    } catch {
      if (mounted.current && library.isCurrent()) notify(t('error'));
    } finally {
      if (!library.isCurrent()) return;
      mutation.current = false;
      if (mounted.current && library.isCurrent()) setBusy(false);
    }
  };
  const pagination = () =>
    !showBooks && (page > 0 || !!nextCursor) ? (
      <View style={{ gap: 10, paddingVertical: 12 }}>
        <Text style={{ color: colors.muted, fontSize: 12 }} accessibilityLiveRegion="polite">
          {pending || hasError
            ? t('page', { n: page + 1 })
            : t('notesPage', { page: page + 1, count: visibleNotes.length })}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button secondary disabled={busy || page === 0} onPress={() => changePage(page - 1)}>
              {t('notesPreviousPage')}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              disabled={busy || pending || hasError || !nextCursor}
              onPress={() => changePage(page + 1)}
            >
              {t('notesNextPage')}
            </Button>
          </View>
        </View>
        {page > 0 && (
          <Button secondary disabled={busy} onPress={() => changePage(0)}>
            {t('notesFirstPage')}
          </Button>
        )}
      </View>
    ) : null;
  return (
    <>
      <FlatList<Note | ShelfBook>
        ref={list}
        data={showBooks ? notebookBooks : visibleNotes}
        keyExtractor={(item) =>
          JSON.stringify('noteCount' in item ? ['book', item.id] : ['note', item.bookId, item.id])
        }
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={5}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: showBooks ? 4 : 0 }}>
            <View style={styles.spread}>
              {bookId && (
                <IconButton
                  icon="chevron-back"
                  label={t('back')}
                  disabled={busy}
                  onPress={() => setBookId(undefined)}
                />
              )}
              <Text
                accessibilityRole="header"
                numberOfLines={2}
                style={[styles.title, { color: colors.ink, flex: 1 }]}
              >
                {bookId ? bookMap.get(bookId)?.title || t('notes') : t('notes')}
              </Text>
              <IconButton
                icon="share-outline"
                label={t('notesExport')}
                disabled={busy}
                onPress={() => {
                  if (!mutation.current)
                    setExporting({
                      route: scope,
                      scope: { bookId, query: query.trim() || undefined },
                    });
                }}
              />
            </View>
            {!bookId && (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {(['books', 'recent'] as const).map((choice) => (
                  <Chip
                    key={choice}
                    active={view === choice}
                    onPress={() => changeCriteria({ view: choice })}
                  >
                    {t(choice === 'books' ? 'notesByBook' : 'notesRecent')}
                  </Chip>
                ))}
              </View>
            )}
            <TextInput
              value={query}
              editable={!busy}
              onChangeText={(query) => changeCriteria({ query })}
              maxLength={160}
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={t(bookId ? 'searchAllNotes' : 'searchLibraryNotes')}
              placeholder={t(bookId ? 'searchAllNotes' : 'searchLibraryNotes')}
              placeholderTextColor={colors.muted}
              style={[styles.input, { color: colors.ink, borderColor: colors.border }]}
            />
            {pending && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.accent} />
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {t(needle ? 'searchingNotes' : 'loadingNotes')}
                </Text>
              </View>
            )}
            {hasError && (
              <Button secondary onPress={() => void refresh()}>
                {t('retry')}
              </Button>
            )}
          </View>
        }
        renderItem={({ item }) =>
          'noteCount' in item ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setBookId(item.id)}
              style={{
                paddingVertical: 20,
                borderBottomWidth: 0.5,
                borderColor: colors.border,
                flexDirection: 'row',
                gap: 20,
                alignItems: 'center',
                marginTop: 16,
              }}
            >
              <View style={{ flex: 1, gap: 12 }}>
                <Text style={{ fontSize: 17, fontWeight: '500', color: colors.ink }}>
                  {item.title}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}
                >
                  {t('notesCount', { n: item.noteCount })}
                </Text>
              </View>
              <Cover book={item} width={65} />
            </Pressable>
          ) : (
            <View
              style={{
                paddingVertical: 20,
                borderBottomWidth: 0.5,
                borderColor: colors.border,
                marginTop: 15,
                gap: 14,
              }}
            >
              <Text numberOfLines={1} style={{ color: colors.accent, fontSize: 11 }}>
                {bookMap.get(item.bookId)?.title} ·{' '}
                {t(
                  item.anchor?.source === 'translation'
                    ? 'translation'
                    : item.anchor?.source === 'original'
                      ? 'original'
                      : 'noteSourceUnknown',
                )}
              </Text>
              <Pressable
                onPress={() => {
                  if (!mutation.current && !pending && pageTransition.current !== scope)
                    open(item.bookId, item.paragraphId, item);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('readPassage')}
              >
                <NoteExcerpt text={item.quote} query={query} />
              </Pressable>
              {!!item.text && <NoteExcerpt text={item.text} query={query} thought />}
              <View style={styles.spread}>
                <Text style={{ color: colors.muted, fontSize: 10 }}>
                  {new Date(item.createdAt).toLocaleDateString()}
                </Text>
                <View style={styles.row}>
                  <IconButton
                    icon="create-outline"
                    label={t('editNote')}
                    disabled={busy || pending}
                    onPress={() => edit(item)}
                  />
                  <IconButton
                    icon="trash-outline"
                    label={t('delete')}
                    disabled={busy || pending}
                    onPress={() =>
                      Alert.alert(t('deleteNote'), '', [
                        { text: t('cancel'), style: 'cancel' },
                        {
                          text: t('delete'),
                          style: 'destructive',
                          onPress: () => void remove(item),
                        },
                      ])
                    }
                  />
                </View>
              </View>
            </View>
          )
        }
        ListEmptyComponent={
          !pending && !hasError ? (
            <Empty title={t(needle || page > 0 ? 'noResults' : 'notesEmpty')} />
          ) : null
        }
        ListFooterComponent={pagination()}
      />
      <NoteEditorSheet
        note={selected}
        bookTitle={selected ? bookMap.get(selected.bookId)?.title : undefined}
        close={() => setSelected(null)}
        onSaved={noteSaved}
      />
      <NotesExportSheet
        scope={exporting?.route === scope ? exporting.scope : null}
        close={() => setExporting(null)}
      />
    </>
  );
}
export function SettingsContent({ importBook }: { importBook: () => void }) {
  const { colors, preferences, patch, t, notify } = useApp();
  const library = useLibrary();
  const zh = preferences.locale === 'zh-CN';
  const [busy, setBusy] = useState(false);
  const panels = useSheetPresentation<'language' | 'reading' | 'data' | 'diagnostics' | 'privacy'>({
    library,
    group: (sheet) => (sheet === 'privacy' ? 'privacy' : 'settings'),
  });
  const afterDismiss = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (panels.sheet !== null || !afterDismiss.current) return;
    const action = afterDismiss.current;
    afterDismiss.current = null;
    if (library.isCurrent()) action();
  }, [panels.sheet, library]);
  const run = (action: () => Promise<unknown>) => {
    if (!library.isCurrent()) return;
    setBusy(true);
    void action()
      .catch(() => {
        if (library.isCurrent()) notify(t('error'));
      })
      .finally(() => {
        if (library.isCurrent()) setBusy(false);
      });
  };
  const readingTitle = zh ? '阅读偏好' : 'Reading preferences';
  const row = (label: string, action: () => void, value?: string) => (
    <Pressable
      accessibilityRole="button"
      onPress={action}
      style={[styles.spread, { minHeight: 54, borderBottomWidth: 0.5, borderColor: colors.border }]}
    >
      <Text style={{ color: colors.ink, fontSize: 16, flex: 1 }}>{label}</Text>
      {!!value && <Text style={{ color: colors.muted, fontSize: 14 }}>{value}</Text>}
      <Icon name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
  return (
    <>
      <View>
        {row(t('language'), () => panels.request('language'), zh ? '简体中文' : 'English')}
        {row(readingTitle, () => panels.request('reading'))}
        {row(t('transfer'), () => panels.request('data'))}
        {row(t('privacyPolicy'), () => panels.request('privacy'))}
        {row(
          t('helpSupport'),
          () => void Linking.openURL(supportUrl).catch(() => notify(t('error'))),
        )}
        {row(t('diagnostics'), () => panels.request('diagnostics'))}
      </View>
      <Sheet
        visible={panels.sheet !== 'privacy' && panels.visible}
        title={
          panels.sheet === 'language'
            ? t('language')
            : panels.sheet === 'reading'
              ? readingTitle
              : panels.sheet === 'diagnostics'
                ? t('diagnostics')
                : t('transfer')
        }
        close={() => {
          if (!busy) panels.request(null);
        }}
        onShow={panels.onShow}
        onDismiss={panels.onDismiss}
      >
        {panels.sheet === 'language' && (
          <View style={{ gap: 4 }}>
            {(
              [
                ['en', 'English'],
                ['zh-CN', '简体中文'],
              ] as const
            ).map(([locale, label]) => (
              <Pressable
                key={locale}
                accessibilityRole="radio"
                accessibilityState={{ checked: preferences.locale === locale }}
                onPress={() => {
                  patch({ locale });
                  panels.request(null);
                }}
                style={[styles.spread, { minHeight: 48 }]}
              >
                <Text style={{ color: colors.ink, fontSize: 16 }}>{label}</Text>
                {preferences.locale === locale && <Icon name="checkmark" color={colors.accent} />}
              </Pressable>
            ))}
          </View>
        )}
        {panels.sheet === 'reading' && (
          <>
            <SectionLabel>{t('theme')}</SectionLabel>
            <View style={styles.row}>
              <Chip
                active={preferences.theme === 'paper'}
                onPress={() => patch({ theme: 'paper' })}
              >
                {t('paper')}
              </Chip>
              <Chip
                active={preferences.theme === 'night'}
                onPress={() => patch({ theme: 'night' })}
              >
                {t('night')}
              </Chip>
            </View>
            <ReadingNavigation />
          </>
        )}
        {panels.sheet === 'data' && (
          <>
            <Button
              secondary
              onPress={() => {
                afterDismiss.current = importBook;
                panels.request(null);
              }}
            >
              {t('import')}
            </Button>
            <Button secondary busy={busy} onPress={() => run(() => shareLibrary(library))}>
              {t('export')}
            </Button>
            <Text style={[styles.description, { color: colors.muted }]}>{t('exportHint')}</Text>
          </>
        )}
        {panels.sheet === 'diagnostics' && (
          <>
            <Text style={[styles.description, { color: colors.muted }]}>
              {t('diagnosticsHint')}
            </Text>
            <Button secondary busy={busy} onPress={() => run(shareDiagnostics)}>
              {t('diagnostics')}
            </Button>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{t('version')}</Text>
          </>
        )}
      </Sheet>
      <PrivacySheet
        visible={panels.sheet === 'privacy' && panels.visible}
        close={() => panels.request(null)}
        onShow={panels.onShow}
        onDismiss={panels.onDismiss}
      />
    </>
  );
}
