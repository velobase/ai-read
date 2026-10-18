import english from './messages/en.json';
import type { Locale } from './config';

export type MessageKey = keyof typeof english;
export type Messages = Record<MessageKey, string>;
export type MessageValues = Record<string, string | number>;
const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => import('./messages/en.json'),
  'zh-CN': () => import('./messages/zh-CN.json'),
  'zh-TW': () => import('./messages/zh-TW.json'),
  ja: () => import('./messages/ja.json'),
  ko: () => import('./messages/ko.json'),
  es: () => import('./messages/es.json'),
  fr: () => import('./messages/fr.json'),
  de: () => import('./messages/de.json'),
  pt: () => import('./messages/pt.json'),
  ar: () => import('./messages/ar.json'),
};

export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await loaders[locale]()).default;
}

export function createTranslator(locale: Locale, messages: Messages) {
  const numbers = new Intl.NumberFormat(locale);
  const plurals = new Intl.PluralRules(locale);
  const text = (key: string, values: MessageValues = {}): string => {
    // Known transport errors carry parameters, never HTML or executable content.
    const requestError = /^请求失败（(\d+)）$/.exec(key);
    if (requestError) return text('请求失败（{status}）', { status: Number(requestError[1]) });
    const missingFile = /^EPUB 缺少必要文件：(.+)$/.exec(key);
    if (missingFile && !key.includes('{path}'))
      return text('EPUB 缺少必要文件：{path}', { path: missingFile[1] });
    const providerError = /^模型服务返回 (\d+)：(.+)。$/.exec(key);
    if (providerError)
      return `${numbers.format(Number(providerError[1]))} · ${text(providerError[2])}`;
    const safeKey = Object.hasOwn(english, key) ? (key as MessageKey) : undefined;
    let message = safeKey ? messages[safeKey] || english[safeKey] : key;
    // Simple CLDR plural variants, e.g. "one:...||other:..."; no code/HTML evaluation.
    if (typeof values.count === 'number' && /^(zero|one|two|few|many|other):/.test(message)) {
      const variants = Object.fromEntries(
        message.split('||').map((part) => {
          const colon = part.indexOf(':');
          return [part.slice(0, colon), part.slice(colon + 1)];
        }),
      );
      message = variants[plurals.select(values.count)] || variants.other || message;
    }
    return message.replace(/\{(\w+)\}/g, (token, name: string) => {
      const value = values[name];
      return value === undefined
        ? token
        : typeof value === 'number'
          ? numbers.format(value)
          : value;
    });
  };
  return { t: (key: MessageKey, values?: MessageValues) => text(key, values), text };
}
