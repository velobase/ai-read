import { useSyncExternalStore } from 'react';
import { validSyncId } from '@bypage/reading-core';
import type { LibraryLease } from './library-scope';
import type { LibrarySyncEntity, LibrarySyncEntry, LibrarySyncRecord } from './library-sync-outbox';
import { librarySyncRequest } from './library-sync-transport';
import { accountRevision } from './account';
import {
  automaticSyncDelay,
  librarySyncFailure,
  retryBackoff,
  type LibrarySyncStatus,
  type LibrarySyncTrigger,
} from './library-sync-status';
export type {
  LibrarySyncFailure,
  LibrarySyncStatus,
  LibrarySyncTrigger,
} from './library-sync-status';
import {
  applyLibraryRemote,
  getLibrarySyncEntry,
  listLibrarySyncEntries,
  getLibrarySyncCounts,
  markLibrarySyncRejected,
} from './library-sync-storage';

const initial: LibrarySyncStatus = {
  state: 'idle',
  phase: 'idle',
  pending: 0,
  blocked: 0,
  recoveries: 0,
  countsState: 'loading',
  retryAttempt: 0,
};
// A revoked lifetime cannot publish into another lease, even for the same account database.
const statuses = new WeakMap<LibraryLease, LibrarySyncStatus>();
const listeners = new WeakMap<LibraryLease, Set<() => void>>();
const countRequests = new WeakMap<LibraryLease, number>();
const flights = new Map<string, Promise<void>>();
const changeListeners = new WeakMap<LibraryLease, Set<() => void>>();
export function subscribeLibrarySyncChanges(lease: LibraryLease, callback: () => void) {
  let scoped = changeListeners.get(lease);
  if (!scoped) changeListeners.set(lease, (scoped = new Set()));
  scoped.add(callback);
  return () => {
    scoped.delete(callback);
  };
}
export const librarySyncSnapshot = (lease: LibraryLease): LibrarySyncStatus =>
  statuses.get(lease) || initial;
export function subscribeLibrarySyncStatus(lease: LibraryLease, listener: () => void) {
  let scoped = listeners.get(lease);
  if (!scoped) listeners.set(lease, (scoped = new Set()));
  scoped.add(listener);
  return () => {
    scoped.delete(listener);
  };
}
function update(lease: LibraryLease, patch: Partial<LibrarySyncStatus>) {
  if (!lease.isCurrent()) return;
  statuses.set(lease, { ...librarySyncSnapshot(lease), ...patch });
  for (const listener of listeners.get(lease) || []) listener();
}
export function useLibrarySyncStatus(lease: LibraryLease) {
  return useSyncExternalStore(
    (listener) => subscribeLibrarySyncStatus(lease, listener),
    () => librarySyncSnapshot(lease),
    () => initial,
  );
}

/** Read aggregates after commits, including when networking is disabled or has failed. */
export async function refreshLibrarySyncCounts(lease: LibraryLease, signal?: AbortSignal) {
  if (lease.handle.kind !== 'account') return;
  const request = (countRequests.get(lease) || 0) + 1;
  countRequests.set(lease, request);
  const current = () =>
    lease.isCurrent() && !signal?.aborted && countRequests.get(lease) === request;
  if (!current()) return;
  if (!librarySyncSnapshot(lease).countsUpdatedAt) update(lease, { countsState: 'loading' });
  try {
    const counts = await getLibrarySyncCounts(lease.handle);
    if (current()) update(lease, { ...counts, countsState: 'ready', countsUpdatedAt: Date.now() });
    return counts;
  } catch (error) {
    if (current()) update(lease, { countsState: 'error' });
    throw error;
  }
}
function invalid(): never {
  throw new Error('invalid_sync_response');
}
const entities: LibrarySyncEntity[] = ['book', 'position', 'note', 'bookmark'];
function record(
  value: unknown,
  expected?: { entity: LibrarySyncEntity; bookId?: string; id?: string },
): LibrarySyncRecord {
  if (!value || typeof value !== 'object') return invalid();
  const row = value as LibrarySyncRecord;
  if (
    !entities.includes(row.entity) ||
    !validSyncId(row.id) ||
    !validSyncId(row.bookId) ||
    !Number.isSafeInteger(row.version) ||
    row.version < 0 ||
    (row.version === 0 && !row.deleted) ||
    typeof row.deleted !== 'boolean' ||
    (row.mutationId !== undefined && row.mutationId !== null && !validSyncId(row.mutationId)) ||
    ((row.entity === 'book' || row.entity === 'position') && row.id !== row.bookId) ||
    (expected &&
      (expected.entity !== row.entity ||
        (expected.bookId !== undefined && expected.bookId !== row.bookId) ||
        (expected.id !== undefined && expected.id !== row.id)))
  )
    return invalid();
  return row;
}

/** One serialized pass; account revisions and the library lifetime fence every request/apply. */
export async function synchronizeLibrary(
  lease: LibraryLease,
  options: { signal?: AbortSignal; changed?: () => void; trigger?: LibrarySyncTrigger } = {},
) {
  if (lease.handle.kind !== 'account') return;
  const previous = flights.get(lease.handle.key);
  const operation = (async () => {
    await previous?.catch(() => {});
    const revision = accountRevision();
    const prior = librarySyncSnapshot(lease);
    const assert = () => {
      lease.assertCurrent();
      if (options.signal?.aborted || accountRevision() !== revision)
        throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    };
    const guard = {
      signal: options.signal,
      isCurrent: () =>
        lease.isCurrent() && !options.signal?.aborted && accountRevision() === revision,
    };
    let didChange = false;
    let started = false;
    const apply = async (
      value: LibrarySyncRecord,
      settings: Parameters<typeof applyLibraryRemote>[2] = {},
    ) => {
      assert();
      const result = await applyLibraryRemote(lease.handle, value, { ...settings, guard });
      // A commit that won the cancellation race still needs a refresh in its owning lease.
      didChange ||= result.applied;
      assert();
    };
    const read = async (entity: LibrarySyncEntity, bookId: string, id = bookId) => {
      assert();
      const response = await librarySyncRequest(
        lease,
        { query: { entity, bookId, id, ...(entity === 'book' ? { content: true } : {}) } },
        options.signal,
      );
      assert();
      if (response.status === 404) return null;
      if (response.status !== 200) return invalid();
      return record((response.body as { record?: unknown }).record, { entity, bookId, id });
    };
    const applyBook = async (
      value: LibrarySyncRecord,
      sent?: LibrarySyncEntry,
      conflict = false,
    ) => {
      const initialPosition =
        !value.deleted && (!sent || conflict) ? await read('position', value.bookId) : undefined;
      await apply(value, {
        sent,
        conflict,
        ...(initialPosition !== undefined ? { initialPosition } : {}),
      });
    };
    const list = async (entity: LibrarySyncEntity, bookId?: string) => {
      const rows: LibrarySyncRecord[] = [];
      let after: string | undefined;
      const seen = new Set<string>();
      do {
        assert();
        const response = await librarySyncRequest(
          lease,
          { query: { entity, ...(bookId ? { bookId } : {}), ...(after ? { after } : {}) } },
          options.signal,
        );
        assert();
        if (response.status !== 200) return invalid();
        const body = response.body as { items?: unknown[]; next?: unknown };
        if (
          !Array.isArray(body.items) ||
          body.items.length > 200 ||
          (body.next !== null && !validSyncId(body.next))
        )
          return invalid();
        let last = after;
        for (const item of body.items) {
          const value = record(item, { entity, bookId });
          if (value.version === 0) return invalid();
          // Server collation defines order; cursor/ID repetition is always invalid.
          if (seen.has(value.id) || value.id === after) return invalid();
          seen.add(value.id);
          rows.push(value);
          last = value.id;
        }
        if (
          body.next !== null &&
          (!body.items.length || body.next !== last || body.next === after || entity === 'position')
        )
          return invalid();
        after = body.next === null ? undefined : (body.next as string);
      } while (after);
      return rows;
    };
    const allPending = async (includeRejected = false) => {
      const entries: LibrarySyncEntry[] = [];
      let after: string | undefined;
      for (;;) {
        assert();
        const page = await listLibrarySyncEntries(lease.handle, {
          pendingOnly: true,
          includeRejected,
          limit: 200,
          after,
        });
        entries.push(...page);
        if (page.length < 200) return entries;
        const next = page.at(-1)!.key;
        if (next === after) return invalid();
        after = next;
      }
    };
    try {
      assert();
      const automatic = options.trigger === 'automatic' || options.trigger === 'mutation';
      if (automatic) {
        const delay = automaticSyncDelay(
          librarySyncSnapshot(lease),
          Date.now(),
          options.trigger === 'mutation',
        );
        if (delay === null || delay > 0) return;
      }
      started = true;
      update(lease, {
        state: 'syncing',
        phase: 'counting',
        error: undefined,
        retryAt: undefined,
        ...(!automatic ? { retryAttempt: 0 } : {}),
      });
      await refreshLibrarySyncCounts(lease, options.signal);
      assert();
      const pending = await allPending();
      pending.sort((a, b) => Number(b.entity === 'book') - Number(a.entity === 'book'));
      update(lease, { phase: 'uploading' });
      for (const candidate of pending) {
        assert();
        const entry = await getLibrarySyncEntry(
          lease.handle,
          candidate.entity,
          candidate.bookId,
          candidate.id,
        );
        if (!entry?.pending || entry.pending.mutationId === entry.rejectedMutationId) continue;
        if (entry.entity !== 'book') {
          const parent = await getLibrarySyncEntry(
            lease.handle,
            'book',
            entry.bookId,
            entry.bookId,
          );
          if (!parent || parent.deleted || parent.pending) continue;
        }
        try {
          const response = await librarySyncRequest(
            lease,
            {
              mutation: {
                entity: entry.entity,
                bookId: entry.bookId,
                id: entry.id,
                ...entry.pending,
              },
            },
            options.signal,
          );
          assert();
          const body = response.body as { record?: unknown; parentDeleted?: boolean };
          if (response.status === 409 && body.parentDeleted === true) {
            const parent = record(
              body.record ?? {
                entity: 'book',
                bookId: entry.bookId,
                id: entry.bookId,
                version: 0,
                deleted: true,
              },
              { entity: 'book', bookId: entry.bookId, id: entry.bookId },
            );
            if (!parent.deleted) return invalid();
            await applyBook(parent, undefined, true);
          } else {
            if (response.status !== 200 && response.status !== 409) return invalid();
            let remote = record(
              body.record ??
                (response.status === 409
                  ? {
                      entity: entry.entity,
                      bookId: entry.bookId,
                      id: entry.id,
                      version: 0,
                      deleted: true,
                    }
                  : null),
              entry,
            );
            if (
              response.status === 200 &&
              remote.mutationId !== entry.pending.mutationId &&
              !(entry.pending.deleted && remote.deleted && remote.version === 0)
            )
              return invalid();
            // Ordinary shelf/progress ACKs need no text or image transfer.
            const pendingBook = entry.pending.data as
              | {
                  content?: { media?: { revision: string } };
                  metadata?: { mediaRevision?: string };
                }
              | undefined;
            const expectedMedia =
              pendingBook?.content?.media?.revision || pendingBook?.metadata?.mediaRevision;
            const remoteMedia = (
              remote.data as { metadata?: { mediaRevision?: string } } | undefined
            )?.metadata?.mediaRevision;
            if (
              remote.entity === 'book' &&
              !remote.deleted &&
              (response.status === 409 || expectedMedia !== remoteMedia)
            ) {
              const full = await read('book', remote.bookId);
              if (!full || full.version < remote.version) return invalid();
              remote = full;
            }
            if (remote.entity === 'book')
              await applyBook(
                remote,
                entry,
                response.status === 409 || remote.mutationId !== entry.pending.mutationId,
              );
            else await apply(remote, { sent: entry, conflict: response.status === 409 });
          }
        } catch (error) {
          // A 401 intentionally revokes the account revision; retain its useful diagnosis.
          if ((error as { status?: number }).status === 401) throw error;
          assert();
          const status = (error as { status?: number }).status;
          if (status === 400 || status === 413)
            await markLibrarySyncRejected(lease.handle, entry, guard);
          else throw error;
        }
      }
      update(lease, { phase: 'downloading' });
      const books = await list('book');
      for (const descriptor of books) {
        assert();
        const local = await getLibrarySyncEntry(lease.handle, 'book', descriptor.id, descriptor.id);
        if (
          (!local || descriptor.version > local.version) &&
          (!local?.pending || descriptor.deleted)
        ) {
          const remote = await read('book', descriptor.id);
          if (!remote) continue;
          await applyBook(remote, undefined, !!local?.pending);
        }
        const parent = await getLibrarySyncEntry(
          lease.handle,
          'book',
          descriptor.id,
          descriptor.id,
        );
        if (!parent || parent.deleted || parent.pending?.deleted) continue;
        for (const entity of ['position', 'note', 'bookmark'] as const) {
          const children = await list(entity, descriptor.id);
          // Delete first across all pages so replacements cannot exceed the bookmark cap.
          children.sort((a, b) => Number(b.deleted) - Number(a.deleted));
          for (const child of children) {
            assert();
            const current = await getLibrarySyncEntry(lease.handle, entity, child.bookId, child.id);
            if (current?.pending || (current && current.version >= child.version)) continue;
            const remote = await read(entity, child.bookId, child.id);
            if (remote) await apply(remote, { conflict: !!current?.pending });
          }
        }
      }
      assert();
      const counts = await refreshLibrarySyncCounts(lease, options.signal);
      assert();
      if (!counts) throw new Error('library_sync_counts_unavailable');
      update(lease, {
        state: counts.blocked ? 'error' : 'ready',
        phase: 'idle',
        completedAt: Date.now(),
        retryAttempt: 0,
        retryAt: undefined,
        error: counts.blocked ? { kind: 'rejected', retryable: false } : undefined,
      });
    } catch (error) {
      // Expiration itself aborts account-scoped requests; it is still an actionable 401.
      const cancelled =
        (error as { status?: number })?.status !== 401 &&
        (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError'));
      // This is a local aggregate read, not further network work after cancellation.
      if (lease.isCurrent()) {
        await refreshLibrarySyncCounts(lease).catch(() => {});
        if (cancelled) {
          if (started)
            update(lease, {
              state: prior.error ? 'error' : 'idle',
              phase: 'idle',
              error: prior.error,
              retryAt: prior.retryAt,
              retryAttempt: prior.retryAttempt,
            });
        } else {
          const failure = librarySyncFailure(error);
          const attempt = failure.retryable
            ? Math.min(7, librarySyncSnapshot(lease).retryAttempt + 1)
            : 0;
          update(lease, {
            state: 'error',
            phase: 'idle',
            error: failure,
            retryAttempt: attempt,
            retryAt: failure.retryable ? Date.now() + retryBackoff(attempt) : undefined,
          });
        }
      }
      throw error;
    } finally {
      if (didChange && lease.isCurrent()) {
        options.changed?.();
        for (const changed of changeListeners.get(lease) || []) changed();
      }
    }
  })();
  flights.set(lease.handle.key, operation);
  try {
    await operation;
  } finally {
    if (flights.get(lease.handle.key) === operation) flights.delete(lease.handle.key);
  }
}
