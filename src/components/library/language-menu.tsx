'use client';

import { Globe2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n/provider';
import { displayLanguage, uiLocales, type Locale } from '@/lib/i18n/config';

export function LanguageMenu() {
  const { t, locale, setLocale, pending, failed } = useI18n();
  return (
    <div className="language-menu">
      <Select
        value={locale}
        onValueChange={(value) => void setLocale(value as Locale)}
        disabled={pending}
      >
        <SelectTrigger
          aria-label={t('界面语言')}
          className="max-w-52 border-0 bg-transparent shadow-none"
        >
          <Globe2 size={17} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {uiLocales.map(([code, name]) => (
            <SelectItem key={code} value={code} textValue={name}>
              <span lang={code} dir="auto">
                {name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {failed && (
        <p role="alert" className="max-w-64 text-xs text-destructive">
          {t('语言包加载失败，请检查网络后重试。')}
        </p>
      )}
    </div>
  );
}

export function ContentLanguageLabel({ code, nativeName }: { code: string; nativeName: string }) {
  const { locale } = useI18n();
  const label = displayLanguage(code, locale) || nativeName;
  return (
    <span dir="auto">
      {label}
      {label === nativeName ? '' : ` · ${nativeName}`}
    </span>
  );
}
