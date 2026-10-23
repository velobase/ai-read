import { DOMParser } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import {
  paragraphsFromMarkup,
  createMarkupMediaCollection,
  createMarkupReferenceCollection,
} from './import-markup';
import {
  epubNavigation,
  type EpubChapterTarget,
  type EpubNavigationDocument,
} from './epub-navigation';
import { createEpubMedia, type EpubMediaSource } from './book-media';
import {
  createEpubReferences,
  resolveEpubReference,
  type EpubReferenceSource,
  type EpubReferenceDocument,
} from './book-references';
import { validateBook } from './reading-backup';
import type { Chapter } from './types';
const elements = (node: Document | Element, name: string) =>
  Array.from(node.getElementsByTagNameNS('*', name));
function xml(value: string) {
  if (/<!DOCTYPE[^>]*\[/i.test(value) || /<!ENTITY/i.test(value))
    throw new Error('Unsupported XML entities');
  let failed = false;
  const doc = new DOMParser({
    onError(level, message) {
      console.error('epub.xml', { level, message });
      if (level !== 'warning') failed = true;
    },
  }).parseFromString(value, 'application/xml') as unknown as Document;
  if (failed) throw new Error('Invalid EPUB XML');
  return doc;
}
function pathFor(base: string, href: string) {
  let decoded = href.split('#')[0];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* Some books contain unescaped percent signs. */
  }
  if (/^[a-z]+:/i.test(decoded) || decoded.startsWith('/') || decoded.includes('\\'))
    throw new Error('Unsupported EPUB path');
  const parts = base ? base.split('/') : [];
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('Invalid EPUB path');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export async function parseEpub(
  bytes: Uint8Array,
  id: string,
  name: string,
  label: (n: number) => string,
  unknown: string,
) {
  let total = 0;
  let oversized = false;
  const files = unzipSync(bytes, {
    filter(entry) {
      if (!/\.(xml|opf|ncx|html|xhtml|htm)$/i.test(entry.name)) return false;
      total += entry.originalSize;
      if (entry.originalSize > 4 * 1024 * 1024 || total > 20 * 1024 * 1024) {
        oversized = true;
        return false;
      }
      return true;
    },
  });
  if (oversized) throw new Error('EPUB too large');
  const read = (path: string) => {
    if (!files[path]) throw new Error('Missing EPUB content');
    return xml(strFromU8(files[path]));
  };
  const packagePath = elements(read('META-INF/container.xml'), 'rootfile')[0]?.getAttribute(
    'full-path',
  );
  if (!packagePath) throw new Error('Missing EPUB package');
  const opf = read(packagePath);
  const base = packagePath.slice(0, Math.max(0, packagePath.lastIndexOf('/')));
  const manifest = new Map(elements(opf, 'item').map((item) => [item.getAttribute('id'), item]));
  const chapters: Chapter[] = [];
  const targets: EpubChapterTarget[] = [];
  const mediaSources: EpubMediaSource[] = [];
  const referenceSources: EpubReferenceSource[] = [];
  const referenceDocuments: EpubReferenceDocument[] = [];
  for (const item of elements(opf, 'itemref')) {
    if (item.getAttribute('linear') === 'no') continue;
    const entry = manifest.get(item.getAttribute('idref'));
    if (!entry) throw new Error('Invalid EPUB spine');
    if (entry.getAttribute('properties')?.split(/\s+/).includes('nav')) continue;
    const href = entry.getAttribute('href');
    if (!href) continue;
    const path = pathFor(base, href);
    const doc = read(path);
    const body = elements(doc, 'body')[0] || doc.documentElement;
    const anchors = new Map<string, string>();
    const collection = createMarkupMediaCollection();
    const referenceCollection = createMarkupReferenceCollection();
    const paragraphs = paragraphsFromMarkup(
      body,
      chapters.length,
      anchors,
      collection,
      referenceCollection,
    );
    referenceDocuments.push({ path, document: doc });
    const source: EpubMediaSource = { path, collection };
    mediaSources.push(source);
    if (paragraphs.length) {
      const chapter: Chapter = {
        id: `chapter-${chapters.length}`,
        title:
          paragraphs.find((p) => p.kind === 'heading')?.text.slice(0, 160) ||
          label(chapters.length + 1),
        paragraphs,
      };
      chapters.push(chapter);
      source.chapterId = chapter.id;
      targets.push({ path, chapter, anchors });
      referenceSources.push({ path, chapterId: chapter.id, collection: referenceCollection });
    }
  }
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
      const path = pathFor(base, href);
      navigationDocuments.push({ path, document: read(path), kind });
    } catch {
      /* Keep readable chapters when an optional navigation document is malformed. */
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
      const path = pathFor(base, entry.getAttribute('href') || '');
      if (referencePaths.has(path) && !referenceDocuments.some((doc) => doc.path === path))
        referenceDocuments.push({ path, document: read(path) });
    } catch {
      /* Missing or invalid optional targets are diagnosed without changing spine text. */
    }
  }
  const references = createEpubReferences({
    chapters,
    sources: referenceSources,
    documents: referenceDocuments,
  });
  const metadata = (tag: string) => elements(opf, tag)[0]?.textContent?.trim() || '';
  let cover: string | undefined;
  const coverId = elements(opf, 'meta')
    .find((item) => item.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const coverItem =
    [...manifest.values()].find((item) =>
      item.getAttribute('properties')?.split(/\s+/).includes('cover-image'),
    ) || (coverId ? manifest.get(coverId) : undefined);
  const coverHref = coverItem?.getAttribute('href'),
    mime = coverItem?.getAttribute('media-type');
  if (coverHref && mime && ['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
    try {
      const path = pathFor(base, coverHref);
      const image = unzipSync(bytes, {
        filter: (entry) => entry.name === path && entry.originalSize <= 2 * 1024 * 1024,
      })[path];
      if (image?.length && image.length <= 2 * 1024 * 1024) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const parts: string[] = [];
        for (let offset = 0; offset < image.length; offset += 12288) {
          let piece = '';
          for (let i = offset; i < Math.min(image.length, offset + 12288); i += 3) {
            const a = image[i],
              b = image[i + 1],
              c = image[i + 2];
            piece +=
              alphabet[a >> 2] +
              alphabet[((a & 3) << 4) | ((b || 0) >> 4)] +
              (i + 1 < image.length ? alphabet[((b & 15) << 2) | ((c || 0) >> 6)] : '=') +
              (i + 2 < image.length ? alphabet[c & 63] : '=');
          }
          parts.push(piece);
        }
        cover = `data:${mime};base64,${parts.join('')}`;
      }
    } catch {
      /* An unreadable cover does not discard readable chapters. */
    }
  }

  const media = await createEpubMedia({
    chapters,
    sources: mediaSources,
    readFile(path, maxBytes) {
      let tooLarge = false;
      const image = unzipSync(bytes, {
        filter(entry) {
          if (entry.name !== path) return false;
          if (entry.originalSize > maxBytes) {
            tooLarge = true;
            return false;
          }
          return true;
        },
      })[path];
      return tooLarge ? 'too-large' : image || null;
    },
  });
  return validateBook({
    id,
    cover,
    description:
      metadata('description')
        .replace(/<[^>]*>/g, ' ')
        .trim()
        .slice(0, 20000) || undefined,
    category: metadata('subject').slice(0, 200) || undefined,
    title: metadata('title') || name.replace(/\.epub$/i, ''),
    author: metadata('creator') || unknown,
    language: metadata('language') || 'auto',
    chapters,
    media,
    references,
    ...(navigation.toc.length ? { toc: navigation.toc } : {}),
    sourceFormat: 'epub',
    importedAt: Date.now(),
    pageDirection:
      elements(opf, 'spine')[0]?.getAttribute('page-progression-direction') === 'rtl'
        ? 'rtl'
        : 'ltr',
  });
}
