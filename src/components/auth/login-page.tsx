'use client';

import { useI18n } from '@/lib/i18n/provider';

import Link from 'next/link';
import { LanguageMenu } from '@/components/library/language-menu';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { ChevronLeft, LoaderCircle, ArrowRight } from 'lucide-react';
import { useIdentity } from './identity-provider';
import { safeReturnPath } from '@/lib/identity';
import { Button } from '@/components/ui/button';

const errors: Record<string, string> = {
  AccessDenied: '这次登录未获授权。请重试或选择另一种登录方式。',
  OAuthAccountNotLinked: '这个邮箱已关联其他登录身份，请使用原来的登录方式。',
  Configuration: '登录服务暂时不可用，请稍后再试。',
  OAuthCallbackError: '登录未完成，请重新开始。',
};

export function LoginPage() {
  const { t, text: localize, locale } = useI18n();
  const { enabled, user, providers = ['google'] } = useIdentity();
  const params = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo') || params.get('callbackUrl'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const oauthError = params.get('error');
  const start = async (provider: 'apple' | 'google') => {
    setBusy(true);
    setError('');
    try {
      await signIn(provider, { redirectTo: returnTo });
    } catch {
      setError(t('暂时无法开始登录，请检查网络后重试。'));
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <Link href="/me" className="login-back">
        <ChevronLeft size={20} />
        {t('返回')}
      </Link>
      <div className="login-language">
        <LanguageMenu />
      </div>
      <div className="login-card">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">{t('登录 ByPage · 逐页')}</h1>
        {user ? (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              {t('已登录为 {value0}', { value0: user.name })}
            </p>
            <Button asChild className="h-12 w-full rounded-full">
              <Link href={returnTo}>
                {t('继续阅读')}
                <ArrowRight size={17} />
              </Link>
            </Button>
          </>
        ) : (
          <>
            {providers.includes('apple') && (
              <Button
                className="mb-3 h-12 w-full rounded-full bg-black text-white hover:bg-black/85"
                disabled={!enabled || busy}
                onClick={() => void start('apple')}
              >
                {locale.startsWith('zh') ? '使用 Apple 继续' : 'Continue with Apple'}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-12 w-full gap-3 rounded-full border-black/15 bg-white font-medium"
              disabled={!enabled || busy || !providers.includes('google')}
              onClick={() => void start('google')}
            >
              {busy ? <LoaderCircle size={19} className="animate-spin" /> : <GoogleMark />}
              {busy ? t('正在前往 Google…') : t('使用 Google 继续')}
            </Button>
            {!enabled && (
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                {t('Google 登录正在准备中，你可以先以游客身份阅读。')}
              </p>
            )}
          </>
        )}
        {(error || oauthError) && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-destructive/5 p-3 text-sm leading-6 text-destructive"
          >
            {error ||
              localize(errors[oauthError || ''] || '') ||
              t('这次登录没有完成。可以重新尝试，或先以游客身份阅读。')}
          </p>
        )}
        {!user && (
          <Link
            href="/"
            className="mt-6 inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
          >
            {t('先随便读读')}
            <ArrowRight className="ms-2" size={15} />
          </Link>
        )}
        <div className="mt-8 flex justify-center gap-5 text-xs text-muted-foreground">
          <Link href="/privacy" className="py-3 hover:underline">
            {locale.startsWith('zh') ? '隐私政策' : 'Privacy Policy'}
          </Link>
          <Link href="/terms" className="py-3 hover:underline">
            {locale.startsWith('zh') ? '服务条款' : 'Terms of Service'}
          </Link>
        </div>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.93A6 6 0 0 1 6.1 12c0-.67.12-1.32.31-1.93V7.48H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.52l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95Z"
      />
    </svg>
  );
}
