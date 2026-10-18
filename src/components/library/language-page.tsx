'use client';

import { Check, Globe2, LoaderCircle } from 'lucide-react';
import { LibraryShell, PageHeading } from './library-ui';
import { useI18n } from '@/lib/i18n/provider';
import { displayLanguage, readingLanguages, uiLocales } from '@/lib/i18n/config';

export function LanguagePage() {
  const { t, locale, setLocale, pending, failed } = useI18n();
  return (
    <LibraryShell hideNavigation>
      <main className="profile-page">
        <PageHeading title={t('界面语言')} back="/me/settings" />
        <p className="mb-6 text-sm leading-7 text-muted-foreground">
          {t('只改变菜单与按钮的语言。书籍原文、笔记和翻译目标语言保持不变。')}
        </p>
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
                <span className="mt-1 block text-xs text-muted-foreground">
                  {displayLanguage(code, locale)}
                </span>
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
        <div className="mt-6 flex gap-3 text-xs leading-7 text-muted-foreground">
          <Globe2 className="mt-1 size-4 shrink-0" />
          <p>
            {t(
              '翻译与 AI 回答支持选择 {count} 种目标语言，请在阅读语言或阅读偏好中设置。实际翻译质量取决于连接的模型。',
              { count: readingLanguages.length },
            )}
          </p>
        </div>
      </main>
    </LibraryShell>
  );
}
