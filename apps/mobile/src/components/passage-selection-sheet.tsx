import { useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from 'react';
import {
  Modal,
  Platform,
  Text,
  View,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import * as Crypto from 'expo-crypto';
import { useApp } from '../context';
import { useLibraryController } from '../library-controller';
import type { PassageSelection } from './passage';
import { Button, IconButton, styles } from './ui';

type NativeRange = { id: string; start: number; end: number };
type NativeSelectionHandle = { getSelection: () => Promise<NativeRange | null> };
type NativeSelectionProps = ViewProps & {
  ref?: Ref<NativeSelectionHandle>;
  contentJSON: string;
  onSelectionChange: (event: NativeSyntheticEvent<NativeRange>) => void;
  onSelectionError: (event: NativeSyntheticEvent<Record<string, never>>) => void;
};
const reader = requireOptionalNativeModule<{ selectionVersion?: number }>('ByPageReader');
const NativeSelection: ComponentType<NativeSelectionProps> | null =
  Platform.OS === 'ios' && (reader?.selectionVersion || 0) >= 1
    ? requireNativeViewManager<NativeSelectionProps>('ByPageReader', 'Selection')
    : null;

function splitSurrogate(text: string, offset: number) {
  return (
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
}

function validRange(text: string, range: { start: number; end: number }) {
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= text.length &&
    !splitSurrogate(text, range.start) &&
    !splitSurrogate(text, range.end)
  );
}

/** Confirm changes only the UTF-16 range; the caller revalidates this frozen source before use. */
export function PassageSelectionSheet({
  selection,
  visible = true,
  onShow,
  onDismiss,
  close,
  onConfirm,
}: {
  selection: PassageSelection | null;
  visible?: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  close: () => void;
  onConfirm: (selection: PassageSelection) => void;
}) {
  const capture = useMemo(
    () => (selection ? { id: Crypto.randomUUID(), selection: { ...selection } } : null),
    [selection],
  );
  return capture ? (
    <SelectionContent
      key={capture.id}
      capture={capture}
      visible={visible}
      onShow={onShow}
      onDismiss={onDismiss}
      close={close}
      onConfirm={onConfirm}
    />
  ) : null;
}

function SelectionContent({
  capture,
  visible,
  onShow,
  onDismiss,
  close,
  onConfirm,
}: {
  capture: { id: string; selection: PassageSelection };
  visible: boolean;
  onShow?: () => void;
  onDismiss?: () => void;
  close: () => void;
  onConfirm: (selection: PassageSelection) => void;
}) {
  const { colors, preferences, t } = useApp();
  const { blocked } = useLibraryController();
  const inaccessible = blocked || !visible;
  const access = useRef({ blocked: inaccessible, revision: 0 });
  if (access.current.blocked !== inaccessible)
    access.current = { blocked: inaccessible, revision: access.current.revision + 1 };
  const { selection } = capture;
  const native = useRef<NativeSelectionHandle | null>(null);
  const mounted = useRef(true);
  const accepting = useRef(false);
  const [range, setRange] = useState<NativeRange | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported =
    !!NativeSelection &&
    selection.text.length > 0 &&
    selection.text.length <= 100000 &&
    validRange(selection.text, selection);
  // Entire paragraphs stay local. Do not trim, normalize, or limit this to the initial excerpt.
  const contentJSON = useMemo(
    () =>
      JSON.stringify({
        id: capture.id,
        text: selection.text,
        start: selection.start,
        end: selection.end,
        fontSize: preferences.fontSize,
        lineHeight: preferences.lineHeight,
        serif: preferences.serif,
        foreground: colors.ink,
        background: colors.background,
        accent: colors.accent,
        label: t(selection.source),
      }),
    [capture, preferences.fontSize, preferences.lineHeight, preferences.serif, colors, t],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = () => {
    mounted.current = false;
    close();
  };
  const confirm = async () => {
    if (
      access.current.blocked ||
      accepting.current ||
      !supported ||
      !native.current ||
      !range ||
      range.end <= range.start
    )
      return;
    accepting.current = true;
    const revision = access.current.revision;
    const current = () =>
      mounted.current && !access.current.blocked && access.current.revision === revision;
    setBusy(true);
    try {
      // Reading the view on its main queue avoids confirming a stale queued selection event.
      const latest = await native.current.getSelection();
      if (!current()) return;
      if (!latest || latest.id !== capture.id || !validRange(selection.text, latest)) {
        setFailed(true);
        return;
      }
      setRange(latest);
      if (latest.end <= latest.start) return;
      onConfirm({ ...selection, start: latest.start, end: latest.end });
    } catch {
      if (current()) setFailed(true);
    } finally {
      accepting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Modal
      visible={!inaccessible}
      onShow={onShow}
      onDismiss={onDismiss}
      presentationStyle="fullScreen"
      animationType={blocked ? 'none' : 'slide'}
      onRequestClose={finish}
    >
      <SafeAreaProvider
        initialMetrics={initialWindowMetrics}
        style={{ flex: 1, backgroundColor: colors.background, opacity: inaccessible ? 0 : 1 }}
        pointerEvents={inaccessible ? 'none' : 'auto'}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.sheetHeader, { borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 5 }}>
              <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 19 }}>
                {t('selectionTitle')}
              </Text>
              <Text style={{ color: colors.accent, fontSize: 12 }}>{t(selection.source)}</Text>
            </View>
            <IconButton icon="close" label={t('close')} onPress={finish} />
          </View>
          {supported && NativeSelection ? (
            <NativeSelection
              ref={native}
              accessibilityHint={t('selectionHint')}
              contentJSON={contentJSON}
              style={{ flex: 1 }}
              onSelectionChange={({ nativeEvent }) => {
                if (!mounted.current || access.current.blocked || nativeEvent.id !== capture.id)
                  return;
                if (!validRange(selection.text, nativeEvent)) {
                  setFailed(true);
                  return;
                }
                setRange(nativeEvent);
                setFailed(false);
              }}
              onSelectionError={() => {
                if (mounted.current && !access.current.blocked) setFailed(true);
              }}
            />
          ) : (
            <Text style={{ flex: 1, color: colors.muted, padding: 22, lineHeight: 24 }}>
              {t(
                !NativeSelection
                  ? 'selectionUnavailable'
                  : selection.text.length > 100000
                    ? 'selectionParagraphTooLong'
                    : 'selectionError',
              )}
            </Text>
          )}
          <View style={{ padding: 20, gap: 12, borderTopWidth: 1, borderColor: colors.border }}>
            {failed ? (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {t('selectionError')}
              </Text>
            ) : range && range.start === range.end ? (
              <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
                {t('selectionEmpty')}
              </Text>
            ) : null}
            <Button
              busy={busy}
              disabled={blocked || !supported || failed || !range || range.end <= range.start}
              onPress={() => void confirm()}
            >
              {t('selectionConfirm')}
            </Button>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
