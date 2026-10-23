import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useApp } from '../context';
export type TranslationStatus = 'idle' | 'loading' | 'offline' | 'error';
export function TranslationStatus({
  status,
  retry,
}: {
  status: TranslationStatus;
  retry: () => void;
}) {
  const { colors, t } = useApp();
  const failed = status === 'offline' || status === 'error';
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 44,
      }}
    >
      {!failed && <ActivityIndicator size="small" color={colors.muted} />}
      <Text
        numberOfLines={2}
        style={{ color: colors.muted, fontSize: 13, lineHeight: 18, flexShrink: 1 }}
      >
        {t(
          status === 'offline'
            ? 'translationOffline'
            : status === 'error'
              ? 'translationReadError'
              : 'translationLoading',
        )}
      </Text>
      {status === 'error' && (
        <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 10 }}>
          <Text style={{ color: colors.accent, fontSize: 13 }}>{t('retry')}</Text>
        </Pressable>
      )}
    </View>
  );
}
