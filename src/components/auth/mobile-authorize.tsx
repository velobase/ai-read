'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import { BookOpen, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/provider';
import { useIdentity } from './identity-provider';
import {
  mobileAIPermissions,
  mobileLibraryPermissions,
  readMobilePermissions,
} from '../../../packages/api-client/src';

type Input = { challenge: string; state: string; issuer: string };
type Consent = {
  nonce: string;
  user: { id: string; name: string; email: string };
  issuer: string;
  permissions?: unknown;
};
const callback = 'com.velobase.bypage://auth/callback';

export function MobileAuthorize({
  input,
  library = false,
  directGoogle = false,
}: {
  input: Input | null;
  library?: boolean;
  directGoogle?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale.startsWith('zh');
  const { user } = useIdentity();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);
  const startedGoogle = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const identity = JSON.stringify([
    input?.issuer,
    input?.challenge,
    input?.state,
    user?.id,
    library,
  ]);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const endpoint = library ? '/api/mobile/v2/auth/authorize' : '/api/mobile/v1/auth/authorize';
  const authorizePage = library ? '/mobile/library/authorize' : '/mobile/authorize';
  const query = input
    ? new URLSearchParams({
        code_challenge: input.challenge,
        state: input.state,
        code_challenge_method: 'S256',
      }).toString()
    : '';
  useEffect(() => {
    setConsent(null);
    setError(false);
    if (!input || !user) return;
    const controller = new AbortController();
    void fetch(`${endpoint}?${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const next = (await response.json()) as Consent;
        const permissions =
          !library && next.permissions === undefined
            ? [...mobileAIPermissions]
            : readMobilePermissions(next.permissions);
        const expected = library ? mobileLibraryPermissions : mobileAIPermissions;
        if (
          next.issuer !== input.issuer ||
          next.user.id !== user.id ||
          typeof next.nonce !== 'string' ||
          permissions === null ||
          permissions.length !== expected.length ||
          !expected.every((permission) => permissions.includes(permission))
        )
          throw new Error('invalid_consent');
        if (!controller.signal.aborted) setConsent(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [input, query, user?.id, reload, endpoint, library]);
  useEffect(() => {
    if (!input || user || !directGoogle || startedGoogle.current) return;
    startedGoogle.current = true;
    setBusy(true);
    setError(false);
    // The OAuth return URL deliberately omits provider=google: callbacks and
    // failed/retried authentication must not start a redirect loop.
    void signIn('google', { redirectTo: `${authorizePage}?${query}` }).catch(() => {
      if (mounted.current) {
        setBusy(false);
        setError(true);
      }
    });
  }, [input, user, directGoogle, authorizePage, query]);
  const approve = async () => {
    if (!input || !consent || busy || submitting.current) return;
    submitting.current = true;
    const approvedIdentity = identity;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code_challenge: input.challenge,
          state: input.state,
          nonce: consent.nonce,
          userId: consent.user.id,
        }),
      });
      if (!response.ok) throw new Error('unavailable');
      const result = (await response.json()) as { redirect: string };
      if (!mounted.current || activeIdentity.current !== approvedIdentity) return;
      const url = new URL(result.redirect);
      if (
        `${url.protocol}//${url.host}${url.pathname}` !== callback ||
        url.searchParams.get('state') !== input.state ||
        url.searchParams.get('issuer') !== input.issuer
      )
        throw new Error('invalid_redirect');
      window.location.assign(url.href);
    } catch {
      if (mounted.current && activeIdentity.current === approvedIdentity) {
        setError(true);
        setConsent(null);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const cancel = () => {
    if (!input) return;
    const url = new URL(callback);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('state', input.state);
    url.searchParams.set('issuer', input.issuer);
    window.location.assign(url.href);
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <BookOpen className="text-primary" size={32} />
      <h1 className="text-2xl font-semibold">
        {library
          ? zh
            ? '连接账号书库到 iOS'
            : 'Connect your account library to iOS'
          : zh
            ? '登录 ByPage iOS'
            : 'Sign in to ByPage for iOS'}
      </h1>
      {!input ? (
        <p role="alert" className="text-sm leading-7 text-muted-foreground">
          {zh
            ? '登录链接无效或服务暂不可用。请回到 App 重新开始。'
            : 'This sign-in link is invalid or unavailable. Return to the app and start again.'}
        </p>
      ) : (
        <>
          <p className="text-sm leading-7 text-muted-foreground">
            {library
              ? zh
                ? '允许 App 读取、新增、修改和删除这个账号的书籍、阅读进度、笔记和书签，并使用账号的 AI 配置。'
                : 'Allow the app to read, add, update and delete this account’s books, reading progress, notes and bookmarks, and use its AI connection.'
              : zh
                ? '连接后，App 可使用这个账号的 AI 配置。书籍和笔记仍保存在本机，不会自动上传或关联账号。'
                : 'The app can use this account’s AI connection. Books and notes stay on this device and are not automatically uploaded or linked to the account.'}
          </p>
          {library && (
            <div className="rounded-xl border border-border p-4 text-sm leading-7">
              <p>
                {zh
                  ? '本次授权不会自动上传本机书库。复制本机书籍到账号需要在 App 中另行选择。'
                  : 'This authorization does not automatically upload your device library. Copying device books to the account requires a separate choice in the app.'}
              </p>
              <p className="mt-2 text-muted-foreground">
                {zh
                  ? '本次权限不包含译文、AI 对话记录或阅读偏好的独立同步。删除账号书籍时，该书关联的云端笔记、书签、译文和对话记录也会删除。'
                  : 'This permission does not include separate sync of translations, AI conversations or reading preferences. Deleting an account book also deletes its associated cloud notes, bookmarks, translations and conversations.'}
              </p>
            </div>
          )}
          <p className="break-all text-xs text-muted-foreground">{input.issuer}</p>
          {!user ? (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signIn('google', { redirectTo: `${authorizePage}?${query}` }).catch(() => {
                  setBusy(false);
                  setError(true);
                });
              }}
            >
              {busy && <LoaderCircle className="animate-spin" size={16} />}
              {busy
                ? zh
                  ? '正在前往 Google…'
                  : 'Opening Google…'
                : zh
                  ? '使用 Google 继续'
                  : 'Continue with Google'}
            </Button>
          ) : (
            <>
              <div className="rounded-xl border border-border p-4">
                <p className="font-medium">{consent?.user.name || user.name}</p>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {consent?.user.email || user.email}
                </p>
              </div>
              <Button disabled={!consent || busy} onClick={() => void approve()}>
                {busy && <LoaderCircle className="animate-spin" size={16} />}
                {library
                  ? zh
                    ? '允许账号书库同步'
                    : 'Allow account library sync'
                  : zh
                    ? '确认连接这个账号'
                    : 'Connect this account'}
              </Button>
              <p className="text-xs leading-6 text-muted-foreground">
                {zh
                  ? '之后可在网页账号的设备列表中撤销这次登录。'
                  : 'You can revoke this sign-in later from the web account’s device list.'}
              </p>
            </>
          )}
          {error && (
            <div role="alert" className="text-sm text-destructive">
              <p>
                {zh
                  ? '连接未完成，请重试或回到 App 重新开始。'
                  : 'The connection did not finish. Retry or restart from the app.'}
              </p>
              {user && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setReload((value) => value + 1)}
                >
                  {zh ? '重试' : 'Retry'}
                </Button>
              )}
            </div>
          )}
          <Button variant="ghost" disabled={busy} onClick={cancel}>
            {zh ? '取消' : 'Cancel'}
          </Button>
        </>
      )}
    </main>
  );
}
