import type {
  Book,
  BookReferences,
  BookReferenceLink,
  BookReferenceTarget,
  BookReferenceRange,
  Chapter,
  Paragraph,
} from './types';
import { sha256, utf8 } from './book-media';
import {
  createMarkupReferenceCollection,
  paragraphsFromMarkup,
  sameBookContent,
  type MarkupNode,
  type MarkupReferenceCollection,
} from './import-markup';

export const MAX_BOOK_REFERENCES_BYTES = 512 * 1024;
export const MAX_BACKUP_REFERENCES_BYTES = 16 * 1024 * 1024;
const MAX_TARGET_BYTES = 64 * 1024;
const MAX_ENTRIES = 2000;
const keys = ['skippedExternal', 'skippedMissing', 'skippedUnanchored', 'skippedLimit'] as const;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const invalid = (): never => {
  throw new Error('Invalid book references');
};
const bytes = (value: unknown) => utf8(JSON.stringify(value)).length;
const revisionOf = (value: Omit<BookReferences, 'revision'>) =>
  sha256(
    utf8(
      JSON.stringify([
        value.version,
        value.links.map((l) => [
          l.id,
          l.kind,
          l.source.map((r) => [r.paragraphId, r.start, r.end]),
          l.targetId,
        ]),
        value.targets.map((t) => [
          t.id,
          t.location
            ? [t.location.chapterId, t.location.paragraphId, t.location.offset, t.paragraphIds]
            : t.content.map((p) => [p.text, p.kind]),
        ]),
        keys.map((key) => value.diagnostics[key]),
      ]),
    ),
  );

/** Imported links are text locations, never URLs or HTML executable by the reader. */
export function validateBookReferences(
  value: unknown,
  chapters: readonly Chapter[],
  budget = MAX_BOOK_REFERENCES_BYTES,
): BookReferences {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    !Array.isArray(value.links) ||
    value.links.length > MAX_ENTRIES ||
    !Array.isArray(value.targets) ||
    value.targets.length > MAX_ENTRIES ||
    !object(value.diagnostics) ||
    bytes(value) > Math.min(budget, MAX_BOOK_REFERENCES_BYTES)
  )
    return invalid();
  const paragraphs = new Map(
    chapters.flatMap((c, chapterIndex) =>
      c.paragraphs.map((p, index) => [p.id, { p, chapterId: c.id, chapterIndex, index }] as const),
    ),
  );
  const targetIds = new Set<string>();
  const targets = value.targets.map((raw): BookReferenceTarget => {
    if (!object(raw) || !id(raw.id) || targetIds.has(raw.id)) return invalid();
    targetIds.add(raw.id);
    if (raw.location !== undefined) {
      if (
        !object(raw.location) ||
        !id(raw.location.chapterId) ||
        !id(raw.location.paragraphId) ||
        raw.content !== undefined ||
        !Array.isArray(raw.paragraphIds) ||
        !raw.paragraphIds.length ||
        raw.paragraphIds.length > 2000
      )
        return invalid();
      const point = paragraphs.get(raw.location.paragraphId);
      if (
        !point ||
        point.chapterId !== raw.location.chapterId ||
        !Number.isSafeInteger(raw.location.offset) ||
        (raw.location.offset as number) < 0 ||
        (raw.location.offset as number) > point.p.text.length
      )
        return invalid();
      let previous = -1;
      let contentBytes = 0;
      const paragraphIds = raw.paragraphIds.map((value) => {
        const entry = typeof value === 'string' ? paragraphs.get(value) : undefined;
        if (!entry || entry.chapterId !== point.chapterId || entry.index <= previous)
          return invalid();
        previous = entry.index;
        contentBytes += utf8(entry.p.text).length;
        if (contentBytes > MAX_TARGET_BYTES) return invalid();
        return value as string;
      });
      if (!paragraphIds.includes(point.p.id)) return invalid();
      return {
        id: raw.id,
        location: {
          chapterId: point.chapterId,
          paragraphId: point.p.id,
          offset: raw.location.offset as number,
        },
        paragraphIds,
      };
    }
    if (
      raw.paragraphIds !== undefined ||
      !Array.isArray(raw.content) ||
      !raw.content.length ||
      raw.content.length > 2000 ||
      bytes(raw.content) > MAX_TARGET_BYTES
    )
      return invalid();
    const content = raw.content.map((p): Pick<Paragraph, 'text' | 'kind'> => {
      if (
        !object(p) ||
        typeof p.text !== 'string' ||
        !p.text.trim() ||
        p.text.length > 20000 ||
        !['text', 'heading', 'quote', 'code'].includes(p.kind as string)
      )
        return invalid();
      return { text: p.text, kind: p.kind as Paragraph['kind'] };
    });
    return { id: raw.id, content };
  });
  const linkIds = new Set<string>();
  const occupied = new Map<string, { start: number; end: number }[]>();
  const links = value.links.map((raw): BookReferenceLink => {
    if (
      !object(raw) ||
      !id(raw.id) ||
      linkIds.has(raw.id) ||
      !['footnote', 'internal', 'backlink'].includes(raw.kind as string) ||
      !id(raw.targetId) ||
      !targetIds.has(raw.targetId) ||
      !Array.isArray(raw.source) ||
      !raw.source.length ||
      raw.source.length > 32
    )
      return invalid();
    linkIds.add(raw.id);
    let lastChapter = -1,
      lastIndex = -1;
    const source = raw.source.map((range): BookReferenceRange => {
      if (!object(range) || !id(range.paragraphId)) return invalid();
      const entry = paragraphs.get(range.paragraphId);
      if (
        !entry ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        (range.start as number) < 0 ||
        (range.end as number) <= (range.start as number) ||
        (range.end as number) > entry.p.text.length ||
        !entry.p.text.slice(range.start as number, range.end as number).trim() ||
        (lastChapter >= 0 && (entry.chapterIndex !== lastChapter || entry.index <= lastIndex))
      )
        return invalid();
      lastChapter = entry.chapterIndex;
      lastIndex = entry.index;
      const used = occupied.get(entry.p.id) || [];
      if (used.some((r) => (range.start as number) < r.end && (range.end as number) > r.start))
        return invalid();
      used.push({ start: range.start as number, end: range.end as number });
      occupied.set(entry.p.id, used);
      return { paragraphId: entry.p.id, start: range.start as number, end: range.end as number };
    });
    return {
      id: raw.id,
      kind: raw.kind as BookReferenceLink['kind'],
      source,
      targetId: raw.targetId,
    };
  });
  const diagnostics = Object.fromEntries(
    keys.map((key) => {
      const n = (value.diagnostics as Record<string, unknown>)[key];
      if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 1000000)
        return invalid();
      return [key, n];
    }),
  ) as BookReferences['diagnostics'];
  const result: BookReferences = {
    version: 1,
    revision: value.revision,
    links,
    targets,
    diagnostics,
  };
  if (
    revisionOf(result) !== result.revision ||
    bytes(result) > Math.min(budget, MAX_BOOK_REFERENCES_BYTES)
  )
    return invalid();
  return result;
}

/** Already-validated metadata only. Preserve identity so sync can detect a true upgrade. */
export function supplementReferences(
  existing: BookReferences | undefined,
  incoming: BookReferences | undefined,
): BookReferences | undefined {
  if (!incoming || existing === incoming) return existing;
  if (!existing) return incoming;
  if (incoming.links.length <= existing.links.length) return existing;
  const targets = new Map(incoming.targets.map((t) => [t.id, JSON.stringify(t)]));
  if (existing.targets.some((t) => targets.get(t.id) !== JSON.stringify(t))) return existing;
  const old = existing.links.map((l) => JSON.stringify(l));
  let matched = 0;
  for (const link of incoming.links) if (JSON.stringify(link) === old[matched]) matched++;
  return matched === old.length ? incoming : existing;
}
export function supplementBookReferences(existing: Book, incoming: Book): Book {
  if (!incoming.references || existing.id !== incoming.id || !sameBookContent(existing, incoming))
    return existing;
  const validated = validateBookReferences(incoming.references, existing.chapters);
  const references = supplementReferences(existing.references, validated);
  return references === existing.references ? existing : { ...existing, references };
}

export type EpubReferenceSource = {
  path: string;
  chapterId: string;
  collection: MarkupReferenceCollection;
};
export type EpubReferenceDocument = { path: string; document: MarkupNode };
const tag = (node: MarkupNode) => node.localName?.toLowerCase() || '';
const attribute = (node: MarkupNode, name: string) => node.getAttribute?.(name) || '';
function semantic(node: MarkupNode, kind: string) {
  const value =
    node.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') || attribute(node, 'epub:type');
  return (
    value.split(/\s+/).includes(kind) ||
    attribute(node, 'role').split(/\s+/).includes(`doc-${kind}`)
  );
}
export function resolveEpubReference(
  path: string,
  href: string,
): { path: string; fragment: string } | null {
  if (href.length > 2000 || /[\u0000-\u001f]/.test(href)) return null;
  const hash = href.indexOf('#');
  let file = hash < 0 ? href : href.slice(0, hash);
  let fragment = hash < 0 ? '' : href.slice(hash + 1);
  try {
    file = decodeURIComponent(file);
    fragment = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(file) ||
    file.startsWith('/') ||
    file.includes('\\') ||
    file.includes('?') ||
    /[\u0000-\u001f]/.test(file + fragment)
  )
    return null;
  if (!file) return { path, fragment };
  const parts = path.split('/').slice(0, -1);
  for (const part of file.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return { path: parts.join('/'), fragment };
}

/** Resolve only archive-local targets. Supplementary documents remain outside chapters. */
function buildEpubReferences({
  chapters,
  sources,
  documents,
}: {
  chapters: Chapter[];
  sources: EpubReferenceSource[];
  documents: EpubReferenceDocument[];
}): BookReferences {
  const diagnostics: BookReferences['diagnostics'] = {
    skippedExternal: 0,
    skippedMissing: 0,
    skippedUnanchored: 0,
    skippedLimit: 0,
  };
  const links: BookReferenceLink[] = [],
    targets: BookReferenceTarget[] = [];
  const byDocument = new Map(documents.map((doc) => [doc.path, doc.document]));
  const bodySources = new Map(sources.map((source) => [source.path, source]));
  type Parsed = {
    document: MarkupNode;
    body: MarkupNode;
    collection: MarkupReferenceCollection;
    paragraphs: Paragraph[];
    chapterId?: string;
    parents: Map<MarkupNode, MarkupNode>;
  };
  const parsed = new Map<string, Parsed>();
  const get = (path: string): Parsed | null => {
    const old = parsed.get(path);
    if (old) return old;
    const document = byDocument.get(path);
    if (!document) return null;
    const parents = new Map<MarkupNode, MarkupNode>();
    let body: MarkupNode | undefined;
    const pending = [document];
    let visited = 0;
    while (pending.length && visited++ < 50000) {
      const node = pending.pop()!;
      if (tag(node) === 'body') body = node;
      // Native xmldom text nodes expose null childNodes; browser text nodes expose an empty list.
      for (const child of Array.from(node.childNodes || [])) {
        parents.set(child, node);
        pending.push(child);
      }
    }
    if (pending.length) {
      diagnostics.skippedLimit++;
      return null;
    }
    const source = bodySources.get(path);
    const collection = source?.collection || createMarkupReferenceCollection();
    const paragraphs = source
      ? chapters.find((c) => c.id === source.chapterId)?.paragraphs || []
      : paragraphsFromMarkup(body || document, 0, new Map(), undefined, collection);
    const result = {
      document,
      body: body || document,
      collection,
      paragraphs,
      chapterId: source?.chapterId,
      parents,
    };
    parsed.set(path, result);
    return result;
  };
  const scope = (doc: Parsed, node: MarkupNode): MarkupNode => {
    let current: MarkupNode | undefined = node,
      fallback: MarkupNode | undefined;
    while (current && tag(current) !== 'body') {
      if (semantic(current, 'footnote') || semantic(current, 'endnote')) return current;
      if (
        !fallback &&
        ['p', 'li', 'blockquote', 'pre', 'div', 'section', 'aside'].includes(tag(current)) &&
        doc.collection.nodes.has(current)
      )
        fallback = current;
      current = doc.parents.get(current);
    }
    return fallback || node;
  };
  const point = (doc: Parsed, fragment: string) =>
    fragment
      ? doc.collection.anchors.get(fragment)
      : doc.paragraphs[0]
        ? { paragraphId: doc.paragraphs[0].id, offset: 0, node: doc.body }
        : undefined;
  const targetMap = new Map<string, BookReferenceTarget>();
  const backlinkNodes = new Set<MarkupNode>();
  const linkNodes = new Map<string, MarkupNode>();
  const occupied = new Map<string, BookReferenceRange[]>();
  let serializedBytes = bytes({
    version: 1,
    revision: '0'.repeat(64),
    links: [],
    targets: [],
    diagnostics,
  });
  for (const source of sources) {
    const input = get(source.path);
    if (!input) continue;
    diagnostics.skippedLimit += source.collection.skippedLimit;
    for (const link of [...source.collection.links].sort((a, b) => a.order - b.order)) {
      if (links.length >= MAX_ENTRIES) {
        diagnostics.skippedLimit++;
        continue;
      }
      const resolved = resolveEpubReference(source.path, link.href);
      if (!resolved) {
        diagnostics.skippedExternal++;
        continue;
      }
      const destination = get(resolved.path);
      const anchor = destination && point(destination, resolved.fragment);
      if (!destination || !anchor) {
        diagnostics.skippedMissing++;
        continue;
      }
      if (
        !link.source.length ||
        link.source.length > 32 ||
        link.source.some(
          (r) =>
            !input.paragraphs
              .find((p) => p.id === r.paragraphId)
              ?.text.slice(r.start, r.end)
              .trim() ||
            occupied.get(r.paragraphId)?.some((old) => r.start < old.end && r.end > old.start),
        )
      ) {
        diagnostics.skippedUnanchored++;
        continue;
      }
      const node = scope(destination, anchor.node);
      const recordedSpans = destination.collection.nodes.get(node);
      if (
        !recordedSpans &&
        resolved.fragment &&
        (!destination.chapterId || semantic(node, 'footnote') || semantic(node, 'endnote'))
      ) {
        // A missing bounded collector range cannot prove where a note ends.
        diagnostics.skippedUnanchored++;
        continue;
      }
      const spans =
        !resolved.fragment && !destination.chapterId
          ? destination.paragraphs.map((p) => ({ paragraphId: p.id, start: 0, end: p.text.length }))
          : recordedSpans || [
              {
                paragraphId: anchor.paragraphId,
                start: 0,
                end:
                  destination.paragraphs.find((p) => p.id === anchor.paragraphId)?.text.length || 0,
              },
            ];
      const selected = spans
        .map((r) => destination.paragraphs.find((p) => p.id === r.paragraphId))
        .filter((p): p is Paragraph => !!p);
      if (!selected.length) {
        diagnostics.skippedUnanchored++;
        continue;
      }
      const marker = link.source
        .map((r) =>
          input.paragraphs.find((p) => p.id === r.paragraphId)!.text.slice(r.start, r.end),
        )
        .join('');
      let ancestor: MarkupNode | undefined = link.node,
        sup = false;
      while (ancestor && tag(ancestor) !== 'p' && tag(ancestor) !== 'body') {
        if (tag(ancestor) === 'sup') sup = true;
        ancestor = input.parents.get(ancestor);
      }
      const reverse = destination.collection.links.find((other) => {
        if (
          !other.source.some((r) =>
            spans.some(
              (span) =>
                span.paragraphId === r.paragraphId && r.start >= span.start && r.end <= span.end,
            ),
          )
        )
          return false;
        const back = resolveEpubReference(resolved.path, other.href);
        if (!back || back.path !== source.path) return false;
        const backPoint = point(input, back.fragment);
        // Some EPUBs attach the return id to a sup containing leading whitespace.
        // Accept that exact ancestor, without treating a whole paragraph id as a marker.
        let markerAncestor: MarkupNode | undefined = link.node;
        while (markerAncestor && markerAncestor !== backPoint?.node)
          markerAncestor = input.parents.get(markerAncestor);
        const returnsToMarker = !!markerAncestor && tag(markerAncestor) === 'sup';
        return (
          !!backPoint &&
          (returnsToMarker ||
            link.source.some(
              (r) =>
                r.paragraphId === backPoint.paragraphId &&
                backPoint.offset >= r.start &&
                backPoint.offset < r.end,
            ))
        );
      });
      const fullParagraphs = spans.every(
        (r, i) => r.start === 0 && r.end === selected[i]?.text.length,
      );
      const explicit =
        semantic(link.node, 'noteref') || semantic(node, 'footnote') || semantic(node, 'endnote');
      const traditional =
        resolved.path === source.path &&
        sup &&
        /^\[?\d{1,3}\]?$/.test(marker.trim()) &&
        !!reverse &&
        // Without semantic markup, only recognize a forward note. A superscript return
        // marker must not cause both sides of a symmetric pair to become backlinks.
        destination.paragraphs.findIndex((p) => p.id === anchor.paragraphId) >
          input.paragraphs.findIndex((p) => p.id === link.source[0].paragraphId);
      const footnote =
        !backlinkNodes.has(link.node) &&
        (explicit || traditional) &&
        (!destination.chapterId || fullParagraphs);
      const targetId = `ref-${sha256(utf8(`${resolved.path}#${resolved.fragment}:${footnote ? 'note' : 'point'}`)).slice(0, 40)}`;
      if (
        (!targetMap.has(targetId) && targets.length >= MAX_ENTRIES) ||
        ((!destination.chapterId || footnote) && selected.length > MAX_ENTRIES) ||
        (footnote && selected.reduce((sum, p) => sum + utf8(p.text).length, 0) > MAX_TARGET_BYTES)
      ) {
        diagnostics.skippedLimit++;
        continue;
      }
      let target = targetMap.get(targetId);
      if (!target) {
        if (destination.chapterId)
          target = {
            id: targetId,
            location: {
              chapterId: destination.chapterId,
              paragraphId: anchor.paragraphId,
              offset: anchor.offset,
            },
            paragraphIds: footnote ? selected.map((p) => p.id) : [anchor.paragraphId],
          };
        else {
          const content = selected
            .map((p, i) => ({ text: p.text.slice(spans[i].start, spans[i].end), kind: p.kind }))
            .filter((p) => p.text.trim());
          if (!content.length) {
            diagnostics.skippedUnanchored++;
            continue;
          }
          if (bytes(content) > MAX_TARGET_BYTES) {
            diagnostics.skippedLimit++;
            continue;
          }
          target = { id: targetId, content };
        }
      }
      const entry: BookReferenceLink = {
        id: `link-${sha256(utf8(source.path)).slice(0, 24)}-${link.order}`,
        kind: footnote ? 'footnote' : 'internal',
        source: link.source,
        targetId,
      };
      const addTarget = !targetMap.has(targetId);
      // Include the final revision field in the budget; never silently truncate note text.
      const addedBytes =
        bytes(entry) +
        (links.length ? 1 : 0) +
        (addTarget ? bytes(target) + (targets.length ? 1 : 0) : 0);
      if (serializedBytes + addedBytes > MAX_BOOK_REFERENCES_BYTES - 128) {
        diagnostics.skippedLimit++;
        continue;
      }
      serializedBytes += addedBytes;
      links.push(entry);
      linkNodes.set(entry.id, link.node);
      if (addTarget) {
        targetMap.set(targetId, target);
        targets.push(target);
      }
      for (const range of link.source) {
        const used = occupied.get(range.paragraphId) || [];
        used.push(range);
        occupied.set(range.paragraphId, used);
      }
      if (footnote && reverse) backlinkNodes.add(reverse.node);
    }
  }
  for (const link of links) if (backlinkNodes.has(linkNodes.get(link.id)!)) link.kind = 'backlink';
  for (const key of keys) diagnostics[key] = Math.min(1000000, diagnostics[key]);
  const result = { version: 1 as const, links, targets, diagnostics };
  return validateBookReferences({ ...result, revision: revisionOf(result) }, chapters);
}

/** Optional link analysis cannot discard a readable book if a malformed range is encountered. */
export function createEpubReferences(
  options: Parameters<typeof buildEpubReferences>[0],
): BookReferences {
  try {
    return buildEpubReferences(options);
  } catch {
    const result = {
      version: 1 as const,
      links: [] as BookReferenceLink[],
      targets: [] as BookReferenceTarget[],
      diagnostics: {
        skippedExternal: 0,
        skippedMissing: 0,
        skippedLimit: 0,
        skippedUnanchored: Math.min(
          1000000,
          Math.max(
            1,
            options.sources.reduce((sum, source) => sum + source.collection.links.length, 0),
          ),
        ),
      },
    };
    return { ...result, revision: revisionOf(result) };
  }
}
