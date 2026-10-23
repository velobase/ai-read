import type {
  Book,
  BookMedia,
  BookMediaAsset,
  BookMediaDiagnostics,
  BookMediaPlacement,
  Chapter,
} from './types';
import {
  createMarkupMediaCollection,
  sameBookContent,
  type MarkupMediaCollection,
} from './import-markup';

export const MAX_BOOK_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_BOOK_MEDIA_BYTES = 12 * 1024 * 1024;
export const MAX_BACKUP_MEDIA_BYTES = 24 * 1024 * 1024;
export const MAX_BOOK_MEDIA_ASSETS = 256;
export const MAX_BOOK_MEDIA_PLACEMENTS = 2000;
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 16000000;
const diagnosticKeys = [
  'skippedInline',
  'skippedUnsupported',
  'skippedUnsafePath',
  'skippedMissing',
  'skippedInvalid',
  'skippedLimit',
  'skippedUnanchored',
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const hexDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = (): never => {
  throw new Error('Invalid book images');
};

/** Resolve only ZIP-local references; never pass a URL to a host image loader. */
export function resolveEpubImagePath(documentPath: string, reference: string): string | null {
  if (!reference || reference.length > 2048 || documentPath.length > 2048) return null;
  let path = reference.trim().split(/[?#]/, 1)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep literal percent signs in old EPUBs. */
  }
  if (
    !path ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.startsWith('/') ||
    /[\\\u0000-\u001f\u007f]/.test(path)
  )
    return null;
  if (!documentPath || documentPath.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(documentPath))
    return null;
  const parts = documentPath.split('/').slice(0, -1);
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':')))
    return null;
  for (const part of path.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

// FIPS 180-4 SHA-256, kept platform-independent because backup validation is synchronous.
// The state is eight 32-bit words; only the final partial block is allocated.
const shaConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256(bytes: Uint8Array): string {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const fullLength = bytes.length - (bytes.length % 64);
  const tail = new Uint8Array(bytes.length - fullLength < 56 ? 64 : 128);
  tail.set(bytes.subarray(fullLength));
  tail[bytes.length - fullLength] = 0x80;
  const view = new DataView(tail.buffer);
  view.setUint32(tail.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(tail.length - 4, (bytes.length * 8) >>> 0);
  const rotate = (value: number, count: number) => (value >>> count) | (value << (32 - count));
  for (let offset = 0; offset < fullLength + tail.length; offset += 64) {
    const block =
      offset < fullLength
        ? bytes.subarray(offset, offset + 64)
        : tail.subarray(offset - fullLength, offset - fullLength + 64);
    for (let i = 0; i < 16; i++) {
      const at = i * 4;
      words[i] = (block[at] << 24) | (block[at + 1] << 16) | (block[at + 2] << 8) | block[at + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15],
        y = words[i - 2];
      words[i] =
        words[i - 16] +
        (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
        words[i - 7] +
        (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const first =
        h +
        (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
        ((e & f) ^ (~e & g)) +
        shaConstants[i] +
        words[i];
      const second = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) state[i] += next[i];
  }
  return Array.from(state, (value) => value.toString(16).padStart(8, '0')).join('');
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 12288) {
    let part = '';
    for (let i = offset; i < Math.min(bytes.length, offset + 12288); i += 3) {
      const a = bytes[i],
        b = bytes[i + 1] || 0,
        c = bytes[i + 2] || 0;
      part +=
        alphabet[a >> 2] +
        alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
        (i + 2 < bytes.length ? alphabet[c & 63] : '=');
    }
    parts.push(part);
  }
  return parts.join('');
}
function decodeBase64(value: string, byteLength: number): Uint8Array {
  if (
    !value ||
    value.length !== Math.ceil(byteLength / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return invalid();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if ((value.length / 4) * 3 - padding !== byteLength) return invalid();
  const last = alphabet.indexOf(value[value.length - padding - 1]);
  if ((padding === 2 && last & 15) || (padding === 1 && last & 3)) return invalid();
  const bytes = new Uint8Array(byteLength);
  for (let i = 0, at = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]),
      b = alphabet.indexOf(value[i + 1]);
    const c = Math.max(0, alphabet.indexOf(value[i + 2])),
      d = Math.max(0, alphabet.indexOf(value[i + 3]));
    bytes[at++] = (a << 2) | (b >> 4);
    if (at < byteLength) bytes[at++] = (b << 4) | (c >> 2);
    if (at < byteLength) bytes[at++] = (c << 6) | d;
  }
  return bytes;
}
const dimensionsAllowed = (width: number, height: number) =>
  width > 0 &&
  height > 0 &&
  width <= MAX_IMAGE_EDGE &&
  height <= MAX_IMAGE_EDGE &&
  width * height <= MAX_IMAGE_PIXELS;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function pngCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let at = start; at < end; at++) crc = crcTable[(crc ^ bytes[at]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
type ImageInfo = Pick<BookMediaAsset, 'mimeType' | 'width' | 'height'>;
/** Checks encoded structure and decode bounds, without running a raster decoder. */
export function inspectBookImage(bytes: Uint8Array): ImageInfo | null {
  if (!bytes.length || bytes.length > MAX_BOOK_IMAGE_BYTES) return null;
  if (pngSignature.every((value, i) => bytes[i] === value)) {
    if (bytes.length < 45) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return null;
    const width = view.getUint32(16),
      height = view.getUint32(20),
      depth = bytes[24],
      color = bytes[25];
    const allowedDepths: Record<number, number[]> = {
      0: [1, 2, 4, 8, 16],
      2: [8, 16],
      3: [1, 2, 4, 8],
      4: [8, 16],
      6: [8, 16],
    };
    if (
      !dimensionsAllowed(width, height) ||
      !allowedDepths[color]?.includes(depth) ||
      bytes[26] !== 0 ||
      bytes[27] !== 0 ||
      bytes[28] > 1
    )
      return null;
    let data = false,
      palette = false;
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = view.getUint32(at),
        type = view.getUint32(at + 4);
      if (size > bytes.length - at - 12) return null;
      if (pngCrc(bytes, at + 4, at + 8 + size) !== view.getUint32(at + 8 + size)) return null;
      if (type === 0x49484452 && at !== 8) return null;
      if (type === 0x504c5445) palette = size > 0 && size <= 768 && size % 3 === 0;
      if (type === 0x49444154) data ||= size > 0;
      // Animated PNG needs a separate frame-count / total pixel budget.
      if (type === 0x6163544c) return null;
      if (type === 0x49454e44)
        return size === 0 && at + 12 === bytes.length && data && (color !== 3 || palette)
          ? { mimeType: 'image/png', width, height }
          : null;
      if (!(bytes[at + 4] & 32) && ![0x49484452, 0x504c5445, 0x49444154].includes(type))
        return null;
      at += size + 12;
    }
    return null;
  }
  // Some EPUB producers pad JPEG files to a word boundary after EOI. Permit
  // bounded NUL padding, keeping the original bytes and content hash intact.
  let jpegEnd = bytes.length;
  while (jpegEnd > 0 && bytes[jpegEnd - 1] === 0 && bytes.length - jpegEnd < 16) jpegEnd--;
  if (
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[jpegEnd - 2] !== 0xff ||
    bytes[jpegEnd - 1] !== 0xd9
  )
    return null;
  let info: ImageInfo | null = null;
  for (let at = 2; at < jpegEnd - 2;) {
    if (bytes[at++] !== 0xff) return null;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > jpegEnd) return null;
    const size = bytes[at] * 256 + bytes[at + 1];
    if (size < 2 || size > jpegEnd - at) return null;
    if (marker === 0xda) return info && size >= 6 ? info : null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      // Common baseline / extended sequential / progressive 8-bit JPEG only.
      if (![0xc0, 0xc1, 0xc2].includes(marker) || size < 11 || bytes[at + 2] !== 8 || info)
        return null;
      const height = bytes[at + 3] * 256 + bytes[at + 4],
        width = bytes[at + 5] * 256 + bytes[at + 6];
      const components = bytes[at + 7];
      if (
        ![1, 3, 4].includes(components) ||
        size !== 8 + 3 * components ||
        !dimensionsAllowed(width, height)
      )
        return null;
      info = { mimeType: 'image/jpeg', width, height };
    }
    at += size;
  }
  return null;
}
export function utf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    let code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 128) bytes.push(code);
    else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
    else if (code < 65536)
      bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
    else
      bytes.push(
        240 | (code >> 18),
        128 | ((code >> 12) & 63),
        128 | ((code >> 6) & 63),
        128 | (code & 63),
      );
  }
  return new Uint8Array(bytes);
}
function revisionOf(media: Omit<BookMedia, 'revision'>): string {
  return sha256(
    utf8(
      JSON.stringify([
        media.version,
        media.assets.map((asset) => [
          asset.id,
          asset.mimeType,
          asset.byteLength,
          asset.width,
          asset.height,
        ]),
        media.placements.map((p) => [
          p.id,
          p.assetId,
          p.chapterId,
          p.paragraphId,
          p.position,
          p.alt || '',
        ]),
        diagnosticKeys.map((key) => media.diagnostics[key]),
      ]),
    ),
  );
}
function chapterReferences(chapters: readonly Chapter[]) {
  return new Map(
    chapters.map((chapter, index) => [
      chapter.id,
      {
        index,
        paragraphs: new Map(chapter.paragraphs.map((p, offset) => [p.id, offset])),
      },
    ]),
  );
}

/** Validate before persistence/import; reject spoofed bytes, sizes, hashes and text references. */
export function validateBookMedia(
  raw: unknown,
  chapters: readonly Chapter[],
  byteBudget = MAX_BOOK_MEDIA_BYTES,
): BookMedia {
  if (
    !object(raw) ||
    raw.version !== 1 ||
    !hexDigest(raw.revision) ||
    !Array.isArray(raw.assets) ||
    raw.assets.length > MAX_BOOK_MEDIA_ASSETS ||
    !Array.isArray(raw.placements) ||
    raw.placements.length > MAX_BOOK_MEDIA_PLACEMENTS ||
    !object(raw.diagnostics)
  )
    return invalid();
  const diagnostics = createMarkupMediaCollection().diagnostics;
  for (const key of diagnosticKeys) {
    const count = raw.diagnostics[key];
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 1000000)
      return invalid();
    diagnostics[key] = count as number;
  }
  let total = 0;
  const ids = new Set<string>();
  const assets = raw.assets.map((asset): BookMediaAsset => {
    if (
      !object(asset) ||
      !hexDigest(asset.id) ||
      ids.has(asset.id) ||
      !['image/jpeg', 'image/png'].includes(asset.mimeType as string) ||
      typeof asset.dataUri !== 'string' ||
      !Number.isSafeInteger(asset.byteLength) ||
      (asset.byteLength as number) <= 0 ||
      (asset.byteLength as number) > MAX_BOOK_IMAGE_BYTES
    )
      return invalid();
    total += asset.byteLength as number;
    if (total > Math.min(MAX_BOOK_MEDIA_BYTES, byteBudget)) return invalid();
    const prefix = `data:${asset.mimeType};base64,`;
    if (!asset.dataUri.startsWith(prefix)) return invalid();
    const bytes = decodeBase64(asset.dataUri.slice(prefix.length), asset.byteLength as number);
    const info = inspectBookImage(bytes);
    if (
      !info ||
      info.mimeType !== asset.mimeType ||
      info.width !== asset.width ||
      info.height !== asset.height ||
      sha256(bytes) !== asset.id
    )
      return invalid();
    ids.add(asset.id);
    return { id: asset.id, ...info, byteLength: bytes.length, dataUri: asset.dataUri };
  });
  const references = chapterReferences(chapters);
  if (references.size !== chapters.length) return invalid();
  const placementIds = new Set<string>(),
    usedAssets = new Set<string>();
  let lastChapter = -1,
    lastBoundary = -1;
  const placements = raw.placements.map((p): BookMediaPlacement => {
    if (
      !object(p) ||
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(p.id) ||
      placementIds.has(p.id) ||
      !ids.has(p.assetId as string) ||
      typeof p.chapterId !== 'string' ||
      typeof p.paragraphId !== 'string' ||
      !['before', 'after'].includes(p.position as string) ||
      (p.alt !== undefined && (typeof p.alt !== 'string' || p.alt.length > 1000))
    )
      return invalid();
    const chapter = references.get(p.chapterId),
      offset = chapter?.paragraphs.get(p.paragraphId);
    if (!chapter || offset === undefined) return invalid();
    const boundary = offset * 2 + (p.position === 'after' ? 1 : 0);
    if (chapter.index < lastChapter || (chapter.index === lastChapter && boundary < lastBoundary))
      return invalid();
    lastChapter = chapter.index;
    lastBoundary = boundary;
    placementIds.add(p.id);
    usedAssets.add(p.assetId as string);
    return {
      id: p.id,
      assetId: p.assetId as string,
      chapterId: p.chapterId,
      paragraphId: p.paragraphId,
      position: p.position as 'before' | 'after',
      ...(p.alt ? { alt: p.alt as string } : {}),
    };
  });
  if (usedAssets.size !== assets.length) return invalid();
  const media: BookMedia = { version: 1, revision: raw.revision, assets, placements, diagnostics };
  if (revisionOf(media) !== media.revision) return invalid();
  return media;
}

export type EpubMediaSource = {
  path: string;
  chapterId?: string;
  collection: MarkupMediaCollection;
};
export type EpubMediaOptions = {
  chapters: readonly Chapter[];
  sources: readonly EpubMediaSource[];
  /** Host must apply maxBytes before decompressing an entry, then return its actual bytes. */
  readFile: (
    path: string,
    maxBytes: number,
  ) => Promise<Uint8Array | 'too-large' | null> | Uint8Array | 'too-large' | null;
};

/** Build images from retained spine documents, without changing any chapter or paragraph. */
export async function createEpubMedia({
  chapters,
  sources,
  readFile,
}: EpubMediaOptions): Promise<BookMedia> {
  const diagnostics = createMarkupMediaCollection().diagnostics;
  const references = chapterReferences(chapters);
  const assets: BookMediaAsset[] = [],
    placements: BookMediaPlacement[] = [];
  const byId = new Map<string, BookMediaAsset>();
  type Failure = keyof BookMediaDiagnostics;
  const cache = new Map<string, BookMediaAsset | Failure>();
  let total = 0;
  for (const [sourceIndex, source] of sources.entries()) {
    for (const key of diagnosticKeys)
      diagnostics[key] = Math.min(1000000, diagnostics[key] + source.collection.diagnostics[key]);
    for (const image of source.collection.images) {
      if (
        !source.chapterId ||
        !references.get(source.chapterId)?.paragraphs.has(image.paragraphId)
      ) {
        diagnostics.skippedUnanchored++;
        continue;
      }
      if (placements.length >= MAX_BOOK_MEDIA_PLACEMENTS) {
        diagnostics.skippedLimit++;
        continue;
      }
      const path = resolveEpubImagePath(source.path, image.source);
      if (!path) {
        diagnostics.skippedUnsafePath++;
        continue;
      }
      let result = cache.get(path);
      if (!result) {
        if (assets.length >= MAX_BOOK_MEDIA_ASSETS) result = 'skippedLimit';
        else {
          let bytes: Uint8Array | 'too-large' | null;
          try {
            bytes = await readFile(path, MAX_BOOK_IMAGE_BYTES);
          } catch {
            bytes = null;
          }
          if (bytes === 'too-large' || (bytes && bytes.length > MAX_BOOK_IMAGE_BYTES))
            result = 'skippedLimit';
          else if (!bytes) result = 'skippedMissing';
          else {
            const info = inspectBookImage(bytes);
            if (!info)
              result =
                bytes[0] === 0xff || bytes[0] === 137 ? 'skippedInvalid' : 'skippedUnsupported';
            else {
              const id = sha256(bytes);
              result = byId.get(id);
              if (!result && total + bytes.length > MAX_BOOK_MEDIA_BYTES) result = 'skippedLimit';
              if (!result) {
                result = {
                  id,
                  ...info,
                  byteLength: bytes.length,
                  dataUri: `data:${info.mimeType};base64,${base64(bytes)}`,
                };
                total += bytes.length;
                assets.push(result);
                byId.set(id, result);
              }
            }
          }
        }
        cache.set(path, result);
      }
      if (typeof result === 'string') {
        diagnostics[result]++;
        continue;
      }
      placements.push({
        id: `image-${sourceIndex + 1}-${image.order}`,
        assetId: result.id,
        chapterId: source.chapterId,
        paragraphId: image.paragraphId,
        position: image.position,
        ...(image.alt ? { alt: image.alt.slice(0, 1000) } : {}),
      });
    }
  }
  // Source documents normally arrive in spine order; preserve same-boundary image order.
  placements.sort((a, b) => {
    const ca = references.get(a.chapterId)!,
      cb = references.get(b.chapterId)!;
    return (
      ca.index - cb.index ||
      ca.paragraphs.get(a.paragraphId)! * 2 +
        (a.position === 'after' ? 1 : 0) -
        (cb.paragraphs.get(b.paragraphId)! * 2 + (b.position === 'after' ? 1 : 0))
    );
  });
  for (const key of diagnosticKeys) diagnostics[key] = Math.min(1000000, diagnostics[key]);
  const media = { version: 1 as const, assets, placements, diagnostics };
  return { ...media, revision: revisionOf(media) };
}

/** A fuller parse may add images, but must retain every prior image in its exact text location. */
export function supplementBookMedia(current: Book, incoming: Book): Book {
  if (!incoming.media || current.id !== incoming.id || !sameBookContent(current, incoming))
    return current;
  if (current.media && incoming.media.placements.length <= current.media.placements.length)
    return current;
  const media = validateBookMedia(incoming.media, current.chapters);
  if (current.media) {
    const assets = new Map(media.assets.map((asset) => [asset.id, asset]));
    for (const asset of current.media.assets) {
      const next = assets.get(asset.id);
      if (
        !next ||
        next.dataUri !== asset.dataUri ||
        next.mimeType !== asset.mimeType ||
        next.byteLength !== asset.byteLength ||
        next.width !== asset.width ||
        next.height !== asset.height
      )
        return current;
    }
    const key = (p: BookMediaPlacement) =>
      JSON.stringify([p.assetId, p.chapterId, p.paragraphId, p.position, p.alt || '']);
    const previous = current.media.placements.map(key);
    let matched = 0;
    for (const placement of media.placements)
      if (matched < previous.length && key(placement) === previous[matched]) matched++;
    if (matched !== previous.length) return current;
    // Legacy accepted-count IDs were unstable when a prior parse rejected an
    // earlier image. Placement IDs have no saved reading/note references; adopt
    // the complete parse's source-occurrence IDs while preserving all semantics.
  }
  return { ...current, media };
}
