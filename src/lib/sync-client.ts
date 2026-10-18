import { prepareLocalSync } from './storage';
import {
  allSyncEntries,
  applyRemote,
  getSyncEntry,
  recoveryBackup,
  rejectSyncMutation,
  retryRejectedSync,
} from './sync-storage';
import { readLocal } from './local-database';
import type { Book } from './types';
import type { SyncEntity, SyncEntry, SyncRecord } from './sync-types';

export type SyncStatus = {
  state: 'local' | 'syncing' | 'ready' | 'offline' | 'error' | 'auth';
  pending: number;
  recovered: number;
  blocked?: number;
  lastSuccess?: number;
  error?: string;
};
export const initialSyncStatus: SyncStatus = { state: 'local', pending: 0, recovered: 0 };
class InvalidSyncMutation extends Error {}
const rejected = (entry: SyncEntry) =>
  !!entry.pending && entry.rejectedMutationId === entry.pending.mutationId;
export function startSync(userId: string, onStatus: (state: SyncStatus) => void) {
  let disposed = false,
    running = false,
    prepared = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: SyncStatus = { ...initialSyncStatus, state: 'syncing' };
  const controller = new AbortController();
  const publish = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    if (!disposed) onStatus(status);
  };
  async function api(params: Record<string, string>, mutation?: unknown): Promise<any> {
    const response = await fetch('/api/sync?' + new URLSearchParams(params), {
      method: mutation ? 'POST' : 'GET',
      cache: 'no-store',
      headers: {
        'x-reader-user': userId,
        ...(mutation ? { 'Content-Type': 'application/json' } : {}),
      },
      body: mutation ? JSON.stringify(mutation) : undefined,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
    });
    if (response.status === 401) {
      window.dispatchEvent(new Event('ai-read-identity-refresh'));
      throw new Error('sync-auth');
    }
    if (response.status === 404) return null;
    if (mutation && (response.status === 400 || response.status === 413))
      throw new InvalidSyncMutation('sync-invalid');
    const data = await response.json();
    if ((!response.ok && response.status !== 409) || data.userId !== userId)
      throw new Error(data.error || 'sync-unavailable');
    return { ...data, status: response.status };
  }
  async function remote(
    entity: SyncEntity,
    bookId: string,
    id: string,
    content = false,
  ): Promise<SyncRecord | null> {
    return (await api({ entity, bookId, id, content: content ? '1' : '0' }))?.record || null;
  }
  async function push() {
    const entries = (await allSyncEntries())
      .filter((e) => e.pending)
      .sort((a, b) => (a.entity === 'book' ? 0 : 1) - (b.entity === 'book' ? 0 : 1));
    for (const item of entries) {
      if (disposed) return;
      const entry = await getSyncEntry(item.entity, item.bookId, item.id);
      if (!entry?.pending || rejected(entry)) continue;
      if (entry.entity !== 'book' && entry.entity !== 'preferences') {
        const parent = await getSyncEntry('book', entry.bookId, entry.bookId);
        if (parent?.deleted || parent?.pending?.deleted || parent?.pending) continue;
      }
      let data = entry.pending.data;
      if (entry.entity === 'book' && !entry.pending.deleted) {
        const book = await readLocal<Book>('books', entry.bookId);
        if (!book) continue;
        data = {
          ...(data as any),
          ...(entry.version === 0 || entry.deleted ? { content: book } : {}),
        };
      }
      let result;
      try {
        result = await api(
          {},
          { entity: entry.entity, id: entry.id, bookId: entry.bookId, ...entry.pending, data },
        );
      } catch (error) {
        if (!(error instanceof InvalidSyncMutation)) throw error;
        await rejectSyncMutation(entry);
        continue;
      }
      if (result.parentDeleted) {
        if (result.record) await applyRemote(result.record);
        else throw new Error('sync-missing');
      } else if (result.record) {
        await applyRemote(result.record, entry, result.status === 409);
      } else throw new Error('sync-unavailable');
    }
  }
  async function pullCollection(entity: SyncEntity, bookId = '') {
    let after = '';
    do {
      const page = await api({ entity, bookId, after });
      for (const meta of page.items as SyncRecord[]) {
        if (disposed) return;
        const local = await getSyncEntry(meta.entity, meta.bookId, meta.id);
        const existing = entity === 'book' ? await readLocal<Book>('books', meta.id) : undefined;
        if (
          !local?.pending &&
          (meta.version > (local?.version ?? -1) ||
            (entity === 'book' && !existing && !meta.deleted))
        ) {
          const record = await remote(entity, meta.bookId, meta.id, entity === 'book' && !existing);
          if (record) {
            // A newly downloaded book must have its resume position before the
            // reader sees the book-added event and saves an initial position.
            if (entity === 'book' && !existing && !record.deleted) {
              const position = await remote('position', meta.id, meta.id);
              if (position) await applyRemote(position);
            }
            await applyRemote(record);
          }
        }
        if (entity === 'book' && !meta.deleted) {
          const current = await getSyncEntry('book', meta.id, meta.id);
          if (!current?.pending?.deleted && !current?.deleted) {
            for (const child of ['position', 'note', 'chat', 'translation'] as const)
              await pullCollection(child, meta.id);
          }
        }
      }
      after = page.next || '';
    } while (after && !disposed);
  }
  async function perform() {
    if (disposed || !navigator.onLine) {
      publish({ state: 'offline' });
      return;
    }
    publish({ state: 'syncing', error: undefined });
    if (!prepared) {
      await prepareLocalSync();
      prepared = true;
    }
    await push();
    const preferences = await remote('preferences', '', 'preferences');
    const local = await getSyncEntry('preferences', '', 'preferences');
    if (preferences && !local?.pending && preferences.version > (local?.version ?? -1))
      await applyRemote(preferences);
    await pullCollection('book');
    // Includes conflict copies created during this pass.
    const entries = await allSyncEntries();
    const pendingEntries = entries.filter((e) => e.pending);
    const blockedBooks = new Set(
      entries.filter((e) => e.entity === 'book' && rejected(e)).map((e) => e.bookId),
    );
    const blocked = pendingEntries.filter((e) => rejected(e) || blockedBooks.has(e.bookId)).length;
    const pending = pendingEntries.length;
    const recovered = (await recoveryBackup()).books.length;
    publish({
      state: blocked ? 'error' : pending ? 'syncing' : 'ready',
      pending,
      blocked,
      recovered,
      error: blocked ? 'sync-invalid' : undefined,
      lastSuccess: Date.now(),
    });
    if (pending > blocked) schedule(1500);
  }
  async function run() {
    if (running || disposed || document.hidden) return;
    running = true;
    try {
      if (navigator.locks) {
        await navigator.locks.request(
          `bypage-sync:${userId}`,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await perform();
          },
        );
      } else await perform();
    } catch (error) {
      if (!disposed)
        publish({
          state: !navigator.onLine
            ? 'offline'
            : error instanceof Error && error.message === 'sync-auth'
              ? 'auth'
              : 'error',
          error: error instanceof Error ? error.message : 'sync-unavailable',
        });
    } finally {
      running = false;
    }
  }
  function schedule(delay = 1000) {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => void run(), delay);
  }
  const changed = () => schedule();
  const visible = () => {
    if (!document.hidden) schedule(0);
  };
  const localError = () => publish({ state: 'error', error: 'sync-local' });
  const retry = () => {
    void retryRejectedSync()
      .then(() => schedule(0))
      .catch(localError);
  };
  const offline = () => publish({ state: 'offline' });
  window.addEventListener('ai-read-sync-dirty', changed);
  window.addEventListener('ai-read-sync-now', retry);
  window.addEventListener('ai-read-sync-local-error', localError);
  window.addEventListener('ai-read-storage-blocked', localError);
  window.addEventListener('online', visible);
  window.addEventListener('offline', offline);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  const interval = setInterval(visible, 30_000);
  schedule(0);
  return () => {
    disposed = true;
    controller.abort();
    clearTimeout(timer);
    clearInterval(interval);
    window.removeEventListener('ai-read-sync-dirty', changed);
    window.removeEventListener('ai-read-sync-now', retry);
    window.removeEventListener('ai-read-sync-local-error', localError);
    window.removeEventListener('ai-read-storage-blocked', localError);
    window.removeEventListener('online', visible);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}
