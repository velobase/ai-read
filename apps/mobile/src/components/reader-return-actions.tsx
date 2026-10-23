import { useRef } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useApp } from '../context';
import { useLibraryController } from '../library-controller';
import { Icon } from './ui';

/** Session-only navigation controls; the caller owns capture, validation and history. */
export function ReaderReturnActions({
  onReturn,
  onStay,
  busy = false,
  compact = false,
}: {
  onReturn: () => void;
  onStay: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const { colors, t } = useApp();
  const { blocked } = useLibraryController();
  const disabled = busy || blocked;
  const input = useRef({ disabled, onReturn, onStay });
  input.current = { disabled, onReturn, onStay };
  const title = t('readerReturnPosition');
  const height = compact ? 32 : 44;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={busy ? t('readerReturnBusy') : title}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={() => {
          if (!input.current.disabled) input.current.onReturn();
        }}
        style={({ pressed }) => ({
          minHeight: height,
          paddingHorizontal: compact ? 6 : 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 1,
          gap: 5,
          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Icon name="return-up-back-outline" size={compact ? 15 : 18} color={colors.accent} />
        )}
        <Text
          numberOfLines={1}
          style={{ flexShrink: 1, color: colors.accent, fontSize: compact ? 11 : 12 }}
        >
          {title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('readerStayHere')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          if (!input.current.disabled) input.current.onStay();
        }}
        style={({ pressed }) => ({
          width: height,
          height,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        })}
      >
        <Icon name="close" size={compact ? 14 : 16} color={colors.muted} />
      </Pressable>
    </View>
  );
}
