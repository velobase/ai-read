import type { Book } from './types';

// Content languages are independent of the available interface translations.
export const bookSourceLanguages = [
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['pt-BR', 'Português (Brasil)'],
  ['it', 'Italiano'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['pl', 'Polski'],
  ['nl', 'Nederlands'],
  ['sv', 'Svenska'],
  ['da', 'Dansk'],
  ['nb', 'Norsk bokmål'],
  ['fi', 'Suomi'],
  ['is', 'Íslenska'],
  ['cs', 'Čeština'],
  ['sk', 'Slovenčina'],
  ['hu', 'Magyar'],
  ['ro', 'Română'],
  ['bg', 'Български'],
  ['el', 'Ελληνικά'],
  ['tr', 'Türkçe'],
  ['ar', 'العربية'],
  ['he', 'עברית'],
  ['fa', 'فارسی'],
  ['ur', 'اردو'],
  ['hi', 'हिन्दी'],
  ['bn', 'বাংলা'],
  ['ta', 'தமிழ்'],
  ['te', 'తెలుగు'],
  ['mr', 'मराठी'],
  ['gu', 'ગુજરાતી'],
  ['pa', 'ਪੰਜਾਬੀ'],
  ['ne', 'नेपाली'],
  ['si', 'සිංහල'],
  ['th', 'ไทย'],
  ['vi', 'Tiếng Việt'],
  ['id', 'Bahasa Indonesia'],
  ['ms', 'Bahasa Melayu'],
  ['fil', 'Filipino'],
  ['km', 'ខ្មែរ'],
  ['lo', 'ລາວ'],
  ['my', 'မြန်မာ'],
  ['sw', 'Kiswahili'],
  ['af', 'Afrikaans'],
  ['ca', 'Català'],
  ['eu', 'Euskara'],
  ['gl', 'Galego'],
  ['hr', 'Hrvatski'],
  ['sr', 'Српски'],
  ['sl', 'Slovenščina'],
  ['lt', 'Lietuvių'],
  ['lv', 'Latviešu'],
  ['et', 'Eesti'],
  ['ka', 'ქართული'],
  ['hy', 'Հայերեն'],
  ['az', 'Azərbaycanca'],
  ['kk', 'Қазақша'],
  ['uz', 'Oʻzbekcha'],
  ['mn', 'Монгол'],
] as const;

export type BookSourceLanguage = 'auto' | (typeof bookSourceLanguages)[number][0];

export function isBookSourceLanguage(value: unknown): value is BookSourceLanguage {
  return value === 'auto' || bookSourceLanguages.some(([code]) => code === value);
}

/** Preserve the imported language for content hashes and reset to it explicitly. */
export function effectiveBookLanguage(book: Pick<Book, 'language' | 'sourceLanguage'>): string {
  return book.sourceLanguage && book.sourceLanguage !== 'auto'
    ? book.sourceLanguage
    : book.language;
}

/** Compare reading languages without treating regional spelling as a new translation.
 * Script differences remain meaningful (for example Simplified/Traditional Chinese).
 */
function readingLanguage(value: string): string | null {
  const tag = value.trim().replace(/_/g, '-').toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(tag) || tag === 'und') return null;
  try {
    const locale = new Intl.Locale(tag).maximize();
    return `${locale.language}:${locale.script || ''}`.toLowerCase();
  } catch {
    // Older native runtimes may lack Intl.Locale. Stay conservative about scripts.
    const [language, ...parts] = tag.split('-');
    const script = parts.find((part) => /^[a-z]{4}$/.test(part));
    if (language === 'zh')
      return `zh:${script || (parts.some((part) => ['tw', 'hk', 'mo'].includes(part)) ? 'hant' : 'hans')}`;
    return `${language}:${script || ''}`;
  }
}

export function sameReadingLanguage(source: string, target: string): boolean {
  const from = readingLanguage(source);
  return from !== null && from === readingLanguage(target);
}
