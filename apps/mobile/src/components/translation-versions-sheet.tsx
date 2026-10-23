import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { safeReadingQuote, type SavedTranslationVersion } from '@bypage/reading-core';
import { listParagraphTranslationVersions } from '../adapters/database';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Button, Sheet } from './ui';

const BATCH_SIZE = 20;
type TranslationVersionsProps = {
  bookId: string;
  paragraphId: string;
  language: string;
  currentKey?: string;
  choose: (key: string, isCurrent: () => boolean) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

/** Compatibility wrapper; reader tool panes share one Sheet and use the content directly. */
export function TranslationVersionsSheet(props: TranslationVersionsProps & { close: () => void }) {
  const { preferences } = useApp();
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Sheet
      visible
      tall
      scrollable={false}
      title={
        preferences.locale.startsWith('zh') ? '这段的译文版本' : 'Saved versions of this passage'
      }
      close={() => {
        if (busy.current) return;
        alive.current = false;
        props.close();
      }}
    >
      <TranslationVersionsContent
        {...props}
        choose={(key, current) => props.choose(key, () => alive.current && current())}
        onBusyChange={(value) => {
          busy.current = value;
          props.onBusyChange?.(value);
        }}
      />
    </Sheet>
  );
}

/** No Modal/Sheet: the parent keeps its existing native presentation while changing tools. */
export function TranslationVersionsContent({
  bookId,
  paragraphId,
  language,
  currentKey,
  choose,
  onBusyChange,
}: TranslationVersionsProps) {
  const library = useLibrary();
  const { colors, preferences } = useApp();
  const zh = preferences.locale.startsWith('zh');
  const scope = useMemo(
    () => ({ library, bookId, paragraphId, language }),
    [library, bookId, paragraphId, language],
  );
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [loadedScope, setLoadedScope] = useState<typeof scope>();
  const [items, setItems] = useState<SavedTranslationVersion[]>([]);
  const [limit, setLimit] = useState(BATCH_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const [saving, setSaving] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const loadingRef = useRef(true);
  const busy = useRef<{ scope: typeof scope } | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const request = ++generation.current;
    const owns = () =>
      mounted.current && activeScope.current === scope && generation.current === request;
    busy.current = null;
    busyCallback.current?.(false);
    loadingRef.current = true;
    setLoadedScope(scope);
    setItems([]);
    setLimit(BATCH_SIZE);
    setLoading(true);
    setError(null);
    setSaving(undefined);
    const revoked = () => {
      if (!owns()) return;
      generation.current++;
      busy.current = null;
      busyCallback.current?.(false);
      loadingRef.current = false;
      setItems([]);
      setLoading(false);
      setError(null);
      setSaving(undefined);
    };
    library.signal.addEventListener('abort', revoked, { once: true });
    if (!library.isCurrent()) revoked();
    else
      void listParagraphTranslationVersions(library.handle, bookId, language, paragraphId)
        .then((versions) => {
          if (owns() && library.isCurrent()) setItems(versions);
        })
        .catch(() => {
          if (owns() && library.isCurrent()) setError('load');
        })
        .finally(() => {
          if (owns() && library.isCurrent()) {
            loadingRef.current = false;
            setLoading(false);
          }
        });
    return () => {
      library.signal.removeEventListener('abort', revoked);
      if (generation.current === request) generation.current++;
      mounted.current = false;
      busy.current = null;
      busyCallback.current?.(false);
    };
  }, [scope, library, bookId, language, paragraphId, attempt]);
  // Hide old rows synchronously, before the new scope's effect can run.
  const ownsScope = loadedScope === scope && library.isCurrent();
  const visibleItems = ownsScope ? items : [];
  const pending = ownsScope ? loading : library.isCurrent();
  const visibleError = ownsScope ? error : null;
  const visibleSaving = ownsScope ? saving : undefined;
  const data = useMemo(() => visibleItems.slice(0, limit), [visibleItems, limit]);
  const select = (key: string) => {
    if (
      !mounted.current ||
      activeScope.current !== scope ||
      !library.isCurrent() ||
      loadingRef.current ||
      busy.current
    )
      return;
    const request = generation.current;
    const operation = { scope };
    busy.current = operation;
    busyCallback.current?.(true);
    setSaving(key);
    setError(null);
    const owns = () =>
      mounted.current &&
      activeScope.current === scope &&
      generation.current === request &&
      library.isCurrent();
    void Promise.resolve()
      .then(() => {
        if (owns()) return choose(key, owns);
      })
      .catch(() => {
        if (owns()) setError('save');
      })
      .finally(() => {
        if (busy.current === operation) {
          busy.current = null;
          if (mounted.current && activeScope.current === scope) busyCallback.current?.(false);
        }
        if (owns()) setSaving(undefined);
      });
  };
  return (
    <FlatList
      style={{ flex: 1 }}
      key={JSON.stringify([library.handle.key, library.epoch, bookId, paragraphId, language])}
      data={data}
      keyExtractor={(item) => item.key}
      extraData={[visibleSaving, currentKey, colors]}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={5}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 22, gap: 16 }}
      ListHeaderComponent={
        <View style={{ gap: 16 }}>
          <Text style={{ color: colors.muted, lineHeight: 22 }}>
            {zh
              ? '选择这段要显示的译文。已有笔记和书签仍指向保存时的版本。'
              : 'Choose the text to read here. Existing notes and bookmarks keep their saved version.'}
          </Text>
          {pending && <ActivityIndicator color={colors.accent} />}
          {visibleError && (
            <View style={{ gap: 12 }}>
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {zh
                  ? '版本暂时无法读取或保存，请重试。'
                  : 'Could not read or save versions. Please try again.'}
              </Text>
              {visibleError === 'load' && (
                <Button
                  secondary
                  onPress={() => {
                    if (loadingRef.current || busy.current || !library.isCurrent()) return;
                    loadingRef.current = true;
                    setLoading(true);
                    setError(null);
                    setAttempt((value) => value + 1);
                  }}
                >
                  {zh ? '重试' : 'Retry'}
                </Button>
              )}
            </View>
          )}
          {!pending && !visibleError && visibleItems.length > 0 && (
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {zh
                ? `显示 ${data.length} / ${visibleItems.length} 个版本`
                : `Showing ${data.length} of ${visibleItems.length} versions`}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        !pending && !visibleError && library.isCurrent() ? (
          <Text style={{ color: colors.muted }}>
            {zh ? '这段还没有已保存的译文。' : 'No translation has been saved for this passage.'}
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <View
          style={{
            gap: 12,
            paddingVertical: 16,
            borderBottomWidth: 0.5,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {item.kind === 'published'
              ? zh
                ? '章节译本'
                : 'Chapter edition'
              : item.kind === 'portable'
                ? zh
                  ? '阅读包译文'
                  : 'Reading pack'
                : zh
                  ? '保存的译文'
                  : 'Saved translation'}
            {' · '}
            {new Date(item.createdAt).toLocaleString()}
          </Text>
          <Text numberOfLines={6} style={{ color: colors.ink, lineHeight: 26 }}>
            {safeReadingQuote(item.text, 0, 600)}
            {item.text.length > 600 ? '…' : ''}
          </Text>
          <Button
            secondary
            disabled={!!visibleSaving || item.key === currentKey}
            busy={visibleSaving === item.key}
            onPress={() => select(item.key)}
          >
            {item.key === currentKey
              ? zh
                ? '已选版本'
                : 'Selected for reading'
              : zh
                ? '使用此版本'
                : 'Read this version'}
          </Button>
        </View>
      )}
      ListFooterComponent={
        data.length < visibleItems.length ? (
          <Button
            secondary
            disabled={!!visibleSaving}
            onPress={() => {
              if (!library.isCurrent() || busy.current || activeScope.current !== scope) return;
              setLimit((value) => Math.min(visibleItems.length, value + BATCH_SIZE));
            }}
          >
            {zh ? '显示更多版本' : 'Show more versions'}
          </Button>
        ) : null
      }
    />
  );
}
