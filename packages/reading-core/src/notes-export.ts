import { readingChapterNavigation } from './reading-navigation';
import type { Book, Note } from './types';

export const MAX_NOTES_EXPORT_BYTES = 10 * 1024 * 1024;
export type NotesExportLocale = 'zh-CN' | 'en';
export type NotesExportLabels = {
  title: string;
  author: string;
  chapter: string;
  source: string;
  unknown: string;
  original: string;
  translation: string;
  paragraph: string;
  date: string;
  thought: string;
  pdfPage: string;
};
export type NotesExportLocation = { chapterTitle?: string; sourcePage?: number };

export function notesExportLabels(
  locale: NotesExportLocale,
  overrides: Partial<NotesExportLabels> = {},
): NotesExportLabels {
  return {
    ...(locale === 'zh-CN'
      ? {
          title: '阅读笔记',
          author: '作者',
          chapter: '章节',
          source: '摘录来源',
          unknown: '来源未记录',
          original: '原文',
          translation: '保存时的译文',
          paragraph: '段落',
          date: '记录时间',
          thought: '想法',
          pdfPage: 'PDF 原页',
        }
      : {
          title: 'Reading notes',
          author: 'Author',
          chapter: 'Chapter',
          source: 'Excerpt source',
          unknown: 'Source not recorded',
          original: 'Original',
          translation: 'Saved translation',
          paragraph: 'Paragraph',
          date: 'Recorded',
          thought: 'Thought',
          pdfPage: 'Original PDF page',
        }),
    ...overrides,
  };
}

/** Quotes and thoughts are plain text, never executable HTML or Markdown images/links. */
function literal(value: string): string {
  // Escape each original character once; escaping generated backslashes a second time would
  // reactivate Markdown. HTML entities preserve the visible <, > and & characters.
  return value.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return `\\${character}`;
  });
}
const line = (value: string) => literal(value.replace(/[\r\n\t]+/g, ' '));
const plain = (value: string) =>
  value
    .split(/\r\n|\r|\n/)
    .map(literal)
    .join('  \n');

export function notesMarkdownHeader(labels: NotesExportLabels): string {
  return `# ${line(labels.title)}\n\n`;
}

export function notesMarkdownBook(
  book: Pick<Book, 'title' | 'author'>,
  labels: NotesExportLabels,
): string {
  return `## ${line(book.title)}\n\n${line(labels.author)}: ${line(book.author)}\n\n`;
}

export function notesMarkdownEntry(
  note: Note,
  location: NotesExportLocation,
  labels: NotesExportLabels,
): string {
  const language =
    note.anchor?.source === 'translation' ? note.anchor.translationKey?.split(':')[0] : undefined;
  const validLanguage = language && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language);
  const source =
    note.anchor?.source === 'original'
      ? labels.original
      : note.anchor?.source === 'translation'
        ? `${labels.translation}${validLanguage ? ` (${language})` : ''}`
        : labels.unknown;
  const date = new Date(note.createdAt);
  const parts = [
    `### ${line(location.chapterTitle || `${labels.paragraph} ${note.paragraphId}`)}`,
    `${line(labels.source)}: ${line(source)}`,
    ...(Number.isSafeInteger(location.sourcePage) && location.sourcePage! > 0
      ? [`${line(labels.pdfPage)}: ${location.sourcePage}`]
      : []),
    `${line(labels.paragraph)}: ${line(note.paragraphId)}`,
    ...(Number.isFinite(date.getTime()) ? [`${line(labels.date)}: ${date.toISOString()}`] : []),
    note.quote
      .split(/\r\n|\r|\n/)
      .map((value) => `> ${literal(value)}`)
      .join('  \n'),
    ...(note.text ? [`#### ${line(labels.thought)}`, plain(note.text)] : []),
  ];
  return `${parts.join('\n\n')}\n\n---\n\n`;
}

/** Build paragraph lookup once; the navigation helper caches PDF logical chapter boundaries. */
export function createNotesExportLocator(book: Book): (paragraphId: string) => NotesExportLocation {
  const chapters = new Map<string, number>();
  book.chapters.forEach((chapter, index) => {
    for (const paragraph of chapter.paragraphs) chapters.set(paragraph.id, index);
  });
  return (paragraphId) => {
    const index = chapters.get(paragraphId);
    if (index === undefined) return {};
    const chapter = book.chapters[index];
    const current = readingChapterNavigation(book, {
      chapter: index,
      paragraph: paragraphId,
    }).current;
    return {
      chapterTitle: current?.title || chapter.title,
      ...(Number.isSafeInteger(chapter.sourcePage) && chapter.sourcePage! > 0
        ? { sourcePage: chapter.sourcePage }
        : {}),
    };
  };
}
