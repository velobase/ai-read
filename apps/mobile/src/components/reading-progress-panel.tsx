import { useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from 'react';
import { Platform, Text, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import * as Crypto from 'expo-crypto';
import {
  isPdfBook,
  readingChapterNavigation,
  readingProgress,
  safeReadingQuote,
  type Book,
  type Paragraph,
} from '@bypage/reading-core';
import { useApp } from '../context';
import { Button, IconButton, styles } from './ui';

type Entry = { chapterIndex: number; paragraph: Paragraph };
type ProgressIndex = { entries: Entry[]; ordinals: Map<string, number> };
const indexes = new WeakMap<Book['chapters'], ProgressIndex>();
function progressIndex(book: Book): ProgressIndex {
  const existing = indexes.get(book.chapters);
  if (existing) return existing;
  const index: ProgressIndex = { entries: [], ordinals: new Map() };
  for (const [chapterIndex, chapter] of book.chapters.entries()) {
    for (const paragraph of chapter.paragraphs) {
      index.ordinals.set(paragraph.id, index.entries.length);
      // Keep immutable source references; never duplicate the book's text for the slider.
      index.entries.push({ chapterIndex, paragraph });
    }
  }
  indexes.set(book.chapters, index);
  return index;
}

type NativeValue = { id: string; commandId: string; sequence: number; value: number };
type SliderHandle = { getValue: () => Promise<NativeValue | null> };
type SliderProps = ViewProps & {
  ref?: Ref<SliderHandle>;
  contentJSON: string;
  onValueChange: (event: NativeSyntheticEvent<NativeValue>) => void;
};
const reader = requireOptionalNativeModule<{ progressSliderVersion?: number }>('ByPageReader');
const NativeSlider: ComponentType<SliderProps> | null =
  Platform.OS === 'ios' && (reader?.progressSliderVersion || 0) >= 1
    ? requireNativeViewManager<SliderProps>('ByPageReader', 'ProgressSlider')
    : null;

type Props = {
  book: Book;
  paragraph: string;
  navigate: (chapter: number, paragraph: string) => void;
};

/** Mount only while the progress panel is open: the preview is local and never persists itself. */
export function ReadingProgressPanel({ book, paragraph, navigate }: Props) {
  const capture = useMemo(() => ({ id: Crypto.randomUUID(), book, paragraph }), [book, paragraph]);
  const active = useRef(capture.id);
  active.current = capture.id;
  return (
    <ProgressPreview
      key={capture.id}
      capture={capture}
      isCurrent={() => active.current === capture.id}
      navigate={navigate}
    />
  );
}

function ProgressPreview({
  capture,
  isCurrent,
  navigate,
}: {
  capture: { id: string; book: Book; paragraph: string };
  isCurrent: () => boolean;
  navigate: Props['navigate'];
}) {
  const { colors, preferences, t } = useApp();
  const { book } = capture;
  const index = useMemo(() => progressIndex(book), [book]);
  const initial = index.ordinals.get(capture.paragraph) ?? -1;
  const [ordinal, setOrdinal] = useState(initial);
  const [command, setCommand] = useState(() => ({ id: Crypto.randomUUID(), value: initial }));
  const commandRef = useRef(command);
  commandRef.current = command;
  const ordinalRef = useRef(ordinal);
  ordinalRef.current = ordinal;
  const sequence = useRef(-1);
  const native = useRef<SliderHandle | null>(null);
  const mounted = useRef(true);
  const confirming = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const entry = index.entries[ordinal];
  const currentEntry = index.entries[initial];
  const currentNavigation = currentEntry
    ? readingChapterNavigation(book, {
        chapter: currentEntry.chapterIndex,
        paragraph: currentEntry.paragraph.id,
      })
    : {};
  const previewNavigation = entry
    ? readingChapterNavigation(book, {
        chapter: entry.chapterIndex,
        paragraph: entry.paragraph.id,
      })
    : {};
  const pdf = isPdfBook(book);
  const sourcePage = entry ? book.chapters[entry.chapterIndex]?.sourcePage : undefined;
  const title =
    previewNavigation.current?.kind === 'page' && sourcePage
      ? t('pdfPage', { n: sourcePage })
      : previewNavigation.current?.title || '';
  const percent = entry
    ? Math.round(readingProgress(book.chapters, { paragraph: entry.paragraph.id, offset: 0 }) * 100)
    : 0;
  const ordinalLabel = t('progressParagraph', {
    current: ordinal + 1,
    total: index.entries.length,
  });
  // UISlider uses Float, which represents every ordinal exactly within this bound.
  const usesNative = !!NativeSlider && index.entries.length <= 16777216;
  const contentJSON = JSON.stringify({
    id: capture.id,
    commandId: command.id,
    value: ordinal,
    maximum: index.entries.length - 1,
    label: t('progressSliderLabel'),
    valueLabel: `${ordinalLabel} · ${percent}%`,
    hint: t('progressPreviewHint'),
    accent: colors.accent,
    track: colors.border,
    enabled: !busy,
  });

  const valid = (value: NativeValue | null): value is NativeValue =>
    !!value &&
    value.id === capture.id &&
    value.commandId === commandRef.current.id &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    Number.isSafeInteger(value.value) &&
    value.value >= 0 &&
    value.value < index.entries.length;
  const step = (delta: number) => {
    if (!mounted.current || !isCurrent() || confirming.current) return;
    const value = Math.max(0, Math.min(index.entries.length - 1, ordinalRef.current + delta));
    const next = { id: Crypto.randomUUID(), value };
    // Change the fence synchronously; a queued event from the previous command is stale now.
    commandRef.current = next;
    ordinalRef.current = value;
    setCommand(next);
    setOrdinal(value);
    setFailed(false);
  };
  const confirm = async () => {
    if (confirming.current || !mounted.current || !isCurrent() || !entry) return;
    confirming.current = true;
    setBusy(true);
    setFailed(false);
    try {
      let value = ordinalRef.current;
      if (usesNative) {
        const latest = await native.current?.getValue();
        if (!mounted.current || !isCurrent()) return;
        if (!latest || !valid(latest)) {
          setFailed(true);
          return;
        }
        value = latest.value;
      }
      const target = index.entries[value];
      if (!target || !mounted.current || !isCurrent()) return;
      navigate(target.chapterIndex, target.paragraph.id);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      confirming.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!entry || !currentEntry) return <Text style={{ color: colors.muted }}>{t('error')}</Text>;

  return (
    <View style={{ gap: 15 }}>
      <View style={{ gap: 5, alignItems: 'center' }}>
        <Text style={{ color: colors.ink, fontSize: 26 }}>{percent}%</Text>
        <Text style={{ color: colors.ink, fontSize: 16, textAlign: 'center' }}>{title}</Text>
        {pdf && sourcePage && previewNavigation.current?.kind === 'chapter' ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {t('pdfPage', { n: sourcePage })}
          </Text>
        ) : null}
      </View>
      {usesNative && NativeSlider ? (
        <NativeSlider
          ref={native}
          contentJSON={contentJSON}
          style={{ height: 48, width: '100%' }}
          onValueChange={({ nativeEvent }) => {
            if (
              !mounted.current ||
              !isCurrent() ||
              confirming.current ||
              !valid(nativeEvent) ||
              nativeEvent.sequence <= sequence.current
            )
              return;
            sequence.current = nativeEvent.sequence;
            ordinalRef.current = nativeEvent.value;
            setOrdinal(nativeEvent.value);
            setFailed(false);
          }}
        />
      ) : !NativeSlider ? (
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 21 }}>
          {t('progressSliderUnavailable')}
        </Text>
      ) : null}
      <View style={styles.spread}>
        <IconButton
          icon="chevron-back"
          label={t('progressPreviousParagraph')}
          disabled={busy || ordinal <= 0}
          onPress={() => step(-1)}
        />
        <Text style={{ flex: 1, textAlign: 'center', color: colors.muted, fontSize: 12 }}>
          {ordinalLabel}
        </Text>
        <IconButton
          icon="chevron-forward"
          label={t('progressNextParagraph')}
          disabled={busy || ordinal >= index.entries.length - 1}
          onPress={() => step(1)}
        />
      </View>
      <View style={{ paddingVertical: 8, gap: 8 }}>
        <Text style={{ color: colors.accent, fontSize: 11 }}>{t('original')}</Text>
        <Text
          numberOfLines={4}
          style={{
            color: colors.ink,
            fontFamily: preferences.serif ? 'Georgia' : undefined,
            fontSize: Math.min(preferences.fontSize, 19),
            lineHeight: Math.min(preferences.fontSize, 19) * preferences.lineHeight,
          }}
        >
          {safeReadingQuote(entry.paragraph.text, 0, 280)}
        </Text>
      </View>
      {failed ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {t('error')}
        </Text>
      ) : null}
      <Button busy={busy} onPress={() => void confirm()}>
        {t('progressJump')}
      </Button>
      <View style={styles.spread}>
        <Button
          secondary
          disabled={busy || !currentNavigation.previous}
          onPress={() => {
            const target = currentNavigation.previous;
            if (target && isCurrent() && !confirming.current)
              navigate(target.chapterIndex, target.paragraphId);
          }}
        >
          {t(
            (currentNavigation.previous || currentNavigation.current)?.kind === 'page'
              ? 'previousOriginalPage'
              : 'previous',
          )}
        </Button>
        <Button
          secondary
          disabled={busy || !currentNavigation.next}
          onPress={() => {
            const target = currentNavigation.next;
            if (target && isCurrent() && !confirming.current)
              navigate(target.chapterIndex, target.paragraphId);
          }}
        >
          {t(
            (currentNavigation.next || currentNavigation.current)?.kind === 'page'
              ? 'nextOriginalPage'
              : 'next',
          )}
        </Button>
      </View>
    </View>
  );
}
