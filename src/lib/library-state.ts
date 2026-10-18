import { stageShelfState, stagePreferences } from './sync-storage';
import { reportSyncError } from './local-database';
import { storageKey } from './storage-scope';

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

export function loadLibraryState(): LibraryState {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(key)) || '{}');
    const books: Record<string, BookState> = {};
    for (const [id, value] of Object.entries(raw.books || {})) {
      if (!value || typeof value !== 'object') continue;
      const b = value as BookState;
      books[id] = {
        status: ['unread', 'reading', 'finished'].includes(b.status || '') ? b.status : undefined,
        pinned: b.pinned === true,
        hidden: b.hidden === true,
        group: typeof b.group === 'string' ? b.group.slice(0, 40) : undefined,
        lastOpenedAt: typeof b.lastOpenedAt === 'number' ? b.lastOpenedAt : undefined,
      };
    }
    return {
      books,
      groups: Array.isArray(raw.groups)
        ? raw.groups.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 100)
        : [],
    };
  } catch {
    return { books: {}, groups: [] };
  }
}

export function updateLibraryBooks(ids: string[], patch: BookState) {
  const state = loadLibraryState();
  for (const id of ids) state.books[id] = { ...state.books[id], ...patch };
  localStorage.setItem(storageKey(key), JSON.stringify(state));
  void stageShelfState(ids, state.books).catch(reportSyncError);
  window.dispatchEvent(new Event('ai-read-library-change'));
  return state;
}

export function addLibraryGroup(name: string) {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error('请输入分组名称。');
  const state = loadLibraryState();
  if (!state.groups.includes(clean)) state.groups.push(clean);
  localStorage.setItem(storageKey(key), JSON.stringify(state));
  void stagePreferences().catch(reportSyncError);
  window.dispatchEvent(new Event('ai-read-library-change'));
  return state;
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
