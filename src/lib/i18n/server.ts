import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { isLocale, localeCookie, negotiateLocale, type LocalePreference } from './config';
import { loadMessages } from './messages';

export const serverI18n = cache(async () => {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  const saved = jar.get(localeCookie)?.value;
  const preference: LocalePreference = isLocale(saved) ? saved : 'auto';
  const locale =
    preference === 'auto'
      ? negotiateLocale(requestHeaders.get('accept-language') || '')
      : preference;
  return { locale, preference, messages: await loadMessages(locale) };
});
