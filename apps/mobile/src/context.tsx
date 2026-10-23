import { createContext, useContext } from 'react';
import type { Locale, TextKey } from './i18n';
export type Preferences = {
  locale: Locale;
  theme: 'paper' | 'night';
  fontSize: number;
  lineHeight: number;
  serif: boolean;
  mode: 'original' | 'bilingual' | 'translation';
  language: string;
  speechRate: number;
  turnMode: 'paged' | 'scroll';
  pageEffect: 'curl' | 'slide' | 'none';
  scrollFlow: 'continuous' | 'chapter';
};
export const defaultPreferences: Preferences = {
  locale: 'en',
  theme: 'paper',
  fontSize: 19,
  lineHeight: 1.75,
  serif: true,
  mode: 'bilingual',
  language: 'zh-CN',
  speechRate: 0.9,
  turnMode: 'paged',
  pageEffect: 'curl',
  scrollFlow: 'continuous',
};
export function cleanPreferences(raw: Partial<Preferences>): Preferences {
  return {
    locale: raw.locale === 'zh-CN' ? 'zh-CN' : 'en',
    theme: raw.theme === 'night' ? 'night' : 'paper',
    fontSize: Number.isFinite(raw.fontSize) ? Math.max(15, Math.min(30, raw.fontSize!)) : 19,
    lineHeight: Number.isFinite(raw.lineHeight)
      ? Math.max(1.4, Math.min(2.2, raw.lineHeight!))
      : 1.75,
    serif: raw.serif !== false,
    mode: ['original', 'bilingual', 'translation'].includes(raw.mode || '')
      ? raw.mode!
      : 'bilingual',
    language:
      typeof raw.language === 'string' && /^[a-zA-Z-]{2,20}$/.test(raw.language)
        ? raw.language
        : 'zh-CN',
    turnMode: raw.turnMode === 'scroll' ? 'scroll' : 'paged',
    pageEffect: raw.pageEffect === 'slide' || raw.pageEffect === 'none' ? raw.pageEffect : 'curl',
    scrollFlow: raw.scrollFlow === 'chapter' ? 'chapter' : 'continuous',
    speechRate: Number.isFinite(raw.speechRate)
      ? Math.max(0.5, Math.min(1.5, raw.speechRate!))
      : 0.9,
  };
}
export const palettes = {
  paper: {
    background: '#F5F5F7',
    surface: '#FFFFFF',
    ink: '#27282D',
    muted: '#929398',
    border: '#E7E7EC',
    accent: '#3489E7',
    soft: '#EAF1FA',
    highlight: '#F3E8B8',
    error: '#AC4343',
  },
  night: {
    background: '#17181C',
    surface: '#222329',
    ink: '#E9E9ED',
    muted: '#9698A1',
    border: '#33343C',
    accent: '#75AEF4',
    soft: '#29374D',
    highlight: '#4E4526',
    error: '#F0A09C',
  },
};
export const AppContext = createContext<{
  preferences: Preferences;
  patch: (value: Partial<Preferences>) => void;
  colors: typeof palettes.paper;
  t: (key: TextKey, values?: Record<string, string | number>) => string;
  notify: (text: string) => void;
  openAccount: () => void;
}>(null!);
export const useApp = () => useContext(AppContext);
