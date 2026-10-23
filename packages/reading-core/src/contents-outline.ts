import { normalizeSearch } from './search';

export type ContentsOutlineEntry = { key: string; title: string; depth: number };
export type ContentsOutlineNode<T extends ContentsOutlineEntry> = Readonly<{
  /** The caller's original entry; chapter IDs, anchors and titles are never rewritten. */
  entry: T;
  key: string;
  index: number;
  /** -1 denotes a root. Every parent precedes its children. */
  parentIndex: number;
  /** Actual parent-chain depth, without inventing nodes for skipped source levels. */
  depth: number;
  hasChildren: boolean;
  /** Exclusive end of this node's contiguous subtree in nodes. */
  subtreeEnd: number;
}>;
export type ContentsOutline<T extends ContentsOutlineEntry> = Readonly<{
  nodes: readonly ContentsOutlineNode<T>[];
  indexByKey: ReadonlyMap<string, number>;
  /** Precomputed once; search never needs to inspect a book's body. */
  searchTitles: readonly string[];
}>;
export type ContentsOutlineRow<T extends ContentsOutlineEntry> = ContentsOutlineNode<T> & {
  isMatch: boolean;
  /** Included only to provide the parent path of a direct title match. */
  isContext: boolean;
  isActive: boolean;
  isActiveAncestor: boolean;
  /** Effective collapsed state; always false while searching. */
  collapsed: boolean;
};
export type VisibleContentsOutline<T extends ContentsOutlineEntry> = {
  rows: ContentsOutlineRow<T>[];
  /** Whether normalization leaves a nonempty query; consumers share this search state. */
  searching: boolean;
  /** Zero when the query is empty; ancestor-only rows are never counted. */
  directMatchCount: number;
  activeAncestorKeys: string[];
  activeHidden: boolean;
};

/**
 * Linear construction from stable unique UI keys. The nearest earlier item with
 * a smaller source depth is the parent. Invalid depths start a new root; skipped
 * levels attach directly to an existing ancestor, without guessing missing titles.
 */
export function createContentsOutline<T extends ContentsOutlineEntry>(
  entries: readonly T[],
): ContentsOutline<T> {
  type MutableNode = { -readonly [K in keyof ContentsOutlineNode<T>]: ContentsOutlineNode<T>[K] };
  const nodes: MutableNode[] = [];
  const indexByKey = new Map<string, number>();
  const searchTitles: string[] = [],
    sourceDepths: number[] = [],
    parents: number[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!entry.key || indexByKey.has(entry.key)) throw new Error('Invalid contents outline');
    const sourceDepth = Number.isSafeInteger(entry.depth) && entry.depth >= 0 ? entry.depth : 0;
    while (parents.length && sourceDepths[parents[parents.length - 1]] >= sourceDepth)
      nodes[parents.pop()!].subtreeEnd = index;
    const parentIndex = parents.at(-1) ?? -1;
    if (parentIndex >= 0) nodes[parentIndex].hasChildren = true;
    nodes.push({
      entry,
      key: entry.key,
      index,
      parentIndex,
      depth: parentIndex >= 0 ? nodes[parentIndex].depth + 1 : 0,
      hasChildren: false,
      subtreeEnd: entries.length,
    });
    indexByKey.set(entry.key, index);
    searchTitles.push(normalizeSearch(entry.title));
    sourceDepths.push(sourceDepth);
    parents.push(index);
  }
  return { nodes, indexByKey, searchTitles };
}

/** Root-to-parent keys for one item, without storing a quadratic path array on every row. */
export function contentsOutlineAncestors<T extends ContentsOutlineEntry>(
  outline: ContentsOutline<T>,
  key: string | undefined,
): string[] {
  const index = key === undefined ? undefined : outline.indexByKey.get(key);
  if (index === undefined) return [];
  const ancestors: string[] = [];
  let parent = outline.nodes[index].parentIndex;
  while (parent >= 0) {
    const node = outline.nodes[parent];
    ancestors.push(node.key);
    parent = node.parentIndex;
  }
  return ancestors.reverse();
}

/** Linear projection. Search includes direct title matches and all their ancestors only. */
export function visibleContentsOutline<T extends ContentsOutlineEntry>(
  outline: ContentsOutline<T>,
  options: {
    collapsedKeys?: ReadonlySet<string>;
    query?: string;
    activeKey?: string;
  } = {},
): VisibleContentsOutline<T> {
  const { nodes } = outline;
  const needle = normalizeSearch((options.query || '').trim());
  const searching = !!needle;
  const matches = new Uint8Array(nodes.length),
    included = new Uint8Array(nodes.length);
  let directMatchCount = 0;
  if (searching) {
    for (let index = 0; index < nodes.length; index++) {
      if (outline.searchTitles[index].includes(needle)) {
        matches[index] = included[index] = 1;
        directMatchCount++;
      }
    }
    // Parents always precede children, so one reverse pass includes complete
    // ancestor paths, even when several matches share the same parent.
    for (let index = nodes.length - 1; index >= 0; index--) {
      const parent = nodes[index].parentIndex;
      if (included[index] && parent >= 0) included[parent] = 1;
    }
  } else {
    for (let index = 0; index < nodes.length; index++) {
      const parent = nodes[index].parentIndex;
      included[index] =
        parent < 0 || (included[parent] && !options.collapsedKeys?.has(nodes[parent].key)) ? 1 : 0;
    }
  }
  const activeAncestorKeys = contentsOutlineAncestors(outline, options.activeKey);
  const activeAncestors = new Set(activeAncestorKeys);
  const activeIndex =
    options.activeKey === undefined ? undefined : outline.indexByKey.get(options.activeKey);
  const rows: ContentsOutlineRow<T>[] = [];
  for (let index = 0; index < nodes.length; index++) {
    if (!included[index]) continue;
    const node = nodes[index];
    rows.push({
      ...node,
      isMatch: matches[index] === 1,
      isContext: searching && matches[index] === 0,
      isActive: index === activeIndex,
      isActiveAncestor: activeAncestors.has(node.key),
      collapsed: !searching && node.hasChildren && !!options.collapsedKeys?.has(node.key),
    });
  }
  return {
    rows,
    searching,
    directMatchCount,
    activeAncestorKeys,
    activeHidden: activeIndex !== undefined && !included[activeIndex],
  };
}
