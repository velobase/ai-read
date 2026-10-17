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
};
export type Position = { chapter: number; paragraph: string; farthest: number };
export type Note = {
  id: string;
  bookId: string;
  paragraphId: string;
  quote: string;
  text: string;
  createdAt: number;
};
export type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  partial?: boolean;
};
export type Settings = {
  baseUrl: string;
  model: string;
  apiKey: string;
  language: string;
  fontSize: number;
  theme: 'paper' | 'night';
  scope: 'chapter' | 'read' | 'book';
};
export const languages = [
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['ar', 'العربية'],
] as const;
export const defaults: Settings = {
  baseUrl: '',
  model: '',
  apiKey: '',
  language: 'zh-CN',
  fontSize: 19,
  theme: 'paper',
  scope: 'chapter',
};
export const languageName = (code: string) => languages.find(([id]) => id === code)?.[1] ?? code;
