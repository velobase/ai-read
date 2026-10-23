import { bookSourceLanguages } from '../../../packages/reading-core/src/reading-language';

export const uiLocales = [
  ['en', 'English'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['ar', 'العربية'],
] as const;
export type Locale = (typeof uiLocales)[number][0];
export type LocalePreference = Locale | 'auto';
export const localeCookie = 'bypage-locale';
export const localeStorageKey = 'bypage.ui-locale';
export const defaultLocale: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return uiLocales.some(([code]) => code === value);
}

export function localeForTag(value: string): Locale | undefined {
  const tag = value.trim().replaceAll('_', '-').toLowerCase();
  if (/^zh(?:-|$)/.test(tag)) {
    return /(?:^|-)hant(?:-|$)|^zh-(?:tw|hk|mo)(?:-|$)/.test(tag) ? 'zh-TW' : 'zh-CN';
  }
  return uiLocales.find(([code]) => code.toLowerCase() === tag.split('-')[0])?.[0];
}

export function negotiateLocale(value: string | readonly string[]): Locale {
  const preferences = (typeof value === 'string' ? value.split(',') : value)
    .map((entry, index) => {
      const [tag, ...params] = entry.split(';');
      const q = params.find((part) => part.trim().startsWith('q='));
      const weight = q ? Number(q.trim().slice(2)) : 1;
      return { tag, index, weight };
    })
    .filter(({ weight }) => Number.isFinite(weight) && weight > 0 && weight <= 1)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of preferences) {
    const locale = localeForTag(tag);
    if (locale) return locale;
  }
  return defaultLocale;
}

export const directionFor = (language: string): 'rtl' | 'ltr' =>
  /^(ar|fa|he|ur|ps|sd|yi)(-|$)/i.test(language) ? 'rtl' : 'ltr';

// Content languages share the same choices on Web and native.
export const readingLanguages = bookSourceLanguages;

export function displayLanguage(code: string, locale: string) {
  try {
    if (code === 'auto' || code === 'und') return undefined;
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code);
  } catch {
    return readingLanguages.find(([id]) => id === code)?.[1] || code;
  }
}
