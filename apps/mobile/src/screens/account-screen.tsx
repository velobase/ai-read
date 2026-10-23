import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { MobileCapabilities } from '@bypage/api-client';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Button, Icon, styles } from '../components/ui';
import { checkConnection } from '../adapters/api';
import { useAccount, signOutAccount } from '../adapters/account';
import { AccountCard } from '../components/account-card';
import { AccountLibraryPanel } from '../components/account-library-panel';

export function AccountScreen() {
  const { colors, t, notify } = useApp();
  const account = useAccount();
  const library = useLibrary();
  const [capabilities, setCapabilities] = useState<MobileCapabilities | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setCapabilities(null);
    setCheckFailed(false);
    setChecking(false);
    if (!account.session || account.busy || account.loading) return;
    const controller = new AbortController();
    setChecking(true);
    void checkConnection(account.origin, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCapabilities(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCheckFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [account.origin, account.revision, account.busy, account.loading, retry]);
  return (
    <ScrollView contentContainerStyle={[styles.page, { gap: 20 }]}>
      <AccountCard />
      {account.session && (
        <>
          <AccountLibraryPanel />
          <View style={{ borderRadius: 18, backgroundColor: colors.surface, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="sparkles-outline" color={colors.accent} />
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>
                {t('aiCompanion')}
              </Text>
            </View>
            <Text style={{ color: colors.muted, lineHeight: 22 }}>
              {t(
                checking
                  ? 'accountAiChecking'
                  : checkFailed
                    ? 'accountAiUnavailable'
                    : capabilities?.nativeAI
                      ? 'accountAiReady'
                      : 'accountAiSetup',
              )}
            </Text>
            {checkFailed && (
              <Button secondary onPress={() => setRetry((value) => value + 1)}>
                {t('retry')}
              </Button>
            )}
          </View>
          <Button
            secondary
            danger
            busy={account.busy}
            disabled={account.loading}
            onPress={() => {
              setError('');
              void signOutAccount()
                .then((revoked) => {
                  if (revoked !== undefined && library.isCurrent())
                    notify(t(revoked ? 'accountSignedOut' : 'accountSignedOutOffline'));
                })
                .catch(() => {
                  if (library.isCurrent()) setError(t('accountStorageError'));
                });
            }}
          >
            {t('accountSignOut')}
          </Button>
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
          {error}
        </Text>
      )}
    </ScrollView>
  );
}
