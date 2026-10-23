import type { Book, BookTocEntry, Chapter } from './types';
import type { MarkupNode } from './import-markup';
import { inferPdfToc, isPdfBook } from './pdf-toc';

/** EPUB keeps every readable spine; PDF can navigate real headings or all physical pages. */
export function bookContents(book: Book, options: { pdfPages?: boolean } = {}): BookTocEntry[] {
  if (isPdfBook(book)) {
    const entries = book.toc?.length ? book.toc : inferPdfToc(book);
    if (!options.pdfPages && entries.length) return entries;
    return book.chapters.flatMap((chapter) =>
      chapter.paragraphs.length
        ? [
            {
              title: chapter.title,
              chapterId: chapter.id,
              paragraphId: chapter.paragraphs[0].id,
              depth: 0,
            },
          ]
        : [],
    );
  }
  const groups = new Map<string, BookTocEntry[]>();
  for (const entry of book.toc || []) {
    const group = groups.get(entry.chapterId) || [];
    group.push(entry);
    groups.set(entry.chapterId, group);
  }
  return book.chapters.flatMap((chapter) => {
    const positions = new Map(chapter.paragraphs.map((p, index) => [p.id, index]));
    const entries = (groups.get(chapter.id) || [])
      .filter((entry) => positions.has(entry.paragraphId))
      .sort((a, b) => positions.get(a.paragraphId)! - positions.get(b.paragraphId)!);
    return entries.length
      ? entries
      : chapter.paragraphs.length
        ? [
            {
              title: chapter.title,
              chapterId: chapter.id,
              paragraphId: chapter.paragraphs[0].id,
              depth: 0,
            },
          ]
        : [];
  });
}

export type EpubNavigationDocument = { document: MarkupNode; path: string; kind: 'nav' | 'ncx' };
export type EpubChapterTarget = {
  path: string;
  chapter: Chapter;
  anchors: ReadonlyMap<string, string>;
};

type Link = { title: string; path: string; fragment: string; depth: number };
const children = (node: MarkupNode) =>
  Array.from(node.childNodes).filter((child) => child.nodeType === 1);
const name = (node: MarkupNode) => node.localName?.toLowerCase() || '';
const attribute = (node: MarkupNode, key: string) => node.getAttribute?.(key) || '';
const label = (node: MarkupNode | undefined) =>
  (node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000);

function descendants(root: MarkupNode, tag: string) {
  const found: MarkupNode[] = [];
  const pending = [root];
  let visited = 0;
  while (pending.length && visited++ < 20000) {
    const node = pending.pop()!;
    if (name(node) === tag) found.push(node);
    pending.push(...children(node).reverse());
  }
  return found;
}
function reference(documentPath: string, href: string) {
  const split = href.indexOf('#');
  let path = split < 0 ? href : href.slice(0, split);
  let fragment = split < 0 ? '' : href.slice(split + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Literal percent signs occur in older books. */
  }
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    /* Preserve a literal fragment. */
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.includes('\\')) return null;
  if (!path) return { path: documentPath, fragment };
  const parts = documentPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return { path: parts.join('/'), fragment };
}
function linksFromDocument(input: EpubNavigationDocument): Link[] {
  const links: Link[] = [];
  const add = (title: string, href: string, depth: number) => {
    const target = href ? reference(input.path, href) : null;
    if (title && target && links.length < 2000)
      links.push({ title, ...target, depth: Math.min(8, depth) });
  };
  if (input.kind === 'ncx') {
    const map = descendants(input.document, 'navmap')[0];
    if (!map) return links;
    const pending = children(map)
      .filter((node) => name(node) === 'navpoint')
      .reverse()
      .map((node) => ({ node, depth: 0 }));
    let visited = 0;
    while (pending.length && links.length < 2000 && visited++ < 20000) {
      const { node, depth } = pending.pop()!;
      const parts = children(node);
      const content = parts.find((item) => name(item) === 'content');
      add(
        label(parts.find((item) => name(item) === 'navlabel')),
        content ? attribute(content, 'src') : '',
        depth,
      );
      pending.push(
        ...parts
          .filter((item) => name(item) === 'navpoint')
          .reverse()
          .map((node) => ({ node, depth: depth + 1 })),
      );
    }
    return links;
  }
  const nav = descendants(input.document, 'nav').find((node) => {
    const type =
      node.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || attribute(node, 'epub:type');
    return (
      type.split(/\s+/).includes('toc') || attribute(node, 'role').split(/\s+/).includes('doc-toc')
    );
  });
  const list = nav && children(nav).find((node) => name(node) === 'ol');
  if (!list) return links;
  const pending = children(list)
    .filter((node) => name(node) === 'li')
    .reverse()
    .map((node) => ({ node, depth: 0 }));
  let visited = 0;
  while (pending.length && links.length < 2000 && visited++ < 20000) {
    const { node, depth } = pending.pop()!;
    const parts = children(node);
    const anchor = parts.find((item) => name(item) === 'a');
    if (anchor) add(label(anchor), attribute(anchor, 'href'), depth);
    const nested = parts
      .filter((item) => name(item) === 'ol')
      .flatMap(children)
      .filter((item) => name(item) === 'li');
    pending.push(...nested.reverse().map((node) => ({ node, depth: depth + 1 })));
  }
  return links;
}

/** Resolve local EPUB2/3 navigation onto existing paragraph IDs; never reflow the book. */
export function epubNavigation(documents: EpubNavigationDocument[], chapters: EpubChapterTarget[]) {
  const byPath = new Map(chapters.map((target) => [target.path, target]));
  // Prefer an EPUB3 toc; use NCX when the nav document is absent or has no readable targets.
  const candidates = [
    ...documents.filter((doc) => doc.kind === 'nav'),
    ...documents.filter((doc) => doc.kind === 'ncx'),
  ];
  for (const document of candidates) {
    const toc: BookTocEntry[] = [];
    const chapterTitles = new Map<string, string>();
    const seen = new Set<string>();
    for (const link of linksFromDocument(document)) {
      const target = byPath.get(link.path);
      if (!target) continue;
      const paragraphId = link.fragment
        ? target.anchors.get(link.fragment)
        : target.chapter.paragraphs[0]?.id;
      if (!paragraphId) continue;
      if (!link.fragment && !chapterTitles.has(target.chapter.id))
        chapterTitles.set(target.chapter.id, link.title);
      const entry = {
        title: link.title,
        chapterId: target.chapter.id,
        paragraphId,
        depth: link.depth,
      };
      const key = JSON.stringify(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      toc.push(entry);
    }
    if (toc.length) return { toc, chapterTitles };
  }
  return { toc: [] as BookTocEntry[], chapterTitles: new Map<string, string>() };
}
