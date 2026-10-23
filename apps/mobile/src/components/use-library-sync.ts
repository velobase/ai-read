import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAccount } from '../adapters/account';
import { subscribeLibraryMutations } from '../adapters/library-sync-outbox';
import {
  librarySyncSnapshot,
  refreshLibrarySyncCounts,
  subscribeLibrarySyncChanges,
  subscribeLibrarySyncStatus,
  synchronizeLibrary,
  type LibrarySyncTrigger,
} from '../adapters/library-sync';
import { automaticSyncDelay } from '../adapters/library-sync-status';
import type { LibraryLease } from '../adapters/library-scope';
import { useLibrary } from '../library-context';
import { useLibraryController } from '../library-controller';

/** Counts follow local commits even while an open reader prevents network/apply work. */
export function useLibrarySync(enabled: boolean, changed: () => void) {
  const library = useLibrary();
  const control = useLibraryController();
  const account = useAccount();
  const authorization = useRef<{ library: LibraryLease; revision: number } | null>(null);
  useEffect(() => subscribeLibrarySyncChanges(library, changed), [library, changed]);
  useEffect(() => {
    if (library.handle.kind !== 'account') return;
    const controller = new AbortController();
    const refresh = () => {
      void refreshLibrarySyncCounts(library, controller.signal).catch(() => {});
    };
    const unsubscribe = subscribeLibraryMutations(library.handle, refresh);
    refresh();
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [library]);
  useEffect(() => {
    if (
      !enabled ||
      control.blocked ||
      library.handle.kind !== 'account' ||
      account.busy ||
      account.loading ||
      account.origin !== library.handle.origin ||
      account.session?.user.id !== library.handle.userId ||
      !account.session.permissions.includes('library_sync')
    )
      return;
    const controller = new AbortController();
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let dirty = false;
    let resume: LibrarySyncTrigger | undefined;
    let observedState = librarySyncSnapshot(library).state;
    const active = () =>
      !controller.signal.aborted && library.isCurrent() && AppState.currentState === 'active';
    const schedule = (delay: number, trigger: LibrarySyncTrigger = 'automatic') => {
      if (!active()) return;
      if (running) {
        dirty = true;
        if (trigger !== 'automatic' && (trigger !== 'mutation' || !resume)) resume = trigger;
        return;
      }
      clearTimeout(timer);
      if (trigger === 'automatic' || trigger === 'mutation') {
        const wait = automaticSyncDelay(
          librarySyncSnapshot(library),
          Date.now(),
          trigger === 'mutation',
        );
        if (wait === null) return;
        delay = Math.max(delay, wait);
      }
      timer = setTimeout(() => void run(trigger), delay);
    };
    const next = () => {
      const status = librarySyncSnapshot(library);
      schedule(dirty ? 1500 : status.error ? 0 : 60000, dirty ? 'mutation' : 'automatic');
    };
    const run = async (trigger: LibrarySyncTrigger) => {
      if (!active()) return;
      running = true;
      dirty = false;
      const flight = new AbortController();
      request = flight;
      const abort = () => flight.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      try {
        await synchronizeLibrary(library, { signal: flight.signal, trigger });
      } catch {
        // Structured status explains the failure; only transient categories get another timer.
      } finally {
        controller.signal.removeEventListener('abort', abort);
        if (request === flight) request = undefined;
        running = false;
        if (resume) {
          const trigger = resume;
          resume = undefined;
          schedule(200, trigger);
        } else next();
      }
    };
    const unsubscribe = subscribeLibraryMutations(library.handle, () => {
      dirty = true;
      // A commit can replace a rejected mutation, but never bypass an auth/protocol stop or network backoff.
      schedule(1000, 'mutation');
    });
    const unsubscribeStatus = subscribeLibrarySyncStatus(library, () => {
      const state = librarySyncSnapshot(library).state;
      const wasRunning = observedState === 'syncing';
      observedState = state;
      if (running) return;
      if (state === 'syncing') clearTimeout(timer);
      else if (wasRunning) next(); // An explicit pass may have replaced an old retry deadline.
    });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule(200, 'foreground');
      else {
        clearTimeout(timer);
        request?.abort();
      }
    });
    const changedIdentity =
      authorization.current?.library !== library ||
      authorization.current.revision !== account.revision;
    authorization.current = { library, revision: account.revision };
    schedule(100, changedIdentity ? 'authorization' : 'automatic');
    return () => {
      controller.abort();
      clearTimeout(timer);
      unsubscribe();
      unsubscribeStatus();
      foreground.remove();
    };
  }, [
    enabled,
    control.blocked,
    library,
    account.origin,
    account.revision,
    account.busy,
    account.loading,
    account.session,
  ]);
}
