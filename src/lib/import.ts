import { strFromU8, unzip } from 'fflate';
import type { Book, Chapter, Paragraph } from './types';
import { validateBook } from './reading-backup';
import { MAX_BOOK_TEXT } from './reading-validation';

const MAX_FILE = 30 * 1024 * 1024;
const MAX_TEXT = MAX_BOOK_TEXT;
const MAX_ENTRY = 4 * 1024 * 1024;
const xml = (value: string) => new DOMParser().parseFromString(value, 'application/xml');
const descendants = (doc: Document | Element, name: string) =>
  Array.from(doc.getElementsByTagNameNS('*', name));
const text = (doc: Document, tag: string) => descendants(doc, tag)[0]?.textContent?.trim() || '';

function normalizePath(base: string, href: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split('#')[0]);
  } catch {
    decoded = href.split('#')[0];
  }
  if (/^[a-z]+:/i.test(decoded)) throw new Error('EPUB 含有不支持的外部章节。');
  const parts = `${base}/${decoded}`.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part && part !== '.') result.push(part);
  }
  return result.join('/');
}

function paragraphize(value: string, chapterIndex: number): Paragraph[] {
  const doc = new DOMParser().parseFromString(value, 'application/xhtml+xml');
  if (doc.querySelector('parsererror'))
    throw new Error('EPUB 章节不是有效的 XHTML，暂时无法导入。');
  doc
    .querySelectorAll('script, style, nav, svg, math, noscript, iframe, object')
    .forEach((n) => n.remove());
  const body = descendants(doc, 'body')[0] || doc.documentElement;
  const paragraphs: Paragraph[] = [];
  const add = (raw: string, tag: string) => {
    const normalized = tag === 'pre' ? raw.trim() : raw.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    // Keep individual sources bounded so translations and citations stay usable.
    const pieces = normalized.match(/[\s\S]{1,2400}(?:\s|$)|[\s\S]{1,2400}/gu) || [];
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
  };
  const blockTags = new Set([
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'li',
    'blockquote',
    'pre',
    'tr',
  ]);
  const walk = (node: Element) => {
    let pending = '';
    const flush = () => {
      add(pending, 'p');
      pending = '';
    };
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        pending += child.textContent;
        continue;
      }
      if (!(child instanceof Element)) continue;
      const tag = child.localName.toLowerCase();
      if (blockTags.has(tag)) {
        flush();
        if (tag === 'tr')
          add(
            Array.from(child.children)
              .map((c) => c.textContent)
              .join(' | '),
            tag,
          );
        else add(child.textContent || '', tag);
      } else if (
        [
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
        ].includes(tag)
      ) {
        flush();
        walk(child);
      } else pending += tag === 'br' ? '\n' : child.textContent || '';
    }
    flush();
  };
  walk(body);
  return paragraphs;
}

type ImportLabels = {
  unknownAuthor: string;
  section: (number: number) => string;
  chapter: (number: number) => string;
};
export async function importBook(
  file: File,
  labels: ImportLabels = {
    unknownAuthor: 'Unknown author',
    section: (number) => `Section ${number}`,
    chapter: (number) => `Chapter ${number}`,
  },
): Promise<Book> {
  if (file.size > MAX_FILE) throw new Error('文件超过 30 MB，请选择较小的 EPUB 或 TXT。');
  if (!/\.(epub|txt)$/i.test(file.name))
    throw new Error('目前支持无 DRM 的 EPUB 和 UTF-8 TXT 文件。');
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const id = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (/\.txt$/i.test(file.name)) {
    let value: string;
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new Error('TXT 编码不是 UTF-8，请先将文件转换为 UTF-8 后再导入。');
    }
    const blocks = value
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const paras = blocks.flatMap((p) => p.match(/[\s\S]{1,2400}(?:\s|$)|[\s\S]{1,2400}/gu) || []);
    const chapters: Chapter[] = [];
    for (let start = 0; start < paras.length; start += 60) {
      const i = chapters.length;
      chapters.push({
        id: `chapter-${i}`,
        title: labels.section(i + 1),
        paragraphs: paras
          .slice(start, start + 60)
          .map((p, j) => ({ id: `${i + 1}.${j + 1}`, text: p.trim(), kind: 'text' })),
      });
    }
    if (!chapters.length) throw new Error('文件没有可阅读的文字。');
    return validateBook({
      id,
      title: file.name.replace(/\.txt$/i, ''),
      author: labels.unknownAuthor,
      language: 'auto',
      importedAt: Date.now(),
      chapters,
    });
  }
  let total = 0;
  let tooLarge = false;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      {
        filter(entry) {
          if (!/\.(xml|opf|xhtml|html|htm)$/i.test(entry.name)) return false;
          total += entry.originalSize;
          if (entry.originalSize > MAX_ENTRY || total > MAX_TEXT) {
            tooLarge = true;
            return false;
          }
          return true;
        },
      },
      (error, result) =>
        error ? reject(new Error('无法解压 EPUB，请确认文件完整且未加密。')) : resolve(result),
    );
  });
  if (tooLarge) throw new Error('EPUB 解压后的文字过大，单章节需小于 4 MB，全部文字小于 20 MB。');
  const read = (path: string) => {
    if (!files[path]) throw new Error(`EPUB 缺少必要文件：${path.slice(0, 150)}`);
    return strFromU8(files[path]);
  };
  const container = xml(read('META-INF/container.xml'));
  const packagePath = descendants(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!packagePath) throw new Error('找不到 EPUB 内容目录。');
  const packageDoc = xml(read(packagePath));
  const directory = packagePath.includes('/')
    ? packagePath.slice(0, packagePath.lastIndexOf('/'))
    : '';
  const manifest = new Map(
    descendants(packageDoc, 'item').map((el) => [el.getAttribute('id'), el]),
  );
  const chapters: Chapter[] = [];
  for (const item of descendants(packageDoc, 'itemref')) {
    if (item.getAttribute('linear') === 'no') continue;
    const entry = manifest.get(item.getAttribute('idref'));
    if (!entry) throw new Error('EPUB 章节索引损坏。');
    if (entry.getAttribute('properties')?.split(/\s+/).includes('nav')) continue;
    const href = entry.getAttribute('href');
    if (!href) continue;
    const path = normalizePath(directory, href);
    const paragraphs = paragraphize(read(path), chapters.length);
    if (!paragraphs.length) continue;
    const heading = paragraphs.find((p) => p.kind === 'heading');
    chapters.push({
      id: `chapter-${chapters.length}`,
      title: heading?.text.slice(0, 160) || labels.chapter(chapters.length + 1),
      paragraphs,
    });
  }
  if (!chapters.length)
    throw new Error('没有找到可读取的文字章节；暂不支持 DRM、扫描版和纯图片书籍。');
  // Decode only the declared cover, never remote image URLs or executable SVG.
  let cover: string | undefined;
  const coverId = descendants(packageDoc, 'meta')
    .find((el) => el.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const coverItem =
    [...manifest.values()].find((el) =>
      el.getAttribute('properties')?.split(/\s+/).includes('cover-image'),
    ) || (coverId ? manifest.get(coverId) : undefined);
  const coverHref = coverItem?.getAttribute('href');
  const mime = coverItem?.getAttribute('media-type');
  if (coverHref && mime && ['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    try {
      const coverPath = normalizePath(directory, coverHref);
      const images = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(
          new Uint8Array(buffer),
          { filter: (entry) => entry.name === coverPath && entry.originalSize <= 2 * 1024 * 1024 },
          (error, result) => (error ? reject(error) : resolve(result)),
        );
      });
      const bytes = images[coverPath];
      if (bytes?.length && bytes.length <= 2 * 1024 * 1024) {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        cover = `data:${mime};base64,${btoa(binary)}`;
      }
    } catch {
      /* An unavailable cover must not discard readable chapters. */
    }
  }
  const rawDescription = text(packageDoc, 'description');
  const description = rawDescription
    ? new DOMParser()
        .parseFromString(rawDescription, 'text/html')
        .body.textContent?.trim()
        .slice(0, 20000)
    : undefined;
  return validateBook({
    id,
    title: text(packageDoc, 'title') || file.name.replace(/\.epub$/i, ''),
    author: text(packageDoc, 'creator') || labels.unknownAuthor,
    language: text(packageDoc, 'language') || 'auto',
    pageDirection:
      descendants(packageDoc, 'spine')[0]?.getAttribute('page-progression-direction') === 'rtl'
        ? 'rtl'
        : 'ltr',
    chapters,
    importedAt: Date.now(),
    cover,
    description,
    category: text(packageDoc, 'subject').slice(0, 200) || undefined,
  });
}
