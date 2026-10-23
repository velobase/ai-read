import type { Book, BookMediaDiagnostics, BookReferenceRange, Paragraph } from './types';

export type MarkupImageReference = {
  source: string;
  /** Original img occurrence, including earlier inline or rejected references. */
  order: number;
  paragraphId: string;
  position: 'before' | 'after';
  alt?: string;
};
export type MarkupMediaCollection = {
  images: MarkupImageReference[];
  diagnostics: BookMediaDiagnostics;
};
export function createMarkupMediaCollection(): MarkupMediaCollection {
  return {
    images: [],
    diagnostics: {
      skippedInline: 0,
      skippedUnsupported: 0,
      skippedUnsafePath: 0,
      skippedMissing: 0,
      skippedInvalid: 0,
      skippedLimit: 0,
      skippedUnanchored: 0,
    },
  };
}

/** Minimal structural DOM contract, usable with browser DOM and native XML adapters. */
export type MarkupNode = {
  nodeType: number;
  localName?: string | null;
  textContent: string | null;
  childNodes: ArrayLike<MarkupNode>;
  getAttribute?: (name: string) => string | null;
  getAttributeNS?: (namespace: string | null, name: string) => string | null;
};
export type MarkupReferenceCollection = {
  links: { href: string; source: BookReferenceRange[]; node: MarkupNode; order: number }[];
  skippedLimit: number;
  anchors: Map<string, { paragraphId: string; offset: number; node: MarkupNode }>;
  nodes: Map<MarkupNode, BookReferenceRange[]>;
};
export const createMarkupReferenceCollection = (): MarkupReferenceCollection => ({
  links: [],
  skippedLimit: 0,
  anchors: new Map(),
  nodes: new Map(),
});
const ignored = new Set(['script', 'style', 'nav', 'svg', 'math', 'noscript', 'iframe', 'object']);
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'tr']);
const containers = new Set([
  'div',
  'section',
  'article',
  'main',
  'ol',
  'ul',
  'table',
  'tbody',
  'thead',
  'header',
  'footer',
]);
function safeText(node: MarkupNode): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.textContent || '';
  if (ignored.has(node.localName?.toLowerCase() || '')) return '';
  if (node.localName?.toLowerCase() === 'br') return '\n';
  return Array.from(node.childNodes).map(safeText).join('');
}
export function paragraphsFromMarkup(
  body: MarkupNode,
  chapterIndex: number,
  anchors?: Map<string, string>,
  media?: MarkupMediaCollection,
  references?: MarkupReferenceCollection,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  type RawImage = Pick<MarkupImageReference, 'source' | 'alt' | 'order'>;
  const imageBoundaries: { image: RawImage; boundary: number; preferBefore: boolean }[] = [];
  const leadingImageBoundaries: { image: RawImage; paragraphIndex: number }[] = [];
  const imageNodes = new WeakMap<RawImage, MarkupNode>();
  let imageCount = 0;
  // Observe images separately from text collection: never add, split, or change a paragraph.
  const imagesIn = (root: MarkupNode): RawImage[] => {
    if (!media) return [];
    const found: RawImage[] = [];
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.nodeType !== 1) continue;
      const tag = node.localName?.toLowerCase() || '';
      if (ignored.has(tag)) {
        if (tag === 'svg' || tag === 'object') media.diagnostics.skippedUnsupported++;
        continue;
      }
      if (tag === 'img') {
        if (++imageCount > 2000) media.diagnostics.skippedLimit++;
        else {
          const alt = node.getAttribute?.('alt')?.trim().slice(0, 1000);
          const image: RawImage = {
            source: node.getAttribute?.('src') || '',
            order: imageCount,
            ...(alt ? { alt } : {}),
          };
          found.push(image);
          imageNodes.set(image, node);
        }
      } else {
        for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
      }
    }
    return found;
  };
  // A direct paragraph prefix of images followed by an explicit line break is
  // a separate illustration line. Do not infer this from whitespace or CSS:
  // an image beside a word may instead be an inline symbol or formula.
  const leadingImages = (node: MarkupNode): Set<MarkupNode> | undefined => {
    const images = new Set<MarkupNode>();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) continue;
      if (child.nodeType === 3 || child.nodeType === 4) {
        if (!child.textContent?.trim()) continue;
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.localName?.toLowerCase() || '';
      if (tag === 'img') images.add(child);
      else if (tag === 'br' && images.size) return images;
      else return;
    }
  };
  const recordImages = (
    images: RawImage[],
    raw: string,
    start: number,
    leading?: Set<MarkupNode>,
  ) => {
    if (!media || !images.length) return;
    if (raw.trim()) {
      for (const image of images) {
        if (leading?.has(imageNodes.get(image)!))
          leadingImageBoundaries.push({ image, paragraphIndex: paragraphs.length });
        else media.diagnostics.skippedInline++;
      }
    } else
      for (const image of images)
        imageBoundaries.push({
          image,
          boundary: paragraphs.length,
          preferBefore: paragraphs.length === start,
        });
  };
  type Point = { id?: string; offset: number; end?: number; node?: MarkupNode };
  type RawLink = { href: string; start: number; end: number; node: MarkupNode; order: number };
  let linkOrder = 0;
  const targets = new Map<string, number>();
  const ids = (node: MarkupNode) =>
    anchors || references
      ? [
          node.getAttribute?.('id'),
          node.getAttribute?.('xml:id'),
          node.localName?.toLowerCase() === 'a' ? node.getAttribute?.('name') : null,
        ].filter((id): id is string => !!id && id.length <= 2000)
      : [];
  const remember = (id: string, index: number) => {
    if (!targets.has(id)) targets.set(id, index);
  };
  const collect = (root: MarkupNode): { text: string; points: Point[]; links: RawLink[] } => {
    if (!anchors && !references) return { text: safeText(root), points: [], links: [] };
    const parts: string[] = [],
      points: Point[] = [],
      links: RawLink[] = [];
    let offset = 0;
    const visit = (node: MarkupNode) => {
      const tag = node.localName?.toLowerCase() || '';
      if (ignored.has(tag)) return;
      const nodePoints = ids(node).map((id): Point => ({ id, offset, node }));
      if (
        references &&
        !nodePoints.length &&
        (blocks.has(tag) || ['a', 'aside', 'section', 'div'].includes(tag))
      )
        nodePoints.push({ offset, node });
      points.push(...nodePoints);
      const href = references && tag === 'a' ? node.getAttribute?.('href') : null;
      if (href && ++linkOrder > 2000) references!.skippedLimit++;
      const link: RawLink | undefined =
        href && linkOrder <= 2000
          ? { href, start: offset, end: offset, node, order: linkOrder }
          : undefined;
      if (node.nodeType === 3 || node.nodeType === 4 || tag === 'br') {
        const value = tag === 'br' ? '\n' : node.textContent || '';
        parts.push(value);
        offset += value.length;
      } else for (const child of Array.from(node.childNodes)) visit(child);
      for (const point of nodePoints) point.end = offset;
      if (link) {
        link.end = offset;
        links.push(link);
      }
    };
    visit(root);
    return { text: parts.join(''), points, links };
  };
  const add = (raw: string, tag: string, points: Point[] = [], links: RawLink[] = []) => {
    const value = tag === 'pre' ? raw.trim() : raw.replace(/\s+/g, ' ').trim();
    const first = paragraphs.length;
    if (!value) {
      for (const point of points) if (point.id) remember(point.id, first);
      return;
    }
    const pieces = value.match(/[\s\S]{1,2400}(?:\s|$)|[\s\S]{1,2400}/gu) || [];
    for (const piece of pieces)
      paragraphs.push({
        id: `${chapterIndex + 1}.${paragraphs.length + 1}`,
        text: piece.trim(),
        kind: /^h[1-6]$/.test(tag)
          ? 'heading'
          : tag === 'blockquote'
            ? 'quote'
            : tag === 'pre'
              ? 'code'
              : 'text',
      });
    for (const point of points) {
      const prefix = raw.slice(0, point.offset);
      let offset = (tag === 'pre' ? prefix : prefix.replace(/\s+/g, ' ')).trimStart().length;
      let piece = 0;
      while (piece < pieces.length - 1 && offset >= pieces[piece].length)
        offset -= pieces[piece++].length;
      if (point.id) remember(point.id, first + piece);
    }
    if (references) {
      const normalizedOffsets = new Map<number, number>();
      const normalized = (offset: number) => {
        const known = normalizedOffsets.get(offset);
        if (known !== undefined) return known;
        const valueOffset = Math.min(
          value.length,
          (tag === 'pre'
            ? raw.slice(0, offset)
            : raw.slice(0, offset).replace(/\s+/g, ' ')
          ).trimStart().length,
        );
        normalizedOffsets.set(offset, valueOffset);
        return valueOffset;
      };
      let consumed = 0;
      const segments = pieces.map((piece, index) => {
        const segment = {
          paragraphId: paragraphs[first + index].id,
          start: consumed + piece.length - piece.trimStart().length,
          length: piece.trim().length,
        };
        consumed += piece.length;
        return segment;
      });
      const ranges = (start: number, end: number) =>
        segments.flatMap((segment) => {
          const from = Math.max(segment.start, normalized(start));
          const to = Math.min(segment.start + segment.length, normalized(end));
          return to > from
            ? [
                {
                  paragraphId: segment.paragraphId,
                  start: from - segment.start,
                  end: to - segment.start,
                },
              ]
            : [];
        });
      for (const point of points) {
        const span = ranges(point.offset, point.end ?? point.offset);
        if (
          point.node &&
          span.length &&
          references.nodes.size < 10000 &&
          !references.nodes.has(point.node)
        )
          references.nodes.set(point.node, span);
        if (point.id && point.node && !references.anchors.has(point.id)) {
          const offset = normalized(point.offset);
          const segment =
            segments.find((part) => offset < part.start + part.length) || segments.at(-1)!;
          references.anchors.set(point.id, {
            paragraphId: segment.paragraphId,
            offset: Math.max(0, Math.min(segment.length, offset - segment.start)),
            node: point.node,
          });
        }
      }
      for (const link of links)
        references.links.push({
          href: link.href,
          node: link.node,
          order: link.order,
          source: ranges(link.start, link.end),
        });
    }
  };
  const walk = (node: MarkupNode) => {
    const start = paragraphs.length;
    for (const id of ids(node)) remember(id, paragraphs.length);
    let pending = '';
    let pendingPoints: Point[] = [];
    let pendingLinks: RawLink[] = [];
    let pendingImages: RawImage[] = [];
    const flush = () => {
      recordImages(pendingImages, pending, start);
      add(pending, 'p', pendingPoints, pendingLinks);
      pending = '';
      pendingPoints = [];
      pendingLinks = [];
      pendingImages = [];
    };
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        pending += child.textContent || '';
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.localName?.toLowerCase() || '';
      if (ignored.has(tag)) {
        imagesIn(child);
        continue;
      }
      if (blocks.has(tag)) {
        flush();
        if (tag === 'tr') {
          for (const id of ids(child)) remember(id, paragraphs.length);
          let row = '';
          let cellIndex = 0;
          const points: Point[] = [];
          const links: RawLink[] = [];
          for (const cell of Array.from(child.childNodes).filter((n) => n.nodeType === 1)) {
            const part = collect(cell);
            if (cellIndex++) row += ' | ';
            points.push(
              ...part.points.map((point) => ({
                ...point,
                offset: point.offset + row.length,
                end: point.end === undefined ? undefined : point.end + row.length,
              })),
            );
            links.push(
              ...part.links.map((link) => ({
                ...link,
                start: link.start + row.length,
                end: link.end + row.length,
              })),
            );
            row += part.text;
          }
          recordImages(imagesIn(child), row, start);
          add(row, tag, points, links);
        } else {
          const part = collect(child);
          recordImages(
            imagesIn(child),
            part.text,
            start,
            media && tag === 'p' ? leadingImages(child) : undefined,
          );
          add(part.text, tag, part.points, part.links);
        }
      } else if (containers.has(tag)) {
        flush();
        walk(child);
      } else {
        const part = collect(child);
        pendingImages.push(...imagesIn(child));
        pendingPoints.push(
          ...part.points.map((point) => ({
            ...point,
            offset: point.offset + pending.length,
            end: point.end === undefined ? undefined : point.end + pending.length,
          })),
        );
        pendingLinks.push(
          ...part.links.map((link) => ({
            ...link,
            start: link.start + pending.length,
            end: link.end + pending.length,
          })),
        );
        pending += part.text;
      }
    }
    flush();
    if (references && paragraphs.length > start) {
      const ranges = paragraphs
        .slice(start)
        .map((p) => ({ paragraphId: p.id, start: 0, end: p.text.length }));
      if (references.nodes.size < 10000) references.nodes.set(node, ranges);
      else references.skippedLimit++;
      for (const id of ids(node))
        if (!references.anchors.has(id))
          references.anchors.set(id, { paragraphId: paragraphs[start].id, offset: 0, node });
    }
  };
  walk(body);
  if (media) {
    // Images sharing one boundary use one anchor, preserving their original order.
    const placementAt = new Map<number, Pick<MarkupImageReference, 'paragraphId' | 'position'>>();
    for (const { image, boundary, preferBefore } of imageBoundaries) {
      if (!paragraphs.length) {
        media.diagnostics.skippedUnanchored++;
        continue;
      }
      let placement = placementAt.get(boundary);
      if (!placement) {
        const before = (preferBefore && boundary < paragraphs.length) || boundary === 0;
        placement = {
          paragraphId: paragraphs[before ? boundary : boundary - 1].id,
          position: before ? 'before' : 'after',
        };
        placementAt.set(boundary, placement);
      }
      media.images.push({ ...image, ...placement });
    }
    // Keep the old boundary grouping untouched: adding a prefix image must not
    // move an existing image from the previous paragraph's end to this start.
    for (const { image, paragraphIndex } of leadingImageBoundaries) {
      const paragraph = paragraphs[paragraphIndex];
      if (!paragraph) media.diagnostics.skippedUnanchored++;
      else media.images.push({ ...image, paragraphId: paragraph.id, position: 'before' });
    }
  }
  if (anchors && paragraphs.length)
    for (const [id, index] of targets)
      if (!anchors.has(id)) anchors.set(id, paragraphs[Math.min(index, paragraphs.length - 1)].id);
  return paragraphs;
}
/** Locale-dependent labels and book metadata do not change paragraph anchors. */
export function sameBookContent(a: Book, b: Book): boolean {
  return (
    a.chapters.length === b.chapters.length &&
    a.chapters.every((chapter, i) => {
      const other = b.chapters[i];
      return (
        chapter.id === other.id &&
        chapter.paragraphs.length === other.paragraphs.length &&
        chapter.paragraphs.every(
          (p, j) =>
            p.id === other.paragraphs[j].id &&
            p.text === other.paragraphs[j].text &&
            p.kind === other.paragraphs[j].kind,
        )
      );
    })
  );
}
