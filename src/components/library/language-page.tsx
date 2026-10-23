'use client';

import { Check, LoaderCircle } from 'lucide-react';
import { LibraryShell, PageHeading } from './library-ui';
import { useI18n } from '@/lib/i18n/provider';
import { displayLanguage, uiLocales } from '@/lib/i18n/config';

export function LanguagePage() {
  const { t, locale, setLocale, pending, failed } = useI18n();
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('界面语言')} back="/me" />
        <div className="settings-group" role="group" aria-label={t('界面语言')} aria-busy={pending}>
          {uiLocales.map(([code, nativeName]) => (
            <button
              key={code}
              type="button"
              className="language-choice"
              disabled={pending}
              aria-pressed={locale === code}
              onClick={() => void setLocale(code)}
            >
              <span className="min-w-0">
                <span lang={code} dir="auto">
                  {nativeName}
                </span>
                {displayLanguage(code, locale) !== nativeName && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {displayLanguage(code, locale)}
                  </span>
                )}
              </span>
              {locale === code &&
                (pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4 text-primary" />
                ))}
            </button>
          ))}
        </div>
        {failed && (
          <p role="alert" className="my-3 text-sm text-destructive">
            {t('语言包加载失败，请检查网络后重试。')}
          </p>
        )}
      </main>
    </LibraryShell>
  );
}
