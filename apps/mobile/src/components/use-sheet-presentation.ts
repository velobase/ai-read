import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { LibraryLease } from '../adapters/library-scope';
import { LibraryControllerContext } from '../library-controller';

type Phase = 'idle' | 'presenting' | 'shown' | 'dismissing';
type Presentation<T extends string> = {
  sheet: T | null;
  desiredSheet: T | null;
  group: string | null;
  phase: Phase;
  id: number;
  owner: LibraryLease | null;
};

/**
 * Coordinates one owner's Modal hosts, not unrelated application modals.
 * Keep the returned sheet mounted until onDismiss, and attach these callbacks
 * only to that presentation's host. Same-group contents share one native Modal.
 */
export function useSheetPresentation<T extends string>({
  library,
  group,
}: {
  library: LibraryLease;
  group: (sheet: T) => string;
}) {
  const controller = useContext(LibraryControllerContext);
  const blocked = !!controller?.blocked;
  const input = useRef({ library, group, blocked });
  input.current = { library, group, blocked };
  const active = useRef(false);
  const machine = useRef<Presentation<T>>({
    sheet: null,
    desiredSheet: null,
    group: null,
    phase: 'idle',
    id: 0,
    owner: null,
  });
  const [presentation, setPresentation] = useState(machine.current);
  const committedPresentation = useRef(0);
  const visible =
    !blocked &&
    presentation.owner === library &&
    library.isCurrent() &&
    (presentation.phase === 'presenting' || presentation.phase === 'shown');

  const publish = useCallback((next: Presentation<T>) => {
    machine.current = next;
    if (active.current) setPresentation(next);
  }, []);
  const permitted = useCallback(
    (owner: LibraryLease | null) =>
      active.current &&
      owner === input.current.library &&
      !input.current.blocked &&
      !!owner?.isCurrent(),
    [],
  );
  const idle = useCallback(
    (current: Presentation<T>): Presentation<T> => ({
      sheet: null,
      desiredSheet: null,
      group: null,
      phase: 'idle',
      id: current.id,
      owner: null,
    }),
    [],
  );
  const begin = useCallback(
    (current: Presentation<T>, next: T, owner: LibraryLease): Presentation<T> => ({
      sheet: next,
      desiredSheet: next,
      group: input.current.group(next),
      phase: 'presenting',
      id: current.id + 1,
      owner,
    }),
    [],
  );

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      // A delayed native completion may still arrive after the owner unmounts.
      machine.current = { ...machine.current, desiredSheet: null };
    };
  }, []);

  useLayoutEffect(() => {
    if (visible) committedPresentation.current = presentation.id;
  }, [visible, presentation.id]);

  useLayoutEffect(() => {
    const invalidate = () => {
      const current = machine.current;
      if (current.phase === 'idle') return;
      // Security/lifetime invalidation hides immediately, even during present.
      // No queued panel survives a revoke or a temporarily blocked account.
      publish(
        committedPresentation.current === current.id
          ? { ...current, desiredSheet: null, phase: 'dismissing' }
          : idle(current),
      );
    };
    if (
      blocked ||
      !library.isCurrent() ||
      (machine.current.owner && machine.current.owner !== library)
    )
      invalidate();
    library.signal.addEventListener('abort', invalidate);
    return () => library.signal.removeEventListener('abort', invalidate);
  }, [library, blocked, publish, idle]);

  const request = useCallback(
    (next: T | null) => {
      if (!permitted(library)) return;
      const current = machine.current;
      if (current.phase === 'idle') {
        if (next !== null) publish(begin(current, next, library));
        return;
      }
      // A changed lease first retires its old native shell. A fresh explicit
      // request is allowed once that shell has acknowledged dismissal.
      if (current.owner !== library) return;
      if (current.phase === 'dismissing') {
        publish({ ...current, desiredSheet: next });
      } else if (next !== null && input.current.group(next) === current.group) {
        publish({ ...current, sheet: next, desiredSheet: next });
      } else {
        publish({
          ...current,
          desiredSheet: next,
          // UIKit must finish presenting before a normal close/cross-group swap.
          phase: current.phase === 'presenting' ? 'presenting' : 'dismissing',
        });
      }
    },
    [library, permitted, publish, begin],
  );

  const token = presentation.id;
  const owner = presentation.owner;
  const onShow = useCallback(() => {
    const current = machine.current;
    if (
      !active.current ||
      current.id !== token ||
      current.owner !== owner ||
      current.phase !== 'presenting'
    )
      return;
    const wanted = permitted(owner) ? current.desiredSheet : null;
    publish({
      ...current,
      desiredSheet: wanted,
      phase:
        wanted !== null && input.current.group(wanted) === current.group ? 'shown' : 'dismissing',
    });
  }, [token, owner, permitted, publish]);
  const onDismiss = useCallback(() => {
    const current = machine.current;
    if (
      !active.current ||
      current.id !== token ||
      current.owner !== owner ||
      current.phase === 'idle'
    )
      return;
    const wanted = current.phase === 'dismissing' && permitted(owner) ? current.desiredSheet : null;
    publish(wanted !== null && owner ? begin(current, wanted, owner) : idle(current));
  }, [token, owner, permitted, publish, begin, idle]);

  useEffect(() => {
    // Android removes the Modal host in the hidden render and has no onDismiss
    // event. Advance only after that commit; iOS always waits for native ACK.
    if (Platform.OS !== 'ios' && presentation.phase === 'dismissing') onDismiss();
  }, [presentation.phase, onDismiss]);

  return {
    sheet: presentation.sheet,
    desiredSheet: presentation.desiredSheet,
    visible,
    request,
    onShow,
    onDismiss,
    presentationId: presentation.id,
  };
}
