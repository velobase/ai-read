import {
  PDF_LIMITS,
  pdfToBook,
  type PdfPageText,
  type PdfImportReport,
} from '../../../packages/reading-core/src/pdf-document';
import type { PDFDocumentProxy, TextItem } from 'pdfjs-dist/types/src/display/api';
import { PdfParseInterruption } from '../../../packages/reading-core/src/pdf-parse-state';

export type PdfSession = {
  totalPages: number;
  title: string;
  author: string;
  parse: (options: {
    from: number;
    to: number;
    pageTitle: (page: number) => string;
    unknownAuthor: string;
    signal?: AbortSignal;
    onProgress?: (page: number, total: number) => void;
  }) => Promise<PdfImportReport>;
  close: () => Promise<void>;
};

function withoutPageNumberFooter(
  items: TextItem[],
  pageNumber: number,
  bounds: number[],
  rotation: number,
) {
  // Be conservative: only an unrotated page's isolated, bottom-right number
  // matching its physical page index is a known footer. Keep all other numbers.
  if (rotation % 360 !== 0 || bounds.length !== 4 || !bounds.every(Number.isFinite)) return items;
  const [left, bottom, right, top] = bounds;
  if (right <= left || top <= bottom) return items;
  const candidates = items.filter((item) => {
    const [x, y] = item.transform.slice(4),
      height = Math.abs(item.height);
    return (
      item.str.trim() === String(pageNumber) &&
      height > 0 &&
      item.width > 0 &&
      item.width <= height * 4 &&
      x >= left + (right - left) * 0.75 &&
      x + item.width <= right &&
      y >= bottom &&
      y + height <= bottom + (top - bottom) * 0.1
    );
  });
  if (candidates.length !== 1) return items;
  const footer = candidates[0],
    baseline = footer.transform[5];
  if (
    items.some(
      (item) =>
        item !== footer &&
        item.str.trim() &&
        item.transform[5] <= baseline + Math.abs(footer.height) * 1.2,
    )
  )
    return items;
  return items.filter((item) => item !== footer);
}

function pageBlocks(items: TextItem[]) {
  const blocks: PdfPageText['blocks'] = [];
  let line = '',
    paragraph = '',
    lastY = 0,
    lastHeight = 0,
    lastX = 0;
  const commitLine = (paragraphBreak = false) => {
    const value = line.trim();
    if (value) {
      const separator =
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(paragraph) &&
        /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)
          ? ''
          : ' ';
      paragraph = paragraph ? paragraph + separator + value : value;
    }
    line = '';
    if (paragraphBreak && paragraph) {
      blocks.push({ text: paragraph });
      paragraph = '';
    }
  };
  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) commitLine();
      continue;
    }
    const y = item.transform[5],
      x = item.transform[4],
      height = Math.abs(item.height) || Math.abs(item.transform[3]) || 12;
    if (line && Math.abs(y - lastY) > Math.max(height, lastHeight) * 0.35) {
      commitLine(
        Math.abs(y - lastY) > Math.max(height, lastHeight) * 1.65 ||
          y > lastY + Math.max(height, lastHeight),
      );
    } else if (
      paragraph &&
      (y > lastY + Math.max(height, lastHeight) ||
        Math.abs(y - lastY) > Math.max(height, lastHeight) * 1.65)
    )
      commitLine(true);
    // Font-size changes inside a visual line often represent subscripts or
    // superscripts. Only vertical separation above may split a paragraph.
    const gap = x - lastX;
    if (line && gap > height * 4) commitLine(true); // Separate large gutters, such as two columns.
    if (line && gap > height * 0.12 && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' ';
    line += item.str;
    lastY = y;
    lastHeight = height;
    lastX = x + item.width;
    if (item.hasEOL) commitLine();
  }
  commitLine(true);
  return blocks;
}

export async function openPdf(
  file: File,
  options: { password?: string; signal?: AbortSignal } = {},
): Promise<PdfSession> {
  const lifetimeSignal = options.signal;
  lifetimeSignal?.throwIfAborted();
  if (!file.size) throw new Error('PDF_INVALID');
  if (file.size > PDF_LIMITS.bytes) throw new Error('PDF_FILE_LIMIT');
  const pdfjs = await import('pdfjs-dist');
  lifetimeSignal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.mjs?v=${pdfjs.version}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  lifetimeSignal?.throwIfAborted();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  lifetimeSignal?.throwIfAborted();
  const task = pdfjs.getDocument({
    data: bytes,
    password: options.password,
    useSystemFonts: false,
    disableFontFace: true,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
  });
  let document: PDFDocumentProxy | null = null;
  let closed = false;
  let parsing = false;
  let destruction: Promise<void> | null = null;
  let plan: { from: number; to: number; pages: PdfPageText[]; length: number } | null = null;
  const destroy = () => {
    closed = true;
    plan = null;
    document = null;
    lifetimeSignal?.removeEventListener('abort', abort);
    return (destruction ??= task.destroy());
  };
  const abort = () => {
    void destroy().catch(() => {});
  };
  lifetimeSignal?.addEventListener('abort', abort, { once: true });
  try {
    document = await task.promise;
    lifetimeSignal?.throwIfAborted();
    if (document.numPages > PDF_LIMITS.pages) throw new Error('PDF_PAGE_LIMIT');
    const permissions = await document.getPermissions();
    if (permissions && !permissions.has(pdfjs.PermissionFlag.COPY))
      throw new Error('PDF_COPY_RESTRICTED');
    const metadata = await document.getMetadata().catch(() => null);
    const info = metadata?.info as { Title?: string; Author?: string } | undefined;
    lifetimeSignal?.throwIfAborted();
    const title =
      (typeof info?.Title === 'string' ? info.Title.trim().slice(0, 2000) : '') ||
      file.name
        .replace(/\.pdf$/i, '')
        .trim()
        .slice(0, 2000) ||
      'PDF';
    const author = typeof info?.Author === 'string' ? info.Author.trim().slice(0, 2000) : '';
    const totalPages = document.numPages;
    return {
      totalPages,
      title,
      author,
      async parse({ from, to, pageTitle, unknownAuthor, signal, onProgress }) {
        if (parsing) throw new Error('PDF_PARSE_BUSY');
        const currentDocument = document;
        if (
          closed ||
          !currentDocument ||
          !Number.isSafeInteger(from) ||
          !Number.isSafeInteger(to) ||
          from < 1 ||
          to > totalPages ||
          from > to
        )
          throw new Error('PDF_PAGE_RANGE');
        if (!plan || plan.from !== from || plan.to !== to)
          plan = { from, to, pages: [], length: 0 };
        const cached = plan;
        const total = to - from + 1;
        parsing = true;
        const interruption = (
          code: 'PDF_PAUSED' | 'PDF_PAGE_FAILED' | 'PDF_TEXT_LIMIT',
          sourcePage?: number,
        ) => new PdfParseInterruption({ code, completed: cached.pages.length, total, sourcePage });
        const checkCurrent = (sourcePage?: number) => {
          if (closed || document !== currentDocument)
            throw new DOMException('PDF session closed', 'AbortError');
          if (signal?.aborted) throw interruption('PDF_PAUSED', sourcePage);
        };
        try {
          checkCurrent();
          onProgress?.(cached.pages.length, total);
          for (let pageNumber = from + cached.pages.length; pageNumber <= to; pageNumber++) {
            checkCurrent(pageNumber);
            let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
            try {
              page = await currentDocument.getPage(pageNumber);
              checkCurrent(pageNumber);
              const content = await page.getTextContent();
              checkCurrent(pageNumber);
              const blocks = pageBlocks(
                withoutPageNumberFooter(
                  content.items.filter((item): item is TextItem => 'str' in item),
                  pageNumber,
                  page.view,
                  page.rotate,
                ),
              );
              const length = blocks.reduce((sum, block) => sum + block.text.length, 0);
              checkCurrent(pageNumber);
              if (cached.length + length > PDF_LIMITS.text)
                throw interruption('PDF_TEXT_LIMIT', pageNumber);
              // Commit only complete pages, including pages without text. A pause
              // during getTextContent leaves this page as the next retry target.
              cached.pages.push({ pageNumber, blocks, method: 'text' });
              cached.length += length;
            } catch (error) {
              checkCurrent(pageNumber);
              if (error instanceof PdfParseInterruption) throw error;
              throw interruption('PDF_PAGE_FAILED', pageNumber);
            } finally {
              try {
                page?.cleanup();
              } catch {
                // A closed loading task may already have released this page.
              }
            }
            onProgress?.(cached.pages.length, total);
          }
          checkCurrent();
          return pdfToBook(
            { totalPages, title, author, pages: cached.pages },
            { id: `${hash}.pdfjs-v2.${from}-${to}`, fileName: file.name, pageTitle, unknownAuthor },
          );
        } finally {
          parsing = false;
        }
      },
      async close() {
        await destroy();
      },
    };
  } catch (error) {
    await destroy().catch(() => {});
    throw error;
  }
}
