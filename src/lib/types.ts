import { DEFAULT_TRANSLATION_PROMPT } from './translation-prompt';
import { readingLanguages } from './i18n/config';
import type {
  Book,
  Paragraph,
  Chapter,
  Position,
  Bookmark,
  Note,
  NoteAnchor,
  BookDisplay,
  Message,
} from '../../packages/reading-core/src/types';
export type {
  Book,
  Paragraph,
  Chapter,
  Position,
  Bookmark,
  Note,
  NoteAnchor,
  BookDisplay,
  Message,
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
  pageEffect: 'curl' | 'slide' | 'none';
  scrollFlow: 'continuous' | 'chapter';
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
  navigationMode: 'paged',
  pageEffect: 'curl',
  scrollFlow: 'continuous',
};
export const languageName = (code: string) => languages.find(([id]) => id === code)?.[1] ?? code;
