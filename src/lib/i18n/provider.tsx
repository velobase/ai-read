'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Direction } from 'radix-ui';
import { createTranslator, loadMessages, type Messages } from './messages';
import {
  directionFor,
  isLocale,
  localeCookie,
  localeStorageKey,
  negotiateLocale,
  type Locale,
  type LocalePreference,
} from './config';

type I18nContextValue = ReturnType<typeof createTranslator> & {
  locale: Locale;
  preference: LocalePreference;
  pending: boolean;
  failed: boolean;
  setLocale: (preference: LocalePreference) => Promise<void>;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  date: (value: number | string | Date, options?: Intl.DateTimeFormatOptions) => string;
};
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
  initialPreference,
  messages,
}: {
  children: ReactNode;
  initialLocale: Locale;
  initialPreference: LocalePreference;
  messages: Messages;
}) {
  const [state, setState] = useState({
    locale: initialLocale,
    preference: initialPreference,
    messages,
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const change = async (preference: LocalePreference, persist: boolean) => {
    if (preference !== 'auto' && !isLocale(preference)) return;
    const token = ++generation.current;
    const locale = preference === 'auto' ? negotiateLocale(navigator.languages) : preference;
    setPending(true);
    setFailed(false);
    try {
      const messages = await loadMessages(locale);
      if (generation.current !== token) return;
      setState({ locale, preference, messages });
      if (persist) {
        try {
          localStorage.setItem(localeStorageKey, preference);
        } catch {
          /* cookie remains available */
        }
        document.cookie = `${localeCookie}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      }
    } catch {
      if (generation.current === token) setFailed(true);
    } finally {
      if (generation.current === token) setPending(false);
    }
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== localeStorageKey) return;
      const preference = event.newValue || 'auto';
      if (preference === 'auto' || isLocale(preference)) void change(preference, false);
    };
    const systemChanged = () => {
      if (state.preference === 'auto') void change('auto', false);
    };
    window.addEventListener('storage', sync);
    window.addEventListener('languagechange', systemChanged);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('languagechange', systemChanged);
    };
  }, [state.preference]);
  useEffect(() => {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = directionFor(state.locale);
  }, [state.locale]);
  const translation = useMemo(
    () => createTranslator(state.locale, state.messages),
    [state.locale, state.messages],
  );
  const value: I18nContextValue = {
    ...translation,
    locale: state.locale,
    preference: state.preference,
    pending,
    failed,
    setLocale: (preference) => change(preference, true),
    number: (value, options) => new Intl.NumberFormat(state.locale, options).format(value),
    date: (value, options) =>
      new Intl.DateTimeFormat(state.locale, options).format(new Date(value)),
  };
  return (
    <I18nContext.Provider value={value}>
      <Direction.Provider dir={directionFor(state.locale)}>{children}</Direction.Provider>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('I18nProvider is required.');
  return value;
}
