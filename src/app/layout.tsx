import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/dm-sans';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/600.css';
import './globals.css';
import './library.css';
import { Suspense } from 'react';
import { LibraryProvider } from '@/components/library/library-provider';
import { SyncProvider } from '@/components/auth/sync-provider';
import { IdentityProvider } from '@/components/auth/identity-provider';
import { I18nProvider } from '@/lib/i18n/provider';
import { serverI18n } from '@/lib/i18n/server';
import { createTranslator } from '@/lib/i18n/messages';
import { directionFor } from '@/lib/i18n/config';
import { TranslationRuntime } from '@/components/reader/translation-runtime';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, messages } = await serverI18n();
  const { t } = createTranslator(locale, messages);
  return {
    title: t('ByPage · 逐页'),
    description: t(
      '一个以阅读为中心的多语言阅读器。导入自己的 EPUB 或 TXT，在原文、译文和笔记之间从容切换。',
    ),
    icons: { icon: '/favicon.svg' },
  };
}

export const viewport: Viewport = {
  themeColor: '#f5f5f7',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, preference, messages } = await serverI18n();
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body>
        <I18nProvider initialLocale={locale} initialPreference={preference} messages={messages}>
          <IdentityProvider>
            <TranslationRuntime />
            <SyncProvider>
              <LibraryProvider>
                <Suspense fallback={<div className="min-h-dvh bg-[#f5f5f7]" />}>
                  {children}
                </Suspense>
              </LibraryProvider>
            </SyncProvider>
          </IdentityProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
