import { useContext, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../context';
import { LibraryControllerContext } from '../library-controller';

// Optional outside LibraryHost (for example the initial device loading screen).
function useLibraryBlocked() {
  const controller = useContext(LibraryControllerContext);
  const blocked = useRef(!!controller?.blocked);
  blocked.current = !!controller?.blocked;
  return blocked;
}

export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({
  name,
  size = 21,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const { colors } = useApp();
  return (
    <Ionicons
      accessible={false}
      importantForAccessibility="no"
      name={name}
      size={size}
      color={color || colors.ink}
    />
  );
}
export function IconButton({
  icon,
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useApp();
  const blocked = useLibraryBlocked();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || blocked.current, selected: active }}
      disabled={disabled || blocked.current}
      onPress={() => {
        if (!blocked.current) onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        {
          backgroundColor: active ? colors.soft : 'transparent',
          opacity: disabled ? 0.35 : pressed ? 0.55 : 1,
        },
      ]}
    >
      <Icon name={icon} color={active ? colors.accent : colors.ink} />
    </Pressable>
  );
}
export function Button({
  children,
  onPress,
  secondary = false,
  danger = false,
  busy = false,
  disabled = false,
  icon,
}: {
  children: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { colors } = useApp();
  const blocked = useLibraryBlocked();
  const color = secondary ? (danger ? colors.error : colors.ink) : colors.background;
  return (
    <Pressable
      onPress={() => {
        if (!blocked.current) onPress();
      }}
      disabled={disabled || busy || blocked.current}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy || blocked.current }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? colors.surface : danger ? colors.error : colors.accent,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : icon ? (
        <Icon name={icon} color={color} size={18} />
      ) : null}
      <Text style={{ color, fontWeight: '600', fontSize: 15 }}>{children}</Text>
    </Pressable>
  );
}
export function Chip({
  children,
  active,
  onPress,
  disabled = false,
}: {
  children: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useApp();
  const blocked = useLibraryBlocked();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: disabled || blocked.current }}
      disabled={disabled || blocked.current}
      onPress={() => {
        if (!disabled && !blocked.current) onPress();
      }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.surface : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: active ? colors.ink : colors.muted,
          fontSize: 13,
          fontWeight: active ? '600' : '400',
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  const { colors } = useApp();
  return (
    <View style={styles.empty}>
      <Text style={[styles.subtitle, { color: colors.ink, textAlign: 'center' }]}>{title}</Text>
      {children}
    </View>
  );
}
export function Sheet({
  title,
  visible,
  close,
  onShow,
  onDismiss,
  children,
  tall = false,
  scrollRef,
  onScrollBeginDrag,
  scrollable = true,
}: {
  tall?: boolean;
  title: string;
  visible: boolean;
  close: () => void;
  /** Presentation acknowledgements used by a local modal coordinator. */
  onShow?: () => void;
  onDismiss?: () => void;
  children: ReactNode;
  scrollRef?: Ref<ScrollView>;
  onScrollBeginDrag?: ComponentProps<typeof ScrollView>['onScrollBeginDrag'];
  /** A virtualized child owns scrolling instead of nesting inside a ScrollView. */
  scrollable?: boolean;
}) {
  const { colors, t } = useApp();
  const blocked = useLibraryBlocked();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [availableHeight, setAvailableHeight] = useState(window.height);
  const [headerHeight, setHeaderHeight] = useState(64);
  const [contentHeight, setContentHeight] = useState<number>();
  const panelLimit = Math.max(0, Math.min(availableHeight, window.height) * (tall ? 0.9 : 0.78));
  // A numeric viewport gives
  // UIScrollView a real scroll range; maxHeight on an auto-height ancestor alone
  // can leave it measured at the entire child's intrinsic height.
  const scrollLimit = Math.max(0, panelLimit - headerHeight - insets.bottom);
  const scrollHeight = Math.min(contentHeight ?? scrollLimit, scrollLimit);
  return (
    <Modal
      visible={visible && !blocked.current}
      animationType={blocked.current ? 'none' : 'slide'}
      transparent
      onRequestClose={close}
      onShow={onShow}
      onDismiss={onDismiss}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', opacity: blocked.current ? 0 : 1 }}
        pointerEvents={blocked.current ? 'none' : 'auto'}
        accessibilityElementsHidden={blocked.current}
        importantForAccessibility={blocked.current ? 'no-hide-descendants' : 'auto'}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{ flex: 1, justifyContent: 'flex-end' }}
          onLayout={({ nativeEvent }) => {
            const height = nativeEvent.layout.height;
            if (height > 0)
              setAvailableHeight((previous) =>
                Math.abs(previous - height) > 0.5 ? height : previous,
              );
          }}
        >
          <Pressable
            accessibilityLabel={t('close')}
            onPress={close}
            style={{ position: 'absolute', inset: 0, backgroundColor: '#00000025' }}
          />
          <SafeAreaView
            edges={['bottom']}
            style={{
              flexShrink: 1,
              maxHeight: panelLimit,
              ...(!scrollable ? { height: panelLimit } : {}),
              backgroundColor: colors.surface,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              overflow: 'hidden',
            }}
          >
            <View
              style={[styles.sheetHeader, { borderColor: colors.border, flexShrink: 0 }]}
              onLayout={({ nativeEvent }) => {
                const height = nativeEvent.layout.height;
                if (height > 0)
                  setHeaderHeight((previous) =>
                    Math.abs(previous - height) > 0.5 ? height : previous,
                  );
              }}
            >
              <Text accessibilityRole="header" style={[styles.subtitle, { color: colors.ink }]}>
                {title}
              </Text>
              <IconButton icon="close" label={t('close')} onPress={close} />
            </View>
            {scrollable ? (
              <ScrollView
                ref={scrollRef}
                onScrollBeginDrag={onScrollBeginDrag}
                style={{ height: scrollHeight, flexGrow: 0, flexShrink: 1 }}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 22, gap: 20 }}
                onContentSizeChange={(_, height) => {
                  if (Number.isFinite(height) && height >= 0)
                    setContentHeight((previous) =>
                      previous === undefined || Math.abs(previous - height) > 0.5
                        ? height
                        : previous,
                    );
                }}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={{ flex: 1 }}>{children}</View>
            )}
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function SectionLabel({ children }: { children: string }) {
  const { colors } = useApp();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: colors.muted,
        fontSize: 12,
        fontWeight: '600',
        marginTop: 14,
      }}
    >
      {children}
    </Text>
  );
}
export const styles = StyleSheet.create({
  page: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32, gap: 18 },
  title: { fontSize: 23, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { fontSize: 19, fontWeight: '600', letterSpacing: -0.35 },
  description: { fontSize: 14, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  chip: {
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', gap: 16, padding: 30, paddingVertical: 54 },
  sheetHeader: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
});
