import {
  paragraphsFromMarkup,
  bookFromText,
  epubNavigation,
  createMarkupMediaCollection,
  createMarkupReferenceCollection,
  createEpubReferences,
  resolveEpubReference,
  type MarkupReferenceCollection,
  type EpubReferenceSource,
  type EpubReferenceDocument,
  createEpubMedia,
  resolveEpubImagePath,
  MAX_BOOK_IMAGE_BYTES,
  MAX_BOOK_MEDIA_BYTES,
  MAX_BOOK_MEDIA_ASSETS,
  type MarkupMediaCollection,
  type EpubMediaSource,
  type EpubChapterTarget,
  type EpubNavigationDocument,
} from '../../packages/reading-core/src';
import { strFromU8, unzip, type UnzipFileFilter } from 'fflate';
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

function paragraphize(
  value: string,
  chapterIndex: number,
  anchors: Map<string, string>,
  media: MarkupMediaCollection,
  references: MarkupReferenceCollection,
): { paragraphs: Paragraph[]; document: Document } {
  const doc = new DOMParser().parseFromString(value, 'application/xhtml+xml');
  if (doc.querySelector('parsererror'))
    throw new Error('EPUB 章节不是有效的 XHTML，暂时无法导入。');
  const body = descendants(doc, 'body')[0] || doc.documentElement;
  return {
    paragraphs: paragraphsFromMarkup(body, chapterIndex, anchors, media, references),
    document: doc,
  };
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
    return bookFromText(value, {
      id,
      title: file.name.replace(/\.txt$/i, ''),
      author: labels.unknownAuthor,
      section: labels.section,
    });
  }
  let total = 0;
  let tooLarge = false;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      new Uint8Array(buffer),
      {
        filter(entry) {
          if (!/\.(xml|opf|ncx|xhtml|html|htm)$/i.test(entry.name)) return false;
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
  const targets: EpubChapterTarget[] = [];
  const mediaSources: EpubMediaSource[] = [];
  const referenceSources: EpubReferenceSource[] = [];
  const referenceDocuments: EpubReferenceDocument[] = [];
  for (const item of descendants(packageDoc, 'itemref')) {
    if (item.getAttribute('linear') === 'no') continue;
    const entry = manifest.get(item.getAttribute('idref'));
    if (!entry) throw new Error('EPUB 章节索引损坏。');
    if (entry.getAttribute('properties')?.split(/\s+/).includes('nav')) continue;
    const href = entry.getAttribute('href');
    if (!href) continue;
    const path = normalizePath(directory, href);
    const anchors = new Map<string, string>();
    const collection = createMarkupMediaCollection();
    const referenceCollection = createMarkupReferenceCollection();
    const { paragraphs, document } = paragraphize(
      read(path),
      chapters.length,
      anchors,
      collection,
      referenceCollection,
    );
    referenceDocuments.push({ path, document });
    if (!paragraphs.length) {
      mediaSources.push({ path, collection });
      continue;
    }
    const heading = paragraphs.find((p) => p.kind === 'heading');
    const chapter: Chapter = {
      id: `chapter-${chapters.length}`,
      title: heading?.text.slice(0, 160) || labels.chapter(chapters.length + 1),
      paragraphs,
    };
    chapters.push(chapter);
    mediaSources.push({ path, chapterId: chapter.id, collection });
    targets.push({ path, chapter, anchors });
    referenceSources.push({ path, chapterId: chapter.id, collection: referenceCollection });
  }
  if (!chapters.length)
    throw new Error('没有找到可读取的文字章节；暂不支持 DRM、扫描版和纯图片书籍。');
  const navigationDocuments: EpubNavigationDocument[] = [];
  for (const entry of manifest.values()) {
    const kind = entry.getAttribute('properties')?.split(/\s+/).includes('nav')
      ? 'nav'
      : entry.getAttribute('media-type') === 'application/x-dtbncx+xml'
        ? 'ncx'
        : null;
    const href = entry.getAttribute('href');
    if (!kind || !href) continue;
    try {
      const path = normalizePath(directory, href);
      navigationDocuments.push({ path, document: xml(read(path)), kind });
    } catch {
      /* A broken optional table of contents must not discard readable text. */
    }
  }
  const navigation = epubNavigation(navigationDocuments, targets);
  for (const chapter of chapters) {
    const title = navigation.chapterTitles.get(chapter.id);
    if (title && !chapter.paragraphs.some((paragraph) => paragraph.kind === 'heading'))
      chapter.title = title.slice(0, 160);
  }
  const referencePaths = new Set(
    referenceSources.flatMap((source) =>
      source.collection.links
        .map((link) => resolveEpubReference(source.path, link.href)?.path)
        .filter((path): path is string => !!path),
    ),
  );
  for (const entry of manifest.values()) {
    if (!['application/xhtml+xml', 'text/html'].includes(entry.getAttribute('media-type') || ''))
      continue;
    try {
      const path = normalizePath(directory, entry.getAttribute('href') || '');
      if (!referencePaths.has(path) || referenceDocuments.some((doc) => doc.path === path))
        continue;
      const document = new DOMParser().parseFromString(read(path), 'application/xhtml+xml');
      if (!document.querySelector('parsererror')) referenceDocuments.push({ path, document });
    } catch {
      /* Optional targets are reported by the resolver; keep readable spine text. */
    }
  }
  const references = createEpubReferences({
    chapters,
    sources: referenceSources,
    documents: referenceDocuments,
  });
  // Inflate only referenced raster assets, with limits applied before decompression.
  const imagePaths = new Set(
    mediaSources.flatMap(({ path, collection }) =>
      collection.images
        .map((image) => resolveEpubImagePath(path, image.source))
        .filter((value): value is string => !!value),
    ),
  );
  const oversizedImages = new Set<string>();
  const selectedImages = new Set<string>();
  const seenImageEntries = new Set<string>();
  let imageBytes = 0;
  let imageCount = 0;
  const unzipImages = (filter: UnzipFileFilter) =>
    new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      let terminate: (() => void) | undefined;
      terminate = unzip(new Uint8Array(buffer), { filter }, (error, result) => {
        if (error) {
          terminate?.();
          reject(error);
        } else resolve(result);
      });
    });
  let imageFiles: Record<string, Uint8Array>;
  try {
    imageFiles = await unzipImages((entry) => {
      if (!imagePaths.has(entry.name) || seenImageEntries.has(entry.name)) return false;
      seenImageEntries.add(entry.name);
      if (
        entry.originalSize > MAX_BOOK_IMAGE_BYTES ||
        imageBytes + entry.originalSize > MAX_BOOK_MEDIA_BYTES ||
        imageCount >= MAX_BOOK_MEDIA_ASSETS
      ) {
        oversizedImages.add(entry.name);
        return false;
      }
      imageBytes += entry.originalSize;
      imageCount++;
      selectedImages.add(entry.name);
      return true;
    });
  } catch {
    // A damaged optional image must not discard readable text or the other
    // illustrations. Retry only the already budgeted entries, one at a time.
    imageFiles = Object.create(null);
    let recoveredBytes = 0;
    for (const path of selectedImages) {
      let found = false;
      try {
        const recovered = await unzipImages((entry) => {
          if (entry.name !== path || found) return false;
          found = true;
          return entry.originalSize <= MAX_BOOK_IMAGE_BYTES;
        });
        const bytes = recovered[path];
        if (!bytes) continue;
        if (
          bytes.length > MAX_BOOK_IMAGE_BYTES ||
          recoveredBytes + bytes.length > MAX_BOOK_MEDIA_BYTES
        ) {
          oversizedImages.add(path);
          continue;
        }
        imageFiles[path] = bytes;
        recoveredBytes += bytes.length;
      } catch {
        // createEpubMedia counts the unavailable reference in its diagnostics.
      }
    }
  }
  const media = await createEpubMedia({
    chapters,
    sources: mediaSources,
    readFile: (path) => (oversizedImages.has(path) ? 'too-large' : imageFiles[path] || null),
  });
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
    ...(navigation.toc.length ? { toc: navigation.toc } : {}),
    sourceFormat: 'epub',
    ...(media ? { media } : {}),
    references,
    importedAt: Date.now(),
    cover,
    description,
    category: text(packageDoc, 'subject').slice(0, 200) || undefined,
  });
}
