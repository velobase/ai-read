import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { Button, styles } from '../components/ui';
import { useAccount, signOutAccount, deleteAccount } from '../adapters/account';
import { useLibraryController } from '../library-controller';
import { deviceLibrary } from '../adapters/library-scope';
import { AccountCard } from '../components/account-card';
import { AccountLibraryPanel } from '../components/account-library-panel';

export function AccountScreen() {
  const { colors, t, notify } = useApp();
  const account = useAccount();
  const library = useLibrary();
  const libraryController = useLibraryController();
  const [error, setError] = useState('');
  return (
    <ScrollView contentContainerStyle={[styles.page, { gap: 20 }]}>
      <AccountCard />
      {account.session && (
        <>
          <AccountLibraryPanel />
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
          <Button
            secondary
            danger
            busy={account.busy}
            disabled={account.loading || libraryController.blocked}
            onPress={() => {
              const userId = account.session?.user.id;
              if (!userId) return;
              Alert.alert(t('accountDeleteTitle'), t('accountDeleteBody'), [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('accountDeleteConfirm'),
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      await libraryController.switchTo(deviceLibrary);
                      const result = await deleteAccount(userId);
                      Alert.alert(
                        t('accountDeleted'),
                        result.cleanupPending
                          ? t('accountDeleteCleanup')
                          : t('accountDeleteRetained'),
                      );
                    })().catch(() => Alert.alert(t('accountDeleteError')));
                  },
                },
              ]);
            }}
          >
            {t('accountDelete')}
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
