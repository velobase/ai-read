import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { DOMParser } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import {
  bookFromText,
  paragraphsFromMarkup,
  epubNavigation,
  createMarkupMediaCollection,
  createMarkupReferenceCollection,
  createEpubReferences,
  resolveEpubReference,
  type EpubReferenceSource,
  type EpubReferenceDocument,
  createEpubMedia,
  validateBook,
  validatePortableLibrary,
  type Book,
  type Chapter,
  type Paragraph,
  type PortableLibrary,
  type EpubChapterTarget,
  type EpubNavigationDocument,
  type EpubMediaSource,
} from '@bypage/reading-core';
import { addBook, importLibrary, exportLibrary } from './database';
import { measured, diagnosticSnapshot } from './diagnostics';
import { createLibraryLease, deviceLibrary, type LibraryLease } from './library-scope';
import { accountRevision } from './account';
import {
  restoreLibraryRecoveryArchive,
  validateLibraryRecoveryArchive,
  type ValidatedLibraryRecoveryArchive,
  type RecoveryRestoreResult,
} from './library-recovery-restore';

const MAX_FILE = 30 * 1024 * 1024;
const MAX_BACKUP = 50 * 1024 * 1024;
const elements = (node: Document | Element, name: string) =>
  Array.from(node.getElementsByTagNameNS('*', name));
function xml(value: string) {
  if (/<!DOCTYPE[^>]*\[/i.test(value) || /<!ENTITY/i.test(value))
    throw new Error('Unsupported XML entities');
  let failed = false;
  const doc = new DOMParser({
    errorHandler: {
      warning() {},
      error() {
        failed = true;
      },
      fatalError() {
        failed = true;
      },
    },
  }).parseFromString(value, 'application/xml');
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
async function parseEpub(
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

export type PendingImport = { readonly library: LibraryLease } & (
  | { kind: 'book'; book: Book }
  | { kind: 'library'; pack: PortableLibrary }
  | { kind: 'recovery'; archive: ValidatedLibraryRecoveryArchive }
);
export type ImportLabels = {
  unknown: string;
  chapter: (n: number) => string;
};
export type PreparedPdfImport = {
  kind: 'pdf';
  readonly library: LibraryLease;
  uri: string;
  name: string;
};
export type PreparedImport = PendingImport | PreparedPdfImport;

/**
 * Parse a caller-owned local file without changing the library or removing its source.
 * PDF previews own a separate cache copy; PdfImportSheet releases it on completion.
 */
export async function prepareImport(
  lease: LibraryLease,
  source: { uri: string; name: string },
  labels: ImportLabels,
): Promise<PreparedImport> {
  lease.assertCurrent();
  const file = new File(source.uri);
  const limit = /\.json$/i.test(source.name) ? MAX_BACKUP : MAX_FILE;
  if (!file.exists || file.size > limit || !/\.(epub|txt|json|pdf)$/i.test(source.name))
    throw new Error('Unsupported file');
  if (/\.pdf$/i.test(source.name)) {
    const size = file.size;
    const preview = new File(Paths.cache, `bypage-prepare-${Crypto.randomUUID()}.pdf`);
    // Never replace an existing cache file, even if a generated name collides.
    if (preview.exists) throw new Error('PDF preview already exists');
    try {
      await file.copy(preview);
      lease.assertCurrent();
      if (!preview.exists || preview.size !== size || preview.size > MAX_FILE)
        throw new Error('Incomplete PDF preview');
      return { kind: 'pdf', library: lease, uri: preview.uri, name: source.name };
    } catch (error) {
      try {
        if (preview.exists) preview.delete();
      } catch {
        /* The OS can clear our temporary copy later. The caller still owns the source. */
      }
      throw error;
    }
  }
  if (/\.json$/i.test(source.name)) {
    const body = await file.text();
    lease.assertCurrent();
    const raw: unknown = JSON.parse(body);
    if (
      raw &&
      typeof raw === 'object' &&
      'format' in raw &&
      raw.format === 'bypage-library-recovery'
    )
      return { kind: 'recovery', library: lease, archive: validateLibraryRecoveryArchive(raw) };
    return { kind: 'library', library: lease, pack: validatePortableLibrary(raw) };
  }
  const bytes = await file.bytes();
  lease.assertCurrent();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  lease.assertCurrent();
  const id = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const book = /\.txt$/i.test(source.name)
    ? bookFromText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
        id,
        title: source.name.replace(/\.txt$/i, ''),
        author: labels.unknown,
        section: labels.chapter,
      })
    : await parseEpub(bytes, id, source.name, labels.chapter, labels.unknown);
  lease.assertCurrent();
  return { kind: 'book', library: lease, book };
}

/** Reading is staged before any library mutation, allowing an explicit import preview. */
export async function chooseImport(
  lease: LibraryLease,
  labels: ImportLabels,
): Promise<PreparedImport | null> {
  lease.assertCurrent();
  const selection = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'application/epub+zip',
      'text/plain',
      'application/json',
      'public.data',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (selection.canceled) {
    lease.assertCurrent();
    return null;
  }
  const asset = selection.assets[0];
  const file = new File(asset.uri);
  try {
    lease.assertCurrent();
    return await prepareImport(lease, { uri: file.uri, name: asset.name }, labels);
  } finally {
    // Only remove the picker-created cache copy; never the user's original document.
    if (file.uri.startsWith(Paths.cache.uri)) {
      try {
        file.delete();
      } catch {
        /* OS can clear cache. */
      }
    }
  }
}
export async function confirmImport(
  lease: LibraryLease,
  pending: PendingImport,
): Promise<{ count: number; recovery?: RecoveryRestoreResult }> {
  return measured('book.import', async () => {
    lease.assertCurrent();
    if (pending.library !== lease) throw new Error('library_scope_mismatch');
    if (pending.kind === 'recovery') {
      // The preview explicitly names the device destination. Its lifetime is still
      // fenced by the screen that initiated the import, including account changes.
      const revision = accountRevision();
      const destination = createLibraryLease(
        deviceLibrary,
        lease.epoch,
        lease.signal,
        () => lease.isCurrent() && revision === accountRevision(),
      );
      const recovery = await restoreLibraryRecoveryArchive(destination, pending.archive);
      destination.assertCurrent();
      return { count: 1, recovery };
    }
    if (pending.kind === 'book') {
      await addBook(lease.handle, pending.book);
      lease.assertCurrent();
      return { count: 1 };
    }
    const count = await importLibrary(lease.handle, pending.pack);
    lease.assertCurrent();
    return { count };
  });
}
async function shareJSON(value: unknown, name: string, lease?: LibraryLease) {
  lease?.assertCurrent();
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable');
  lease?.assertCurrent();
  const file = new File(Paths.cache, `${name}-${Crypto.randomUUID()}.json`);
  try {
    file.create();
    const body = JSON.stringify(value);
    if (new TextEncoder().encode(body).byteLength > MAX_BACKUP) throw new Error('Export too large');
    file.write(body);
    lease?.assertCurrent();
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'LeafRead',
    });
    lease?.assertCurrent();
  } finally {
    if (file.exists) file.delete();
  }
}
export const shareLibrary = (lease: LibraryLease, bookId?: string) =>
  measured('backup.export', async () => {
    lease.assertCurrent();
    const pack = await exportLibrary(lease.handle, bookId);
    lease.assertCurrent();
    await shareJSON(pack, 'LeafRead-reading-pack', lease);
  });
export const shareDiagnostics = () => shareJSON(diagnosticSnapshot(), 'LeafRead-diagnostics');
