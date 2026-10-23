import { Text, View } from 'react-native';
import { useApp } from '../context';
import { privacyContent, privacyUpdated } from '../content/privacy';
import { Sheet } from './ui';

export function PrivacySheet({
  visible,
  close,
  onShow,
  onDismiss,
}: {
  visible: boolean;
  close: () => void;
  onShow: () => void;
  onDismiss: () => void;
}) {
  const { preferences, colors, t } = useApp();
  return (
    <Sheet
      title={t('privacyPolicy')}
      visible={visible}
      close={close}
      onShow={onShow}
      onDismiss={onDismiss}
      tall
    >
      <Text style={{ color: colors.muted }}>{t('privacyUpdated', { date: privacyUpdated })}</Text>
      {privacyContent[preferences.locale].map(([title, body]) => (
        <View key={title} style={{ gap: 9 }}>
          <Text
            accessibilityRole="header"
            style={{ color: colors.ink, fontSize: 18, fontWeight: '600' }}
          >
            {title}
          </Text>
          <Text selectable style={{ color: colors.ink, fontSize: 15, lineHeight: 25 }}>
            {body}
          </Text>
        </View>
      ))}
    </Sheet>
  );
}
