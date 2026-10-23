import { PDF_LIMITS } from './pdf-document';

export type PdfParseInterruptionCode = 'PDF_PAUSED' | 'PDF_PAGE_FAILED' | 'PDF_TEXT_LIMIT';
export type PdfParseInterruptionDetails = {
  code: PdfParseInterruptionCode;
  /** Successfully cached pages in the selected range, excluding the failed page. */
  completed: number;
  /** Number of pages in the selected range, not the source document's page count. */
  total: number;
  /** Physical PDF page, when known; required for a page failure or text limit. */
  sourcePage?: number;
};

/** Safe UI state: engine error messages, passwords and extracted text never cross this boundary. */
export class PdfParseInterruption extends Error {
  readonly code: PdfParseInterruptionCode;
  readonly completed: number;
  readonly total: number;
  readonly sourcePage?: number;

  constructor(details: PdfParseInterruptionDetails) {
    if (
      !details ||
      !['PDF_PAUSED', 'PDF_PAGE_FAILED', 'PDF_TEXT_LIMIT'].includes(details.code) ||
      !Number.isSafeInteger(details.total) ||
      details.total < 1 ||
      details.total > PDF_LIMITS.pages ||
      !Number.isSafeInteger(details.completed) ||
      details.completed < 0 ||
      details.completed > details.total ||
      (details.sourcePage !== undefined &&
        (!Number.isSafeInteger(details.sourcePage) ||
          details.sourcePage < 1 ||
          details.sourcePage > PDF_LIMITS.pages)) ||
      (details.code !== 'PDF_PAUSED' && details.sourcePage === undefined)
    )
      throw new Error('PDF_PARSE_STATE_INVALID');
    super(details.code);
    this.name = 'PdfParseInterruption';
    this.code = details.code;
    this.completed = details.completed;
    this.total = details.total;
    if (details.sourcePage !== undefined) this.sourcePage = details.sourcePage;
  }
}

export function isPdfParseInterruption(error: unknown): error is PdfParseInterruption {
  return error instanceof PdfParseInterruption;
}
