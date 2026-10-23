import { validateBook } from './reading-backup';
import { inferPdfToc } from './pdf-toc';
import type { Book, Paragraph } from './types';

/** Platform-neutral extraction output. Engines do not own storage or reader UI. */
export type PdfPageText = {
  pageNumber: number;
  blocks: { text: string; kind?: Paragraph['kind'] }[];
  method?: 'text' | 'ocr';
};
export type ParsedPdf = {
  totalPages: number;
  title?: string;
  author?: string;
  pages: PdfPageText[];
};
export type PdfImportReport = {
  book: Book;
  importedPages: number;
  emptyPages: number[];
  ocrPages: number[];
  totalPages: number;
};
export const PDF_LIMITS = { bytes: 30 * 1024 * 1024, pages: 1000, text: 20 * 1024 * 1024 } as const;

export function pdfToBook(
  document: ParsedPdf,
  options: {
    id: string;
    fileName: string;
    unknownAuthor: string;
    pageTitle: (page: number) => string;
  },
): PdfImportReport {
  if (
    !Number.isSafeInteger(document.totalPages) ||
    document.totalPages < 1 ||
    document.totalPages > PDF_LIMITS.pages ||
    !Array.isArray(document.pages) ||
    document.pages.length > document.totalPages
  )
    throw new Error('PDF_PAGE_LIMIT');
  const seen = new Set<number>();
  const emptyPages: number[] = [],
    ocrPages: number[] = [];
  let total = 0;
  const chapters: Book['chapters'] = [];
  for (const page of document.pages) {
    if (
      !Number.isInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      page.pageNumber > document.totalPages ||
      seen.has(page.pageNumber) ||
      !Array.isArray(page.blocks)
    )
      throw new Error('PDF_INVALID');
    seen.add(page.pageNumber);
    const paragraphs: Paragraph[] = [];
    for (const block of page.blocks) {
      if (!block || typeof block.text !== 'string') throw new Error('PDF_INVALID');
      const text = block.text
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t ]+/g, ' ')
        .trim();
      if (!text) continue;
      total += text.length;
      if (total > PDF_LIMITS.text) throw new Error('PDF_TEXT_LIMIT');
      // Keep surrogate pairs intact while making exceptionally long paragraphs readable.
      const pieces = text.match(/[\s\S]{1,6000}(?:\s|$)|[\s\S]{1,6000}/gu) || [];
      for (const piece of pieces) {
        const paragraphText = piece.trim();
        if (!paragraphText) continue;
        paragraphs.push({
          id: `pdf-${page.pageNumber}.${paragraphs.length + 1}`,
          text: paragraphText,
          kind: ['text', 'heading', 'quote', 'code'].includes(block.kind || '')
            ? block.kind!
            : 'text',
        });
      }
    }
    if (!paragraphs.length) {
      emptyPages.push(page.pageNumber);
      continue;
    }
    if (page.method === 'ocr') ocrPages.push(page.pageNumber);
    chapters.push({
      id: `pdf-page-${page.pageNumber}`,
      title: options.pageTitle(page.pageNumber),
      sourcePage: page.pageNumber,
      paragraphs,
    });
  }
  if (!chapters.length) throw new Error('PDF_NO_TEXT');
  chapters.sort((a, b) => a.sourcePage! - b.sourcePage!);
  const book: Book = {
    id: options.id,
    title:
      document.title?.trim().slice(0, 2000) ||
      options.fileName
        .replace(/\.pdf$/i, '')
        .trim()
        .slice(0, 2000) ||
      'PDF',
    author: document.author?.trim().slice(0, 2000) || options.unknownAuthor.slice(0, 2000),
    language: 'auto',
    importedAt: Date.now(),
    sourceFormat: 'pdf',
    sourcePages: document.totalPages,
    chapters,
  };
  const toc = inferPdfToc(book);
  return {
    book: validateBook({
      ...book,
      ...(toc.length ? { toc } : {}),
    }),
    importedPages: chapters.length,
    emptyPages: emptyPages.sort((a, b) => a - b),
    ocrPages: ocrPages.sort((a, b) => a - b),
    totalPages: document.totalPages,
  };
}
