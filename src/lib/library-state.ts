import { stage, stageShelfState, stagePreferences, localPreferences } from './sync-storage';
import {
  idb,
  localTransaction,
  notifyLocalData,
  notifySyncDirty,
  reportSyncError,
} from './local-database';
import { libraryDatabaseName, storageKey } from './storage-scope';
import {
  MAX_COLLECTIONS,
  normalizeCollectionName,
} from '../../packages/reading-core/src/collections';
import type { PortableCollection } from '../../packages/reading-core/src/portable';
import { cleanShelf } from './sync-types';

export type BookState = {
  status?: 'unread' | 'reading' | 'finished';
  pinned?: boolean;
  hidden?: boolean;
  group?: string;
  lastOpenedAt?: number;
};
export type LibraryState = { books: Record<string, BookState>; groups: string[] };
export type ReaderProfile = { name: string; bio: string; color: string };
export const profileColors = ['#77a98c', '#639ed4', '#b294bc', '#c99a6e', '#7d9ca5'];
export const defaultProfile: ReaderProfile = {
  name: '读书的人',
  bio: '在阅读里，遇见更大的世界。',
  color: profileColors[0],
};
const key = 'ai-read-library';

const collectionIntentKind = 'portable-collections-v1';
export type LibraryScope = { key: string; databaseName: string };
export const captureLibraryScope = (): LibraryScope => ({
  key: storageKey(key),
  databaseName: libraryDatabaseName(),
});
export function assertLibraryScope(scope: LibraryScope, tx?: IDBTransaction) {
  if (
    scope.key !== storageKey(key) ||
    scope.databaseName !== libraryDatabaseName() ||
    (tx && tx.db.name !== scope.databaseName)
  )
    throw new Error('阅读身份已变化，请刷新。');
}

/** Preserve every valid local group, including legacy orphan memberships. */
function canonicalLibraryState(state: LibraryState): LibraryState {
  const names = new Map<string, string>();
  const remember = (value: unknown) => {
    const normalized = normalizeCollectionName(value);
    if (!normalized) return undefined;
    if (!names.has(normalized.key)) names.set(normalized.key, normalized.name);
    return names.get(normalized.key)!;
  };
  for (const name of state.groups) remember(name);
  const books = Object.fromEntries(
    Object.entries(state.books).map(([id, book]) => [
      id,
      {
        ...book,
        group: book.group === '' ? '' : remember(book.group),
      },
    ]),
  );
  return { books, groups: [...names.values()] };
}

export function loadLibraryState(strict = false): LibraryState {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(key)) || '{}');
    const books: Record<string, BookState> = Object.create(null);
    for (const [id, value] of Object.entries(raw.books || {})) {
      if (!value || typeof value !== 'object') continue;
      const b = value as BookState;
      books[id] = {
        status: ['unread', 'reading', 'finished'].includes(b.status || '') ? b.status : undefined,
        pinned: b.pinned === true,
        hidden: b.hidden === true,
        group: b.group === '' ? '' : normalizeCollectionName(b.group)?.name,
        lastOpenedAt: typeof b.lastOpenedAt === 'number' ? b.lastOpenedAt : undefined,
      };
    }
    return canonicalLibraryState({
      books,
      groups: Array.isArray(raw.groups)
        ? raw.groups.filter((s: unknown) => typeof s === 'string')
        : [],
    });
  } catch {
    if (strict) throw new Error('无法读取本机分组，请重试。');
    return { books: {}, groups: [] };
  }
}

export function updateLibraryBooks(ids: string[], patch: BookState) {
  let state = loadLibraryState();
  for (const id of ids) state.books[id] = { ...state.books[id], ...patch };
  state = canonicalLibraryState(state);
  if (state.groups.length > MAX_COLLECTIONS)
    throw new Error('分组合并后超过 100 个，请先整理本机分组。');
  localStorage.setItem(storageKey(key), JSON.stringify(state));
  void stageShelfState(ids, state.books).catch(reportSyncError);
  window.dispatchEvent(new Event('ai-read-library-change'));
  return state;
}

export function addLibraryGroup(name: string) {
  const clean = normalizeCollectionName(name);
  if (!clean) throw new Error('请输入 1 至 40 个字的分组名称。');
  const state = loadLibraryState();
  if (!state.groups.some((group) => normalizeCollectionName(group)?.key === clean.key))
    state.groups.push(clean.name);
  if (state.groups.length > MAX_COLLECTIONS)
    throw new Error('分组合并后超过 100 个，请先整理本机分组。');
  localStorage.setItem(storageKey(key), JSON.stringify(state));
  void stagePreferences().catch(reportSyncError);
  window.dispatchEvent(new Event('ai-read-library-change'));
  return state;
}

export function portableCollections(
  bookIds: string[],
  includeEmpty: boolean,
): PortableCollection[] {
  const state = loadLibraryState(true);
  const allowed = new Set(bookIds);
  const groups = new Map(state.groups.map((name) => [name, [] as string[]]));
  for (const [id, book] of Object.entries(state.books)) {
    if (allowed.has(id) && book.group) groups.get(book.group)?.push(id);
  }
  const result = [...groups]
    .filter(([, ids]) => includeEmpty || ids.length)
    .map(([name, ids]) => ({ name, bookIds: ids }));
  if (result.length > MAX_COLLECTIONS) throw new Error('分组合并后超过 100 个，请先整理本机分组。');
  return result;
}

export function mergePortableCollections(
  state: LibraryState,
  collections: PortableCollection[],
): LibraryState {
  const next = canonicalLibraryState(state);
  const names = new Map(next.groups.map((name) => [normalizeCollectionName(name)!.key, name]));
  for (const collection of collections) {
    const normalized = normalizeCollectionName(collection.name);
    if (!normalized) throw new Error('Invalid reading pack collections');
    const name = names.get(normalized.key) || normalized.name;
    if (!names.has(normalized.key)) {
      names.set(normalized.key, name);
      next.groups.push(name);
    }
    for (const id of collection.bookIds) {
      const current = Object.hasOwn(next.books, id) ? next.books[id] : {};
      if (!current.group) next.books[id] = { ...current, group: name };
    }
  }
  if (next.groups.length > MAX_COLLECTIONS)
    throw new Error('分组合并后超过 100 个，请先整理本机分组。');
  return next;
}

/** This intent commits with books; it is never exposed as a synchronization recovery book. */
export async function stagePortableCollections(
  tx: IDBTransaction,
  scope: LibraryScope,
  collections: PortableCollection[],
) {
  assertLibraryScope(scope, tx);
  const pending = await idb(
    tx
      .objectStore('sync-recovery')
      .getAll(IDBKeyRange.bound([collectionIntentKind], [collectionIntentKind, []])),
  );
  assertLibraryScope(scope, tx);
  let state = loadLibraryState(true);
  // An earlier import may still be waiting for localStorage. Its groups also consume capacity.
  for (const intent of pending)
    state = mergePortableCollections(state, intentCollections(intent, scope));
  mergePortableCollections(state, collections); // Recheck capacity immediately before commit.
  await idb(
    tx
      .objectStore('sync-recovery')
      .put({ kind: collectionIntentKind, scope: scope.key, collections }, [
        collectionIntentKind,
        crypto.randomUUID(),
      ]),
  );
  assertLibraryScope(scope, tx);
}

function intentCollections(intent: unknown, scope: LibraryScope): PortableCollection[] {
  const value = intent as {
    kind?: string;
    scope?: string;
    collections?: PortableCollection[];
  } | null;
  if (
    value?.kind !== collectionIntentKind ||
    value.scope !== scope.key ||
    !Array.isArray(value.collections) ||
    value.collections.length > MAX_COLLECTIONS
  )
    throw new Error('Invalid reading pack collections');
  return value.collections.map((collection) => {
    const name = normalizeCollectionName(collection?.name)?.name;
    if (
      !name ||
      !Array.isArray(collection.bookIds) ||
      collection.bookIds.length > 1000 ||
      collection.bookIds.some((id) => typeof id !== 'string')
    )
      throw new Error('Invalid reading pack collections');
    return { name, bookIds: collection.bookIds };
  });
}

const collectionReplays = new Map<string, Promise<{ collectionsPending: boolean }>>();
/** Idempotent completion after IDB commit, also resumed by the next library load. */
export function resumePortableCollections(
  scope = captureLibraryScope(),
): Promise<{ collectionsPending: boolean }> {
  const previous = collectionReplays.get(scope.key);
  const replay = (previous || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      let changed = false;
      let completed = false;
      let collectionsPending = false;
      try {
        assertLibraryScope(scope);
        await localTransaction('readwrite', async (tx) => {
          assertLibraryScope(scope, tx);
          const store = tx.objectStore('sync-recovery');
          // Array keys keep these small records separate from string-keyed book recovery bodies.
          const range = IDBKeyRange.bound([collectionIntentKind], [collectionIntentKind, []]);
          const [keys, values] = await Promise.all([
            idb(store.getAllKeys(range)),
            idb(store.getAll(range)),
          ]);
          if (!values.length) return;
          collectionsPending = true;
          const bookIds = new Set((await idb(tx.objectStore('books').getAllKeys())).map(String));
          let state = loadLibraryState(true);
          for (const intent of values) {
            const collections = intentCollections(intent, scope).map((collection) => {
              return {
                name: collection.name,
                bookIds: collection.bookIds.filter((id) => bookIds.has(id)),
              };
            });
            state = mergePortableCollections(state, collections);
          }
          assertLibraryScope(scope, tx);
          const serialized = JSON.stringify(state);
          if (localStorage.getItem(scope.key) !== serialized) {
            localStorage.setItem(scope.key, serialized);
            changed = true;
          }
          // Retry every grouped book, including when an earlier attempt wrote localStorage but
          // its IDB transaction failed before staging. Never create a ghost/deleted book here.
          for (const id of bookIds) {
            assertLibraryScope(scope, tx);
            if (state.books[id]?.group)
              await stage(tx, 'book', id, id, { shelfState: cleanShelf(state.books[id]) });
          }
          await stage(tx, 'preferences', '', 'preferences', localPreferences());
          assertLibraryScope(scope, tx);
          for (const journalKey of keys) await idb(store.delete(journalKey));
        });
        completed = collectionsPending;
        collectionsPending = false;
      } catch {
        // A failed mirror/stage must not misreport already-committed books as a failed import.
        collectionsPending = true;
      }
      if (changed) notifyLocalData();
      if (completed) notifySyncDirty();
      return { collectionsPending };
    });
  collectionReplays.set(scope.key, replay);
  void replay.finally(() => {
    if (collectionReplays.get(scope.key) === replay) collectionReplays.delete(scope.key);
  });
  return replay;
}

export function loadProfile(): ReaderProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey('ai-read-profile')) || '{}');
    return {
      name:
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.slice(0, 40)
          : defaultProfile.name,
      bio: typeof raw.bio === 'string' ? raw.bio.slice(0, 120) : defaultProfile.bio,
      color: profileColors.includes(raw.color) ? raw.color : defaultProfile.color,
    };
  } catch {
    return defaultProfile;
  }
}

export function saveProfile(profile: ReaderProfile) {
  localStorage.setItem(storageKey('ai-read-profile'), JSON.stringify(profile));
  window.dispatchEvent(new Event('ai-read-library-change'));
}
