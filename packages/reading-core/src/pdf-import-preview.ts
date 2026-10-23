import { PDF_LIMITS, type PdfImportReport } from './pdf-document';
import type { Paragraph } from './types';

export const PDF_PREVIEW_PARAGRAPHS_PER_BATCH = 4;

export type PdfImportPreviewPage = Readonly<{
  sourcePage: number;
  method: 'text' | 'ocr' | 'empty';
  /** The converted chapter's original array and paragraph objects, without truncation. */
  paragraphs: readonly Paragraph[];
}>;

export type PdfImportPreview = Readonly<{
  pages: readonly PdfImportPreviewPage[];
  byPage: ReadonlyMap<number, PdfImportPreviewPage>;
}>;

const noParagraphs: readonly Paragraph[] = Object.freeze([]);
function invalid(): never {
  throw new Error('PDF_PREVIEW_INVALID');
}

/**
 * Index only pages explicitly present in one completed extraction report. Gaps
 * can be unparsed ranges, so sourcePages/totalPages never synthesize empty pages.
 * This is a preview of an already validated Book, not another conversion pass.
 */
export function createPdfImportPreview(report: PdfImportReport): PdfImportPreview {
  if (
    !report ||
    !Number.isSafeInteger(report.totalPages) ||
    report.totalPages < 1 ||
    report.totalPages > PDF_LIMITS.pages ||
    !report.book ||
    !Array.isArray(report.book.chapters) ||
    !report.book.chapters.length ||
    report.book.chapters.length > report.totalPages ||
    report.importedPages !== report.book.chapters.length ||
    !Array.isArray(report.emptyPages) ||
    report.emptyPages.length + report.importedPages > report.totalPages ||
    !Array.isArray(report.ocrPages) ||
    report.ocrPages.length > report.importedPages ||
    (report.book.sourcePages !== undefined && report.book.sourcePages !== report.totalPages)
  )
    return invalid();

  const validPage = (page: unknown): page is number =>
    Number.isSafeInteger(page) && (page as number) >= 1 && (page as number) <= report.totalPages;
  const ocrPages = new Set<number>();
  for (const page of report.ocrPages) {
    if (!validPage(page) || ocrPages.has(page)) return invalid();
    ocrPages.add(page);
  }

  const byPage = new Map<number, PdfImportPreviewPage>();
  for (const chapter of report.book.chapters) {
    if (
      !chapter ||
      !validPage(chapter.sourcePage) ||
      byPage.has(chapter.sourcePage) ||
      !Array.isArray(chapter.paragraphs) ||
      !chapter.paragraphs.length
    )
      return invalid();
    byPage.set(chapter.sourcePage, {
      sourcePage: chapter.sourcePage,
      method: ocrPages.has(chapter.sourcePage) ? 'ocr' : 'text',
      paragraphs: chapter.paragraphs,
    });
  }
  // OCR is a method for a converted text page, never an unparsed/empty page.
  for (const page of ocrPages) if (!byPage.has(page)) return invalid();
  for (const page of report.emptyPages) {
    if (!validPage(page) || byPage.has(page)) return invalid();
    byPage.set(page, { sourcePage: page, method: 'empty', paragraphs: noParagraphs });
  }
  const pages = [...byPage.values()].sort((a, b) => a.sourcePage - b.sourcePage);
  return { pages, byPage: new Map(pages.map((page) => [page.sourcePage, page])) };
}
