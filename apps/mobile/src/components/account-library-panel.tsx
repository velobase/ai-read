import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useApp } from '../context';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';
import {
  accountSnapshot,
  libraryAccountAvailable,
  signInLibraryAccount,
  useAccount,
} from '../adapters/account';
import { createAccountLibrary, deviceLibrary } from '../adapters/library-scope';
import { checkLibraryConnection } from '../adapters/library-sync-transport';
import { Button } from './ui';
import { DeviceBookCopy } from './device-book-copy';
import { LibrarySyncPanel } from './library-sync-panel';

export function AccountLibraryPanel() {
  const { colors, preferences } = useApp();
  const zh = preferences.locale === 'zh-CN';
  const library = useLibrary();
  const control = useLibraryController();
  const account = useAccount();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    if (working || control.switching) return;
    setWorking(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      if (library.isCurrent() && !(cause instanceof Error && /cancel/i.test(cause.message)))
        setError(
          zh
            ? '操作未完成，请检查连接后重试。原书库仍保留。'
            : 'Could not finish. Check the connection and retry. Your library is preserved.',
        );
    } finally {
      if (library.isCurrent()) setWorking(false);
    }
  };
  const openAccountLibrary = async () => {
    const identity = accountSnapshot();
    if (!identity.session?.permissions.includes('library_sync'))
      throw new Error('library_permission_required');
    const handle = await createAccountLibrary(identity.origin, identity.session.user.id);
    library.assertCurrent();
    await control.switchTo(handle);
  };
  const granted = account.session?.permissions.includes('library_sync');
  const disabled = working || control.switching || account.busy || account.loading;
  return (
    <View style={{ paddingVertical: 12, gap: 16 }}>
      <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '600' }}>
        {zh ? '书库同步' : 'Library sync'} ·{' '}
        {library.handle.kind === 'device' ? (zh ? '未开启' : 'Off') : zh ? '已开启' : 'On'}
      </Text>
      <Text style={{ color: colors.muted, lineHeight: 23 }}>
        {zh
          ? '账号书库同步书籍、进度、笔记和书签。本机书籍需单独添加；PDF 原件、译文、AI 历史和阅读设置不跨设备同步。'
          : 'Account libraries sync books, progress, notes and bookmarks. Add device books separately. Original PDFs, translations, AI history and reading settings stay on this device.'}
      </Text>
      {library.handle.kind === 'account' && (
        <>
          <LibrarySyncPanel />
          <DeviceBookCopy />
          <Button
            secondary
            disabled={disabled}
            onPress={() => void run(() => control.switchTo(deviceLibrary))}
          >
            {zh ? '返回本机书库' : 'Open device library'}
          </Button>
        </>
      )}
      {library.handle.kind === 'device' &&
        (granted ? (
          <Button disabled={disabled} busy={working} onPress={() => void run(openAccountLibrary)}>
            {zh ? '继续使用账号书库' : 'Open synced library'}
          </Button>
        ) : (
          <Button
            secondary
            disabled={disabled || !account.session || !libraryAccountAvailable()}
            busy={working}
            onPress={() =>
              void run(async () => {
                const confirmed = accountSnapshot().session;
                if (!confirmed) throw new Error('account_changed');
                await new Promise<void>((resolve, reject) =>
                  Alert.alert(
                    zh ? '开启书库同步' : 'Enable library sync',
                    zh
                      ? `将为 ${confirmed.user.email} 开启同步。账号书库的书籍、进度、笔记和书签会存入 LeafRead 云端。本机书籍仍需你另行选择添加。`
                      : `Enable sync for ${confirmed.user.email}. Books, progress, notes and bookmarks in this account library will be stored in LeafRead's cloud. Device books are added only when you choose them.`,
                    [
                      {
                        text: zh ? '取消' : 'Cancel',
                        style: 'cancel',
                        onPress: () => reject(new Error('cancelled')),
                      },
                      { text: zh ? '开启同步' : 'Enable sync', onPress: () => resolve() },
                    ],
                    { cancelable: false },
                  ),
                );
                if (accountSnapshot().session?.sessionId !== confirmed.sessionId)
                  throw new Error('account_changed');
                const capability = await checkLibraryConnection(account.origin, library.signal);
                library.assertCurrent();
                if (!capability.nativeAccountSync) throw new Error('sync_unavailable');
                await signInLibraryAccount(confirmed.sessionId);
                library.assertCurrent();
                await openAccountLibrary();
              })
            }
          >
            {zh ? '开启书库同步' : 'Enable library sync'}
          </Button>
        ))}
      {!libraryAccountAvailable() && !granted && (
        <Text style={{ color: colors.muted, lineHeight: 22 }}>
          {zh ? '请更新叶子阅读后开启同步。' : 'Update LeafRead to enable library sync.'}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      )}
    </View>
  );
}
