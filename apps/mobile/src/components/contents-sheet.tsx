import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  createContentsOutline,
  normalizeSearch,
  visibleContentsOutline,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import { Button, Chip, Icon, IconButton, Sheet, styles } from './ui';

export type ContentsEntry = {
  key: string;
  title: string;
  depth: number;
  order: number;
  chapter: number;
  paragraphId: string;
  sourcePage?: number;
};
type Props = {
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  entries: ContentsEntry[];
  activeKey?: string;
  query: string;
  setQuery: (value: string) => void;
  collapsedKeys: ReadonlySet<string>;
  onCollapsedKeysChange: (keys: ReadonlySet<string>) => void;
  initialLocate: boolean;
  hasPdfContents: boolean;
  pdfPages: boolean;
  setPdfPages: (value: boolean) => void;
  close: () => void;
  bookmarks: () => void;
  search: () => void;
  navigate: (chapter: number, paragraph: string) => void;
};
type ContentsRow = ReturnType<typeof visibleContentsOutline<ContentsEntry>>['rows'][number];

export function ContentsSheet(props: Props) {
  const { t } = useApp();
  return (
    <Sheet
      visible={props.visible ?? true}
      onShow={props.onShow}
      onDismiss={props.onDismiss}
      tall
      scrollable={false}
      title={t('chapters')}
      close={props.close}
    >
      {/* A mode change resets list geometry, never the native modal host. */}
      <ContentsBody
        key={props.hasPdfContents && props.pdfPages ? 'pages' : 'chapters'}
        {...props}
      />
    </Sheet>
  );
}

function ContentsBody({
  visible = true,
  entries,
  activeKey,
  query,
  setQuery,
  collapsedKeys,
  onCollapsedKeysChange,
  initialLocate,
  hasPdfContents,
  pdfPages,
  setPdfPages,
  bookmarks,
  search,
  navigate,
}: Props) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const { blocked } = useLibraryController();
  const { fontScale } = useWindowDimensions();
  const outline = useMemo(() => createContentsOutline(entries), [entries]);
  const projection = useMemo(
    () => visibleContentsOutline(outline, { collapsedKeys, query, activeKey }),
    [outline, collapsedKeys, query, activeKey],
  );
  const normalized = normalizeSearch(query.trim());
  const searching = projection.searching;
  const branchKeys = useMemo(
    () => outline.nodes.filter((node) => node.hasChildren).map((node) => node.key),
    [outline],
  );
  const hierarchical = !pdfPages && branchKeys.length > 0;
  // Every row reserves the same height, including a collapsed ancestor's hint.
  const rowHeight = Math.max(
    hierarchical ? 92 : 86,
    Math.ceil(((hasPdfContents && !pdfPages) || hierarchical ? 58 : 42) * fontScale + 28),
  );
  const rows = projection.rows;
  const activeIndex = rows.findIndex((row) => row.isActive);
  const visibleAncestorIndex = rows.findIndex((row) => row.collapsed && row.isActiveAncestor);
  const initialIndex = useRef(
    searching ? 0 : Math.max(0, activeIndex >= 0 ? activeIndex : visibleAncestorIndex),
  );
  const list = useRef<FlatList<ContentsRow>>(null);
  const mounted = useRef(true);
  const access = useRef({ visible, blocked, library });
  access.current = { visible, blocked, library };
  const isCurrent = () =>
    mounted.current &&
    access.current.visible &&
    !access.current.blocked &&
    access.current.library === library &&
    library.isCurrent();
  const currentCollapsed = useRef(collapsedKeys);
  currentCollapsed.current = collapsedKeys;
  const firstOpen = useRef(initialLocate);
  const pendingLocate = useRef(initialLocate && !searching);
  const contentHeight = useRef(0);
  const previousQuery = useRef(normalized);
  const [locateRequest, setLocateRequest] = useState(0);
  const locateSequence = useRef(0);
  const handledLocate = useRef(0);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingLocate.current = false;
    };
  }, []);

  function updateCollapsed(next: ReadonlySet<string>) {
    if (!isCurrent()) return;
    currentCollapsed.current = next;
    onCollapsedKeysChange(next);
  }
  function cancelLocate() {
    pendingLocate.current = false;
    handledLocate.current = locateSequence.current;
  }
  function expandCurrent(markOpened = false) {
    const next = new Set(currentCollapsed.current);
    let changed = false;
    for (const key of projection.activeAncestorKeys) if (next.delete(key)) changed = true;
    if (changed || markOpened) updateCollapsed(next);
    return changed;
  }
  function locate() {
    if (!isCurrent() || searching || activeIndex < 0 || !pendingLocate.current) return;
    // Expanded rows must reach their new native extent before a deep jump;
    // otherwise ScrollView clamps to the previous short search or branch.
    if (!list.current || contentHeight.current < rows.length * rowHeight - 1) return;
    pendingLocate.current = false;
    list.current.scrollToIndex({ index: activeIndex, viewPosition: 0.35, animated: false });
  }
  useEffect(() => {
    if (!isCurrent()) return;
    let expanding = false;
    if (firstOpen.current) {
      firstOpen.current = false;
      if (!searching) expanding = expandCurrent(true);
      else updateCollapsed(new Set(currentCollapsed.current));
    }
    if (previousQuery.current !== normalized) {
      previousQuery.current = normalized;
      if (searching) {
        pendingLocate.current = false;
        list.current?.scrollToOffset({ offset: 0, animated: false });
      } else {
        // Clearing search restores the user's folded outline. Only a new,
        // explicit Locate request below may expand the current path.
        pendingLocate.current = false;
      }
    }
    if (handledLocate.current !== locateRequest && locateRequest === locateSequence.current) {
      handledLocate.current = locateRequest;
      pendingLocate.current = true;
      expanding = expandCurrent() || expanding;
    }
    if (!expanding) locate();
    // Layout/content-size callbacks finish a pending jump. Ordinary collapses
    // never rearm it; dragging cancels it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, locateRequest, projection, visible, blocked]);

  const changeQuery = (value: string) => {
    if (isCurrent()) setQuery(value);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 12, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              icon="bookmark-outline"
              onPress={() => {
                if (isCurrent()) bookmarks();
              }}
            >
              {t('bookmarks')}
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              icon="search-outline"
              onPress={() => {
                if (isCurrent()) search();
              }}
            >
              {t('searchBook')}
            </Button>
          </View>
        </View>
        {hasPdfContents && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[false, true].map((pages) => (
              <Chip
                key={String(pages)}
                active={pages === pdfPages}
                onPress={() => {
                  if (!isCurrent() || pages === pdfPages) return;
                  cancelLocate();
                  setQuery('');
                  setPdfPages(pages);
                }}
              >
                {t(pages ? 'pdfPageContents' : 'pdfChapterContents')}
              </Chip>
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <TextInput
            accessibilityLabel={t('contentsSearch')}
            value={query}
            onChangeText={changeQuery}
            placeholder={t('contentsSearch')}
            placeholderTextColor={colors.muted}
            editable={visible && !blocked}
            style={[styles.input, { flex: 1, color: colors.ink, borderColor: colors.border }]}
          />
          {!!query && (
            <IconButton
              icon="close-circle-outline"
              label={t('clearSearch')}
              onPress={() => changeQuery('')}
            />
          )}
        </View>
        {hierarchical && !searching && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip
              active={false}
              disabled={!branchKeys.some((key) => collapsedKeys.has(key))}
              onPress={() => {
                if (!isCurrent()) return;
                cancelLocate();
                updateCollapsed(new Set());
              }}
            >
              {t('contentsExpandAll')}
            </Chip>
            <Chip
              active={false}
              disabled={branchKeys.every((key) => collapsedKeys.has(key))}
              onPress={() => {
                if (!isCurrent()) return;
                cancelLocate();
                updateCollapsed(new Set(branchKeys));
              }}
            >
              {t('contentsCollapseAll')}
            </Chip>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !activeKey || blocked }}
            disabled={!activeKey || blocked}
            onPress={() => {
              if (!isCurrent()) return;
              Keyboard.dismiss();
              setQuery('');
              pendingLocate.current = true;
              setLocateRequest(++locateSequence.current);
            }}
            style={{
              minHeight: 36,
              flexDirection: 'row',
              gap: 8,
              alignItems: 'center',
              opacity: activeKey ? 1 : 0.4,
            }}
          >
            <Icon name="locate-outline" color={colors.accent} size={18} />
            <Text style={{ color: colors.accent, fontSize: 14 }}>{t('contentsLocate')}</Text>
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'right', color: colors.muted, fontSize: 12 }}>
            {searching
              ? t('contentsSearchMatches', { n: projection.directMatchCount })
              : t('contentsVisible', { visible: rows.length, total: entries.length })}
          </Text>
        </View>
      </View>
      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(row) => row.key}
        initialScrollIndex={
          rows.length ? Math.min(initialIndex.current, rows.length - 1) : undefined
        }
        getItemLayout={(_data, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        onLayout={locate}
        onContentSizeChange={(_width, height) => {
          if (!isCurrent()) return;
          contentHeight.current = height;
          locate();
        }}
        onScrollBeginDrag={cancelLocate}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 22 }}
        ListEmptyComponent={
          <Text style={{ paddingVertical: 24, color: colors.muted }}>{t('noResults')}</Text>
        }
        renderItem={({ item: row }) => {
          const entry = row.entry;
          const containsCurrent =
            !searching && projection.activeHidden && row.collapsed && row.isActiveAncestor;
          return (
            <View style={{ height: rowHeight, paddingVertical: 6 }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingLeft: Math.min(row.depth, 5) * 12,
                  borderRadius: 12,
                  backgroundColor: row.isActive ? colors.soft : 'transparent',
                }}
              >
                {hierarchical &&
                  !searching &&
                  (row.hasChildren ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        row.collapsed ? 'contentsExpandBranch' : 'contentsCollapseBranch',
                        { title: entry.title },
                      )}
                      accessibilityState={{ expanded: !row.collapsed, disabled: blocked }}
                      disabled={blocked}
                      onPress={() => {
                        if (!isCurrent()) return;
                        cancelLocate();
                        const next = new Set(currentCollapsed.current);
                        if (!next.delete(row.key)) next.add(row.key);
                        updateCollapsed(next);
                      }}
                      style={{
                        width: 40,
                        alignSelf: 'stretch',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon
                        name={row.collapsed ? 'chevron-forward' : 'chevron-down'}
                        size={18}
                        color={colors.muted}
                      />
                    </Pressable>
                  ) : (
                    <View style={{ width: 40 }} />
                  ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    entry.order +
                    1 +
                    '. ' +
                    entry.title +
                    (entry.sourcePage ? ', ' + t('pdfPage', { n: entry.sourcePage }) : '') +
                    (containsCurrent ? ', ' + t('contentsContainsCurrent') : '')
                  }
                  accessibilityState={{ selected: row.isActive, disabled: blocked }}
                  disabled={blocked}
                  onPress={() => {
                    if (isCurrent()) navigate(entry.chapter, entry.paragraphId);
                  }}
                  style={{
                    flex: 1,
                    alignSelf: 'stretch',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 10,
                    paddingRight: 10,
                    paddingLeft: hierarchical && !searching ? 0 : 10,
                  }}
                >
                  <Text style={{ width: 26, color: colors.muted, fontSize: 12 }}>
                    {entry.order + 1}
                  </Text>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: row.isActive
                          ? colors.accent
                          : row.isContext
                            ? colors.muted
                            : colors.ink,
                        fontWeight: row.depth === 0 ? '600' : '400',
                        fontSize: 14,
                        lineHeight: 21,
                      }}
                    >
                      {entry.title}
                    </Text>
                    {containsCurrent ? (
                      <Text numberOfLines={1} style={{ color: colors.accent, fontSize: 11 }}>
                        {t('contentsContainsCurrent')}
                      </Text>
                    ) : (
                      !!entry.sourcePage && (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {t('pdfPage', { n: entry.sourcePage })}
                        </Text>
                      )
                    )}
                  </View>
                  {row.isActive && <Icon name="bookmark" color={colors.accent} size={15} />}
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
