import { getTranslationDisplay } from './database';
import {
  subscribeTranslationStore,
  translationStoreRevision,
  type TranslationDisplay,
} from './translation-store';
import type { LibraryHandle } from './library-scope';

export type SavedTranslations = Record<string, Record<string, string>>;
const listeners = new Set<() => void>();
let revision = 0;
const cache = new Map<string, TranslationDisplay>();
const refreshing = new Map<string, Promise<SavedTranslations>>();
const cacheKey = (handle: LibraryHandle, bookId: string) => JSON.stringify([handle.key, bookId]);
function publish() {
  revision++;
  for (const listener of listeners) listener();
}
export const translationDisplaySnapshot = () => revision;
export function subscribeTranslationDisplay(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function putTranslations(handle: LibraryHandle, bookId: string, display: TranslationDisplay) {
  const key = cacheKey(handle, bookId);
  cache.delete(key);
  cache.set(key, display);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  publish();
}
export const cachedBookTranslations = (handle: LibraryHandle, bookId: string) =>
  cache.get(cacheKey(handle, bookId))?.texts;
export const cachedBookTranslationDisplay = (handle: LibraryHandle, bookId: string) =>
  cache.get(cacheKey(handle, bookId));
export function refreshBookTranslations(
  handle: LibraryHandle,
  bookId: string,
): Promise<SavedTranslations> {
  const key = cacheKey(handle, bookId);
  const existing = refreshing.get(key);
  if (existing) return existing;
  const request = (async () => {
    // A read started before a commit/selection must never publish its older pair.
    for (;;) {
      const before = translationStoreRevision(handle, bookId);
      const display = await getTranslationDisplay(handle, bookId);
      if (translationStoreRevision(handle, bookId) !== before) continue;
      putTranslations(handle, bookId, display);
      return display.texts;
    }
  })();
  refreshing.set(key, request);
  const cleanup = () => {
    if (refreshing.get(key) === request) refreshing.delete(key);
  };
  void request.then(cleanup, cleanup);
  return request;
}
subscribeTranslationStore((handle, bookId) => {
  if (cache.has(cacheKey(handle, bookId)))
    void refreshBookTranslations(handle, bookId).catch((error) => {
      console.error(
        'Saved translation display refresh failed',
        { libraryKey: handle.key, bookId },
        error,
      );
    });
});
/** Local display invalidation does not send a cancellation to the server worker. */
export function invalidateBookTranslationDisplay(handle: LibraryHandle, bookId: string) {
  cache.delete(cacheKey(handle, bookId));
  publish();
}
