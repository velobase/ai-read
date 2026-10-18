import { DEFAULT_TRANSLATION_PROMPT } from './translation-prompt';
import { readingLanguages } from './i18n/config';
export type Paragraph = { id: string; text: string; kind: 'text' | 'heading' | 'quote' | 'code' };
export type Chapter = { id: string; title: string; paragraphs: Paragraph[] };
export type Book = {
  id: string;
  title: string;
  author: string;
  language: string;
  chapters: Chapter[];
  importedAt: number;
  sample?: boolean;
  subtitle?: string;
  description?: string;
  category?: string;
  cover?: string;
};
export type Position = {
  chapter: number;
  paragraph: string;
  farthest: number;
  /** Fraction of the current paragraph already above the reading line. */
  offset?: number;
};
export type NoteAnchor = {
  source: 'original' | 'translation';
  start: number;
  end: number;
  translationKey?: string;
};
export type Note = {
  id: string;
  bookId: string;
  paragraphId: string;
  quote: string;
  anchor?: NoteAnchor;
  text: string;
  createdAt: number;
};
export type Message = {
  turnId?: string;
  createdAt?: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  partial?: boolean;
};
export type Settings = {
  baseUrl: string;
  model: string;
  apiKey: string;
  translationPrompt: string;
  language: string;
  fontSize: number;
  fontFamily: 'system' | 'serif';
  lineHeight: number;
  pageWidth: number;
  pageMargin: number;
  theme: 'paper' | 'night';
  scope: 'chapter' | 'read' | 'book';
  readingMode: 'original' | 'bilingual' | 'translation';
  navigationMode: 'scroll' | 'paged';
};
export const languages = readingLanguages;
export const defaults: Settings = {
  baseUrl: '',
  model: '',
  apiKey: '',
  translationPrompt: DEFAULT_TRANSLATION_PROMPT,
  language: 'zh-CN',
  fontSize: 19,
  fontFamily: 'system',
  lineHeight: 1.9,
  pageWidth: 720,
  pageMargin: 24,
  theme: 'paper',
  scope: 'chapter',
  readingMode: 'original',
  navigationMode: 'scroll',
};
export const languageName = (code: string) => languages.find(([id]) => id === code)?.[1] ?? code;
