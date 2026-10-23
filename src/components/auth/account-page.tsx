'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import { LoaderCircle } from 'lucide-react';
import { useIdentity } from './identity-provider';
import { useLibrary } from '@/components/library/library-provider';
import { Avatar, LibraryShell, PageHeading } from '@/components/library/library-ui';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/reader/reader-dialogs';

type Session = { id: string; device: string; createdAt: string; expires: string; current: boolean };
type AccountData = { accounts: { provider: string }[]; sessions: Session[] };

export function AccountPage() {
  const { t, text: localize, locale } = useI18n();
  const { user, refreshIdentity } = useIdentity();
  const { notify } = useLibrary();
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<
    'signout' | 'others' | 'delete' | Session | null
  >(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      if (response.status === 401) {
        await refreshIdentity();
        return;
      }
      if (!response.ok) throw new Error();
      setData(await response.json());
      setError('');
    } catch {
      setError(t('暂时无法读取登录设备，请重试。'));
    }
  }, [refreshIdentity]);
  useEffect(() => {
    if (user) void load();
  }, [user?.id, load]);
  const act = async () => {
    if (!confirmation || busy) return;
    setBusy(true);
    try {
      if (confirmation === 'delete' && user) {
        const response = await fetch('/api/account', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: user.id }),
        });
        if (!response.ok) throw new Error('account_deletion_retry');
        // Guest storage is deliberately preserved. Close this document before any further sync.
        for (const key of Object.keys(localStorage)) {
          if (key.endsWith(`:user:${user.id}`)) localStorage.removeItem(key);
        }
        indexedDB.deleteDatabase(`ai-read:user:${user.id}`);
        window.location.replace('/');
        return;
      }
      if (confirmation === 'signout') {
        await signOut({ redirectTo: '/me' });
        return;
      }
      const response = await fetch('/api/account/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          confirmation === 'others'
            ? { scope: 'others' }
            : { id: typeof confirmation === 'object' ? confirmation.id : '' },
        ),
      });
      if (response.status === 401) {
        await refreshIdentity();
        return;
      }
      if (!response.ok) throw new Error();
      await load();
      setConfirmation(null);
      notify(t('所选设备已退出登录。'));
    } catch {
      notify(t('操作没有完成，请重试。'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('账号与安全')} back="/me" />
        {!user ? (
          <div className="settings-form-card py-10 text-center">
            <h2 className="text-lg font-medium">{t('你正在以游客身份阅读')}</h2>
            <p className="my-4 text-sm leading-7 text-muted-foreground">
              {t('已有书籍和笔记保存在本机。登录后，会打开这个账号自己的阅读空间。')}
            </p>
            <Button asChild className="mt-3 rounded-full">
              <Link href="/login?returnTo=%2Fme%2Faccount">{t('登录 ByPage · 逐页')}</Link>
            </Button>
            <Link className="mt-5 block text-sm text-muted-foreground" href="/me/profile">
              {t('编辑游客资料')}
            </Link>
          </div>
        ) : (
          <>
            <div className="settings-form-card">
              <div className="flex items-center gap-4">
                <Avatar />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">{user.name}</h2>
                </div>
                <Link className="ms-auto shrink-0 text-sm text-primary" href="/me/profile">
                  {t('编辑')}
                </Link>
              </div>
              <dl className="account-details">
                <div>
                  <dt>{t('邮箱')}</dt>
                  <dd className="break-all">{user.email}</dd>
                </div>
                <div>
                  <dt>{t('登录方式')}</dt>
                  <dd>
                    {data?.accounts
                      .map((account) => (account.provider === 'apple' ? 'Apple' : 'Google'))
                      .join(', ') || t('正在读取…')}
                  </dd>
                </div>
              </dl>
            </div>
            <section className="settings-form-card mt-4">
              <div className="mb-2 flex items-center justify-between gap-4">
                <h2 className="font-medium">{t('登录设备')}</h2>
                {data?.sessions.some((session) => !session.current) && (
                  <button
                    className="text-xs text-primary disabled:opacity-40"
                    disabled={busy}
                    onClick={() => setConfirmation('others')}
                  >
                    {t('退出其他设备')}
                  </button>
                )}
              </div>
              {error ? (
                <div className="py-5 text-sm">
                  <p role="alert" className="text-destructive">
                    {localize(error)}
                  </p>
                  <Button variant="ghost" onClick={() => void load()}>
                    {t('重试')}
                  </Button>
                </div>
              ) : !data ? (
                <p role="status" className="flex gap-2 py-6 text-sm text-muted-foreground">
                  <LoaderCircle size={16} className="animate-spin" />
                  {t('正在读取…')}
                </p>
              ) : (
                data.sessions.map((s) => (
                  <div className="account-session" key={s.id}>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm">
                        {s.device
                          .split(' · ')
                          .map((part) => localize(part))
                          .join(' · ')}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('{value0} 登录', {
                          value0: new Date(s.createdAt).toLocaleString(locale),
                        })}
                      </p>
                    </div>
                    {s.current ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t('当前设备')}
                      </span>
                    ) : (
                      <button
                        className="min-h-10 shrink-0 text-xs text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={() => setConfirmation(s)}
                      >
                        {t('退出')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </section>
            <Button
              variant="outline"
              className="mt-7 h-12 w-full rounded-full"
              onClick={() => setConfirmation('signout')}
            >
              {t('退出当前账号')}
            </Button>
            <Button
              variant="ghost"
              className="mt-3 w-full text-destructive"
              disabled={busy}
              onClick={() => setConfirmation('delete')}
            >
              {locale.startsWith('zh') ? '注销账号' : 'Delete account'}
            </Button>
          </>
        )}
        {confirmation && (
          <Modal
            title={
              confirmation === 'delete'
                ? locale.startsWith('zh')
                  ? '永久注销账号？'
                  : 'Permanently delete account?'
                : confirmation === 'signout'
                  ? t('退出当前账号？')
                  : t('退出登录设备？')
            }
            close={() => {
              if (!busy) setConfirmation(null);
            }}
          >
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              {confirmation === 'delete'
                ? locale.startsWith('zh')
                  ? '这会永久删除云端资料、书籍、笔记、书签、译文、对话和 AI 配置，并撤销所有登录。游客书库和单独导出的备份不会删除。此操作无法撤销。'
                  : 'This permanently deletes your cloud profile, books, notes, bookmarks, translations, conversations and AI settings, and revokes all sessions. Guest books and exported backups are retained. This cannot be undone.'
                : confirmation === 'signout'
                  ? t('本机书籍和笔记会保留在这个账号的阅读空间。退出后，打开的是原有游客书库。')
                  : t(
                      '所选会话将立即失效，这些设备需要重新登录才能继续使用账号。当前设备不受影响。',
                    )}
            </p>
            <div className="mt-7 flex gap-3">
              <Button
                variant="secondary"
                className="flex-1 rounded-full"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                {t('取消')}
              </Button>
              <Button className="flex-1 rounded-full" disabled={busy} onClick={() => void act()}>
                {confirmation === 'delete'
                  ? locale.startsWith('zh')
                    ? busy
                      ? '正在注销…'
                      : '永久注销'
                    : busy
                      ? 'Deleting…'
                      : 'Delete permanently'
                  : busy
                    ? t('正在退出…')
                    : t('确认退出')}
              </Button>
            </div>
          </Modal>
        )}
      </main>
    </LibraryShell>
  );
}
