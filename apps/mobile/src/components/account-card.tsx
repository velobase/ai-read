import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { accountAvailable, signInAccount, useAccount } from '../adapters/account';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import { useLibrarySyncStatus } from '../adapters/library-sync';
import { Icon } from './ui';

export function AccountNotice() {
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

export function GoogleSignInButton() {
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
        accessibilityLabel={t('accountSignIn')}
        accessibilityState={{ disabled: busy || unavailable || blocked, busy }}
        disabled={busy || unavailable || blocked}
        onPress={() => {
          setError('');
          void signInAccount()
            .then(() => {
              if (library.isCurrent()) notify(t('accountSignedIn'));
            })
            .catch((cause: unknown) => {
              const message = cause instanceof Error ? cause.message : '';
              if (mounted.current && library.isCurrent() && !/cancel/i.test(message))
                setError(t('accountLoginError'));
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
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: unavailable || blocked ? 0.5 : pressed ? 0.65 : 1,
        })}
      >
        {busy ? <ActivityIndicator color={colors.accent} /> : <Icon name="logo-google" size={20} />}
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 }}>
          {t(
            account.loading
              ? 'accountRestoring'
              : account.busy
                ? 'accountSigningIn'
                : 'accountSignIn',
          )}
        </Text>
      </Pressable>
      {unavailable && (
        <Text style={{ color: colors.muted, lineHeight: 22 }}>{t('accountBuildRequired')}</Text>
      )}
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
  const [imageFailed, setImageFailed] = useState(false);
  const user = account.session?.user;
  useEffect(() => setImageFailed(false), [user?.image]);
  const identity = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.soft,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {user?.image?.startsWith('https://') && !imageFailed ? (
          <Image
            source={{ uri: user.image }}
            onError={() => setImageFailed(true)}
            style={{ width: 60, height: 60 }}
          />
        ) : (
          <Icon name="person-outline" size={28} color={colors.accent} />
        )}
      </View>
      <View style={{ flex: 1, gap: 7 }}>
        <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '600' }}>
          {user?.name || user?.email || t('accountConnect')}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>
          {user?.email || t('accountPurpose')}
        </Text>
      </View>
      {!!user && !!manage && <Icon name="chevron-forward" color={colors.muted} size={18} />}
    </View>
  );
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 22, gap: 18 }}>
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
          <GoogleSignInButton />
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 20 }}>
            {t('accountGuestHint')}
          </Text>
        </>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {t(account.verified ? 'accountVerified' : 'accountCached')}
        </Text>
      )}
      <AccountNotice />
    </View>
  );
}

export function AccountSyncSummary({ open }: { open: () => void }) {
  const { colors, t } = useApp();
  const library = useLibrary();
  const account = useAccount();
  const status = useLibrarySyncStatus(library);
  if (!account.session) return null;
  const label =
    library.handle.kind === 'device'
      ? 'accountSyncOff'
      : status.state === 'error' || (status.countsState === 'ready' && status.blocked > 0)
        ? 'accountSyncError'
        : status.state === 'syncing'
          ? 'accountSyncing'
          : status.countsState === 'ready' && status.pending === 0 && status.completedAt
            ? 'accountSynced'
            : 'accountSyncPending';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={{
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <Icon name="cloud-outline" color={colors.accent} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 16 }}>
          {t('accountSync')}
        </Text>
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
