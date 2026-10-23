import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useApp } from '../context';
export type TranslationStatus = 'idle' | 'loading' | 'offline' | 'error';
export function TranslationStatus({
  status,
  retry,
  progress,
  canRetry,
}: {
  status: TranslationStatus;
  retry: () => void;
  canRetry: boolean;
  progress?: { completed: number; total: number } | null;
}) {
  const { colors, t } = useApp();
  if (status === 'idle') return null;
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
        {progress && progress.total > 0
          ? ` · ${Math.floor((progress.completed / progress.total) * 100)}%`
          : ''}
      </Text>
      {status === 'error' && canRetry && (
        <Pressable accessibilityRole="button" onPress={retry} style={{ padding: 10 }}>
          <Text style={{ color: colors.accent, fontSize: 13 }}>{t('retry')}</Text>
        </Pressable>
      )}
    </View>
  );
}
