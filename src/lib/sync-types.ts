import type { Book, Bookmark, Note, Position, Settings } from './types';
import type { BookState } from './library-state';
import { supplementReferences } from '../../packages/reading-core/src/book-references';
import {
  MAX_COLLECTIONS,
  normalizeCollectionName,
} from '../../packages/reading-core/src/collections';

export type SyncEntity =
  'book' | 'position' | 'note' | 'bookmark' | 'chat' | 'translation' | 'preferences';
export const syncEntities: SyncEntity[] = [
  'book',
  'position',
  'note',
  'bookmark',
  'chat',
  'translation',
  'preferences',
];
export type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  sources: string[];
  partial: boolean;
  createdAt: number;
};
export type Preferences = { settings: Partial<Settings>; groups: string[] };
export type BookMetadata = Pick<Book, 'toc' | 'sourceFormat' | 'sourceLanguage' | 'references'> & {
  mediaRevision?: string;
};
/** Prefer supplied metadata; an absent language override never means deletion. */
export function bookMetadata(
  primary: BookMetadata & Pick<Book, 'media'>,
  fallback: BookMetadata & Pick<Book, 'media'> = {},
): BookMetadata {
  const toc = primary.toc?.length ? primary.toc : fallback.toc;
  const sourceFormat = primary.sourceFormat || fallback.sourceFormat;
  const sourceLanguage = primary.sourceLanguage ?? fallback.sourceLanguage;
  const references = supplementReferences(primary.references, fallback.references);
  const mediaRevision =
    primary.media?.revision ||
    primary.mediaRevision ||
    fallback.media?.revision ||
    fallback.mediaRevision;
  return {
    ...(toc?.length ? { toc } : {}),
    ...(sourceFormat ? { sourceFormat } : {}),
    ...(sourceLanguage !== undefined ? { sourceLanguage } : {}),
    ...(references ? { references } : {}),
    ...(mediaRevision ? { mediaRevision } : {}),
  };
}
export type SyncData = {
  book: { content?: Book; metadata?: BookMetadata; shelfState: BookState };
  position: Position;
  note: Note;
  bookmark: Bookmark;
  chat: ChatTurn;
  translation: { key: string; text: string };
  preferences: Preferences;
};
export type SyncRecord = {
  entity: SyncEntity;
  bookId: string;
  id: string;
  version: number;
  deleted: boolean;
  mutationId?: string | null;
  data?: SyncData[SyncEntity];
};
export type SyncMutation = {
  mutationId: string;
  baseVersion: number;
  deleted: boolean;
  data?: SyncData[SyncEntity];
};
export type SyncEntry = Omit<SyncRecord, 'data' | 'mutationId'> & {
  key: string;
  shadow?: SyncData[SyncEntity];
  pending?: SyncMutation;
  /** Keep rejected data locally; retry only after an edit or an explicit sync. */
  rejectedMutationId?: string;
  /** Device-local comparison only: do not repeatedly exchange incompatible sidecars. */
  mediaChecked?: { localRevision: string; remoteRevision: string };
};
export const syncKey = (entity: SyncEntity, bookId: string, id: string) =>
  JSON.stringify([entity, bookId, id]);
export const sameData = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameData(v, b[i]))
    );
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const keys = Object.keys(x).filter((k) => x[k] !== undefined);
  return (
    keys.length === Object.keys(y).filter((k) => y[k] !== undefined).length &&
    keys.every((k) => sameData(x[k], y[k]))
  );
};
export const preferenceKeys = [
  'language',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'pageWidth',
  'pageMargin',
  'theme',
  'scope',
  'readingMode',
  'navigationMode',
  'pageEffect',
  'scrollFlow',
] as const;
export function cleanPreferences(value: unknown): Preferences {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const raw =
    input.settings && typeof input.settings === 'object'
      ? (input.settings as Record<string, unknown>)
      : {};
  const settings: Record<string, unknown> = {};
  const enums: Record<string, readonly string[]> = {
    fontFamily: ['system', 'serif'],
    theme: ['paper', 'night'],
    scope: ['chapter', 'read', 'book'],
    readingMode: ['original', 'bilingual', 'translation'],
    navigationMode: ['scroll', 'paged'],
    pageEffect: ['curl', 'slide', 'none'],
    scrollFlow: ['continuous', 'chapter'],
  };
  const ranges: Record<string, number[]> = {
    fontSize: [15, 26],
    lineHeight: [1.5, 2.4],
    pageWidth: [560, 840],
    pageMargin: [16, 36],
  };
  for (const key of preferenceKeys) {
    const v = raw[key];
    if (key === 'language' && typeof v === 'string' && /^[\w-]{2,30}$/.test(v)) settings[key] = v;
    else if (enums[key] && typeof v === 'string' && enums[key].includes(v)) settings[key] = v;
    else if (ranges[key] && typeof v === 'number' && Number.isFinite(v))
      settings[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], v));
  }
  return {
    settings,
    groups: Array.isArray(input.groups)
      ? [
          ...new Set(
            input.groups
              .map((group) => normalizeCollectionName(group)?.name)
              .filter((group): group is string => group !== undefined),
          ),
        ].slice(0, MAX_COLLECTIONS)
      : [],
  };
}
export function cleanShelf(value: unknown): BookState {
  const v = value && typeof value === 'object' ? (value as BookState) : {};
  return {
    status: ['unread', 'reading', 'finished'].includes(v.status || '') ? v.status : undefined,
    pinned: v.pinned === true,
    hidden: v.hidden === true,
    group: v.group === '' ? '' : normalizeCollectionName(v.group)?.name,
    lastOpenedAt:
      typeof v.lastOpenedAt === 'number' && Number.isFinite(v.lastOpenedAt)
        ? v.lastOpenedAt
        : undefined,
  };
}
