import { Linking, Text, View } from 'react-native';
import { useApp } from '../context';
import { privacyContent, privacyUpdated, privacyUrl, supportUrl } from '../content/privacy';
import { Button, Sheet } from './ui';

export function PrivacySheet({ visible, close }: { visible: boolean; close: () => void }) {
  const { preferences, colors, t, notify } = useApp();
  const open = (url: string) => {
    void Linking.openURL(url).catch(() => notify(t('error')));
  };
  return (
    <Sheet title={t('privacyPolicy')} visible={visible} close={close} tall>
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
      <Button secondary icon="open-outline" onPress={() => open(privacyUrl)}>
        {t('privacyOnline')}
      </Button>
      <Button secondary icon="help-circle-outline" onPress={() => open(supportUrl)}>
        {t('helpSupport')}
      </Button>
    </Sheet>
  );
}
