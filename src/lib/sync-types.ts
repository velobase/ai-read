import type { Book, Note, Position, Settings } from './types';
import type { BookState } from './library-state';

export type SyncEntity = 'book' | 'position' | 'note' | 'chat' | 'translation' | 'preferences';
export const syncEntities: SyncEntity[] = [
  'book',
  'position',
  'note',
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
export type SyncData = {
  book: { content?: Book; shelfState: BookState };
  position: Position;
  note: Note;
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
            input.groups.filter(
              (g): g is string => typeof g === 'string' && !!g.trim() && g.length <= 40,
            ),
          ),
        ].slice(0, 100)
      : [],
  };
}
export function cleanShelf(value: unknown): BookState {
  const v = value && typeof value === 'object' ? (value as BookState) : {};
  return {
    status: ['unread', 'reading', 'finished'].includes(v.status || '') ? v.status : undefined,
    pinned: v.pinned === true,
    hidden: v.hidden === true,
    group: typeof v.group === 'string' ? v.group.slice(0, 40) : undefined,
    lastOpenedAt:
      typeof v.lastOpenedAt === 'number' && Number.isFinite(v.lastOpenedAt)
        ? v.lastOpenedAt
        : undefined,
  };
}
