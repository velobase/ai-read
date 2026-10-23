import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { accountAvailable, signInAccount, useAccount } from '../adapters/account';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import { useLibrarySyncStatus } from '../adapters/library-sync';
import { Icon } from './ui';

function AccountNotice() {
  const { colors, t } = useApp();
  const account = useAccount();
  if (!account.issue) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
      {t(
        account.issue === 'expired'
          ? 'accountExpired'
          : account.issue === 'storage'
            ? 'accountStorageError'
            : account.issue === 'origin'
              ? 'accountLoginError'
              : 'accountOffline',
      )}
    </Text>
  );
}

function SignInButton({ provider }: { provider: 'google' | 'apple' }) {
  const { colors, t, notify } = useApp();
  const account = useAccount();
  const library = useLibrary();
  const { blocked } = useLibraryController();
  const [error, setError] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = account.busy || account.loading;
  const unavailable = !accountAvailable();
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(provider === 'apple' ? 'accountSignInApple' : 'accountSignIn')}
        accessibilityState={{ disabled: busy || unavailable || blocked, busy }}
        disabled={busy || unavailable || blocked}
        onPress={() => {
          setError('');
          void signInAccount(provider)
            .then(() => {
              if (library.isCurrent()) notify(t('accountSignedIn'));
            })
            .catch((cause: unknown) => {
              const message = cause instanceof Error ? cause.message : '';
              if (mounted.current && library.isCurrent() && !/cancel/i.test(message))
                setError(
                  t(
                    message.includes('account_link_required')
                      ? 'accountLinkRequired'
                      : 'accountLoginError',
                  ),
                );
            });
        }}
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: 14,
          paddingHorizontal: 18,
          paddingVertical: 14,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 12,
          backgroundColor: provider === 'apple' ? '#000000' : colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: unavailable || blocked ? 0.5 : pressed ? 0.65 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator color={provider === 'apple' ? '#ffffff' : colors.accent} />
        ) : (
          <Icon
            name={provider === 'apple' ? 'logo-apple' : 'logo-google'}
            size={20}
            color={provider === 'apple' ? '#ffffff' : colors.ink}
          />
        )}
        <Text
          style={{
            color: provider === 'apple' ? '#ffffff' : colors.ink,
            fontSize: 15,
            fontWeight: '600',
            flexShrink: 1,
          }}
        >
          {t(
            account.loading
              ? 'accountRestoring'
              : account.busy
                ? 'accountSigningIn'
                : provider === 'apple'
                  ? 'accountSignInApple'
                  : 'accountSignIn',
          )}
        </Text>
      </Pressable>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error, lineHeight: 22 }}>
          {error}
        </Text>
      )}
    </View>
  );
}

export function AccountCard({ manage }: { manage?: () => void }) {
  const { colors, t } = useApp();
  const account = useAccount();
  const user = account.session?.user;
  const identity = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View style={{ flex: 1, gap: 7 }}>
        <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '600' }}>
          {user?.name || user?.email || t('accountConnect')}
        </Text>
        {!!user?.name && !!user.email && (
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>{user.email}</Text>
        )}
      </View>
      {!!user && !!manage && <Icon name="chevron-forward" color={colors.muted} size={18} />}
    </View>
  );
  return (
    <View style={{ paddingVertical: 16, gap: 18 }}>
      {user && manage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accountManage')}
          onPress={manage}
        >
          {identity}
        </Pressable>
      ) : (
        identity
      )}
      {!user ? (
        <>
          <SignInButton provider="apple" />
          <SignInButton provider="google" />
          {!accountAvailable() && (
            <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('accountBuildRequired')}</Text>
          )}
        </>
      ) : null}
      <AccountNotice />
    </View>
  );
}

export function AccountSyncSummary({ open }: { open: () => void }) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const account = useAccount();
  const status = useLibrarySyncStatus(library);
  if (!account.session || library.handle.kind === 'device') return null;
  const needsAttention =
    status.state === 'error' ||
    status.countsState === 'error' ||
    (status.countsState === 'ready' && status.blocked > 0);
  if (
    !needsAttention &&
    status.state !== 'syncing' &&
    !(status.countsState === 'ready' && status.pending > 0)
  )
    return null;
  const label = needsAttention
    ? 'accountSyncError'
    : status.state === 'syncing'
      ? 'accountSyncing'
      : 'accountSyncPending';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={{
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <Text
          style={{
            color: label === 'accountSyncError' ? colors.error : colors.muted,
            lineHeight: 20,
          }}
        >
          {t(label)}
        </Text>
      </View>
      <Icon name="chevron-forward" color={colors.muted} size={16} />
    </Pressable>
  );
}
