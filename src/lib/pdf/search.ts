import type { PDFDocumentProxy, TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import type { PdfTextEvidence } from '../../../packages/reading-core/src';

export const PDF_SEARCH_LIMIT = 2000;
const MAX_PAGE_CHARACTERS = 2 * 1024 * 1024;
const MAX_PAGE_ITEMS = 50000;
const MAX_DOCUMENT_CHARACTERS = 20 * 1024 * 1024;

export type PdfSearchMatch = {
  page: number;
  ranges: { item: number; start: number; end: number }[];
  /** Complete source match and adjacent text; absent when the bounded evidence cannot fit. */
  evidence?: PdfTextEvidence;
};
export type PdfSearchProgress = {
  matches: PdfSearchMatch[];
  scannedPages: number;
  totalPages: number;
  textPages: number;
  limited: boolean;
};
export type PdfSearchRect = { left: number; top: number; width: number; height: number };

function check(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError');
}
function evidenceAt(text: string, start: number, end: number): PdfTextEvidence | undefined {
  const splitsPair = (offset: number) =>
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset]);
  if (end - start > 640 || splitsPair(start) || splitsPair(end)) return;
  let before = Math.max(0, start - 80);
  let after = Math.min(text.length, end + 80);
  if (splitsPair(before)) before++;
  if (splitsPair(after)) after--;
  return {
    quote: text.slice(start, end),
    before: text.slice(before, start),
    after: text.slice(end, after),
  };
}
function textItems(content: TextContent): TextItem[] {
  const items = content.items.filter((item): item is TextItem => 'str' in item);
  if (
    items.length > MAX_PAGE_ITEMS ||
    items.reduce((length, item) => length + item.str.length + Number(item.hasEOL), 0) >
      MAX_PAGE_CHARACTERS
  )
    throw new Error('PDF_SEARCH_PAGE_LIMIT');
  return items;
}

/** Local text only; no annotation/link actions, OCR, model calls or retained page index. */
export async function searchPdf(
  document: PDFDocumentProxy,
  query: string,
  options: { signal: AbortSignal; onProgress: (progress: PdfSearchProgress) => void },
): Promise<PdfSearchProgress> {
  const { signal } = options;
  check(signal);
  const needle = query.trim();
  if (!needle || needle.length > 160) throw new Error('PDF_SEARCH_QUERY');
  // Escaping makes the query literal. Unicode ignore-case matching keeps the
  // original UTF-16 indices, unlike lowercasing strings whose lengths may change.
  const matcher = new RegExp(
    needle
      .split(/\s+/u)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+'),
    'giu',
  );
  const matches: PdfSearchMatch[] = [];
  let textPages = 0;
  let characters = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    check(signal);
    const page = await document.getPage(pageNumber);
    check(signal);
    const content = await page.getTextContent();
    check(signal);
    const items = textItems(content);
    const pieces: string[] = [];
    const spans: { item: number; start: number; end: number }[] = [];
    let offset = 0;
    for (const [item, value] of items.entries()) {
      spans.push({ item, start: offset, end: offset + value.str.length });
      pieces.push(value.str);
      offset += value.str.length;
      if (value.hasEOL) {
        pieces.push(' ');
        offset++;
      }
    }
    const text = pieces.join('');
    characters += text.length;
    if (characters > MAX_DOCUMENT_CHARACTERS) throw new Error('PDF_SEARCH_TEXT_LIMIT');
    if (text.trim()) textPages++;
    matcher.lastIndex = 0;
    let found: RegExpExecArray | null;
    let firstSpan = 0;
    while ((found = matcher.exec(text))) {
      check(signal);
      const start = found.index;
      const end = start + found[0].length;
      while (firstSpan < spans.length && spans[firstSpan].end <= start) firstSpan++;
      const ranges: PdfSearchMatch['ranges'] = [];
      for (let index = firstSpan; index < spans.length && spans[index].start < end; index++) {
        const span = spans[index];
        const from = Math.max(start, span.start) - span.start;
        const to = Math.min(end, span.end) - span.start;
        if (to > from) ranges.push({ item: span.item, start: from, end: to });
      }
      if (!ranges.length) continue;
      if (matches.length === PDF_SEARCH_LIMIT)
        return {
          matches,
          scannedPages: pageNumber,
          totalPages: document.numPages,
          textPages,
          limited: true,
        };
      matches.push({ page: pageNumber, ranges, evidence: evidenceAt(text, start, end) });
      if (matches.length % 100 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        check(signal);
      }
    }
    options.onProgress({
      matches: [...matches],
      scannedPages: pageNumber,
      totalPages: document.numPages,
      textPages,
      limited: false,
    });
    // This PDFPageProxy is shared with the visible canvas renderer. Leave page
    // and document cleanup to that owner; cleanup must not disrupt rendering.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    check(signal);
  }
  return {
    matches,
    scannedPages: document.numPages,
    totalPages: document.numPages,
    textPages,
    limited: false,
  };
}

/**
 * Measure actual PDF.js text runs instead of estimating character widths. The
 * temporary transparent layer has no links/actions and is removed after layout.
 * Rectangles are in the same CSS-pixel coordinate system as the visible canvas.
 */
export async function pdfSearchRects(
  document: PDFDocumentProxy,
  match: PdfSearchMatch,
  viewport: PageViewport,
  host: HTMLElement,
  signal: AbortSignal,
): Promise<PdfSearchRect[]> {
  check(signal);
  const page = await document.getPage(match.page);
  check(signal);
  const content = await page.getTextContent();
  check(signal);
  const items = textItems(content);
  const { TextLayer } = await import('pdfjs-dist');
  check(signal);
  const container = globalThis.document.createElement('div');
  container.ariaHidden = 'true';
  Object.assign(container.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    lineHeight: '1',
    textAlign: 'initial',
    direction: 'ltr',
    letterSpacing: 'normal',
    wordSpacing: 'normal',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    userSelect: 'none',
    overflow: 'clip',
    opacity: '0',
  });
  container.style.setProperty('text-size-adjust', 'none');
  container.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
  container.style.setProperty('--min-font-size-inv', 'calc(1 / var(--min-font-size))');
  const layer = new TextLayer({ textContentSource: content, container, viewport });
  // Match the PDF.js viewer's layer rotation, including PDF user-unit scaling.
  // Explicit dimensions avoid relying on its global viewer stylesheet/rounding.
  const sideways = viewport.rotation % 180 !== 0;
  container.style.width = `${sideways ? viewport.height : viewport.width}px`;
  container.style.height = `${sideways ? viewport.width : viewport.height}px`;
  container.style.transform =
    viewport.rotation === 90
      ? 'rotate(90deg) translateY(-100%)'
      : viewport.rotation === 180
        ? 'rotate(180deg) translate(-100%, -100%)'
        : viewport.rotation === 270
          ? 'rotate(270deg) translateX(-100%)'
          : '';
  host.append(container);
  const cancel = () => layer.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await layer.render();
    check(signal);
    for (const span of layer.textDivs) {
      Object.assign(span.style, {
        color: 'transparent',
        position: 'absolute',
        whiteSpace: 'pre',
        transformOrigin: '0 0',
        fontSize: 'calc(var(--total-scale-factor) * var(--min-font-size) * var(--font-height))',
        transform:
          'rotate(var(--rotate, 0deg)) scaleX(var(--scale-x, 1)) scale(var(--min-font-size-inv))',
      });
    }
    const bounds = host.getBoundingClientRect();
    const scaleX = bounds.width / viewport.width;
    const scaleY = bounds.height / viewport.height;
    if (!host.isConnected || scaleX <= 0 || scaleY <= 0) throw new Error('PDF_SEARCH_LAYOUT');
    const result: PdfSearchRect[] = [];
    for (const part of match.ranges) {
      const item = items[part.item];
      const span = layer.textDivs[part.item];
      const text = span?.firstChild;
      if (
        !item ||
        !text ||
        text.nodeType !== Node.TEXT_NODE ||
        text.textContent !== item.str ||
        part.start < 0 ||
        part.end > item.str.length ||
        part.start >= part.end
      )
        throw new Error('PDF_SEARCH_LAYOUT');
      const range = globalThis.document.createRange();
      range.setStart(text, part.start);
      range.setEnd(text, part.end);
      for (const box of range.getClientRects()) {
        const left = Math.max(0, (box.left - bounds.left) / scaleX);
        const top = Math.max(0, (box.top - bounds.top) / scaleY);
        const right = Math.min(viewport.width, (box.right - bounds.left) / scaleX);
        const bottom = Math.min(viewport.height, (box.bottom - bounds.top) / scaleY);
        if (right > left && bottom > top)
          result.push({ left, top, width: right - left, height: bottom - top });
      }
    }
    check(signal);
    if (!result.length) throw new Error('PDF_SEARCH_LAYOUT');
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    layer.cancel();
    container.remove();
  }
}
