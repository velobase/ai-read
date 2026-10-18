import type { Position } from '@/lib/types';

export type ReadingAnchor = Pick<
  Position,
  'paragraph' | 'offset' | 'textOffset' | 'textSource' | 'textQuote'
> & {
  chapter?: number;
  visualOffset?: number;
};

const restoredLocations = new WeakMap<
  HTMLElement,
  {
    anchor: ReadingAnchor;
    paged: boolean;
    page: number;
    chapter: string;
    scroll: number;
  }
>();

export const isPaged = (root: HTMLElement) =>
  root.closest('.reading-app')?.getAttribute('data-navigation') === 'paged';
export const chapterFrames = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('.reader-chapters > [data-chapter-index]'));
export const activeFrame = (root: HTMLElement) =>
  chapterFrames(root).find((frame) => frame.dataset.current === 'true');
export const pageIndex = (frame: HTMLElement) => Number(frame.dataset.page || 0);
export function pageCount(frame: HTMLElement) {
  const viewport = frame.querySelector<HTMLElement>('.page-viewport');
  const content = frame.querySelector<HTMLElement>('[data-book-page]');
  return viewport && content
    ? Math.max(1, Math.round(content.scrollWidth / Math.max(1, viewport.clientWidth)))
    : 1;
}
export function setPage(frame: HTMLElement, index: number) {
  const viewport = frame.querySelector<HTMLElement>('.page-viewport');
  const content = frame.querySelector<HTMLElement>('[data-book-page]');
  const next = Math.max(0, Math.min(pageCount(frame) - 1, index));
  frame.dataset.page = String(next);
  const root = frame.closest<HTMLElement>('.reading-scroll');
  if (root && frame.dataset.current === 'true') restoredLocations.delete(root);
  if (viewport && content)
    content.style.transform = `translateX(${-next * viewport.clientWidth}px)`;
}
export function readingTop(root: HTMLElement) {
  return parseFloat(getComputedStyle(root).paddingTop) || 88;
}
export function readingBottom(root: HTMLElement) {
  return parseFloat(getComputedStyle(root).paddingBottom) || 80;
}
function texts(element: Element) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode())
    if (walker.currentNode.textContent?.length) nodes.push(walker.currentNode as Text);
  return nodes;
}
function characterRect(node: Text, offset: number) {
  const range = document.createRange();
  range.setStart(node, Math.max(0, Math.min(node.length - 1, offset)));
  range.setEnd(node, Math.max(1, Math.min(node.length, offset + 1)));
  return range.getBoundingClientRect();
}
function textRect(element: Element, offset: number) {
  for (const node of texts(element)) {
    if (offset < node.length) return characterRect(node, offset);
    offset -= node.length;
  }
  const last = texts(element).at(-1);
  return last ? characterRect(last, last.length - 1) : element.getBoundingClientRect();
}

/** Find a real visible text character, including fragments of a column-split paragraph. */
export function readReadingAnchor(root: HTMLElement): ReadingAnchor | null {
  const paged = isPaged(root);
  const frame = paged ? activeFrame(root) : undefined;
  const restored = restoredLocations.get(root);
  if (
    restored &&
    restored.paged === paged &&
    (paged
      ? frame?.dataset.chapterIndex === restored.chapter && pageIndex(frame) === restored.page
      : Math.abs(root.scrollTop - restored.scroll) < 1)
  )
    return restored.anchor;
  restoredLocations.delete(root);
  const area = paged ? frame?.querySelector<HTMLElement>('.page-viewport') : root;
  if (!area) return null;
  const bounds = area.getBoundingClientRect();
  const top = bounds.top + (paged ? 0 : readingTop(root));
  const content = frame || root;
  for (const element of content.querySelectorAll<HTMLElement>('[data-note-source]')) {
    const passage = element.closest<HTMLElement>('[data-paragraph]');
    if (!passage) continue;
    let prefix = 0;
    for (const node of texts(element)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const visible = Array.from(range.getClientRects()).some(
        (r) =>
          r.width > 0 &&
          r.bottom > top + 1 &&
          r.top < bounds.bottom &&
          r.right > bounds.left + 1 &&
          r.left < bounds.right - 1,
      );
      if (visible) {
        let low = 0,
          high = node.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          const r = characterRect(node, mid);
          const before = paged
            ? r.right <= bounds.left + 1 || (r.left < bounds.right && r.bottom <= top + 1)
            : r.bottom <= top + 1;
          if (before) low = mid + 1;
          else high = mid;
        }
        if (low < node.length) {
          const offset = prefix + low;
          const text = element.textContent || '';
          const source = element.dataset.noteSource === 'translation' ? 'translation' : 'original';
          return {
            paragraph: passage.dataset.paragraph!,
            chapter: Number(
              passage.closest<HTMLElement>('[data-chapter-index]')?.dataset.chapterIndex || 0,
            ),
            textOffset: offset,
            textSource: source,
            textQuote: text.slice(offset, offset + 32),
            offset: source === 'original' ? offset / Math.max(1, text.length) : 0,
            visualOffset: characterRect(node, low).top - top,
          };
        }
      }
      prefix += node.length;
    }
  }
  return null;
}

export function restoreReadingAnchor(root: HTMLElement, anchor: ReadingAnchor) {
  const passage = Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]')).find(
    (node) => node.dataset.paragraph === anchor.paragraph,
  );
  if (!passage) return;
  const source = anchor.textSource || 'original';
  const exact = passage.querySelector<HTMLElement>(`[data-note-source="${source}"]`);
  const element = exact || passage.querySelector<HTMLElement>('[data-note-source]') || passage;
  const text = element.textContent || '';
  let offset = exact ? (anchor.textOffset ?? Math.floor((anchor.offset || 0) * text.length)) : 0;
  // Translations can be revised. A stale character index must not masquerade as alignment.
  if (
    anchor.textQuote &&
    text.slice(offset, offset + anchor.textQuote.length) !== anchor.textQuote
  ) {
    const found = text.indexOf(anchor.textQuote);
    offset = found >= 0 ? found : 0;
  }
  const rect = textRect(element, Math.max(0, Math.min(text.length - 1, offset)));
  const frame = passage.closest<HTMLElement>('[data-chapter-index]');
  if (isPaged(root) && frame) {
    const viewport = frame.querySelector<HTMLElement>('.page-viewport')!;
    setPage(
      frame,
      pageIndex(frame) +
        Math.floor(
          (rect.left - viewport.getBoundingClientRect().left + 1) /
            Math.max(1, viewport.clientWidth),
        ),
    );
  } else {
    const first = frame?.querySelector('[data-paragraph]') === passage;
    const y =
      first && offset === 0
        ? frame!.getBoundingClientRect().top
        : rect.top - (anchor.visualOffset ?? 0);
    root.scrollTo({
      top: Math.max(0, root.scrollTop + y - root.getBoundingClientRect().top - readingTop(root)),
      behavior: 'instant',
    });
  }
  const sourceNow = element.dataset.noteSource === 'translation' ? 'translation' : 'original';
  restoredLocations.set(root, {
    paged: isPaged(root),
    page: frame ? pageIndex(frame) : 0,
    chapter: frame?.dataset.chapterIndex || '0',
    scroll: root.scrollTop,
    anchor: {
      ...anchor,
      chapter: Number(frame?.dataset.chapterIndex || 0),
      textOffset: offset,
      textSource: sourceNow,
      textQuote: text.slice(offset, offset + 32),
      offset: sourceNow === 'original' ? offset / Math.max(1, text.length) : 0,
    },
  });
}
