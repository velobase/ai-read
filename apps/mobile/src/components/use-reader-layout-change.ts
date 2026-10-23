import { useEffect, useRef } from 'react';
import type { Preferences } from '../context';

export type ReaderLayoutPreferences = Pick<
  Preferences,
  'fontSize' | 'lineHeight' | 'serif' | 'turnMode' | 'scrollFlow' | 'pageEffect'
>;
type Change =
  | Partial<ReaderLayoutPreferences>
  | ((preferences: ReaderLayoutPreferences) => Partial<ReaderLayoutPreferences>);

/** Coalesce quick controls around one bounded capture, retaining each +/- intent. */
export function useReaderLayoutChange(options: {
  preferences: ReaderLayoutPreferences;
  context: string;
  capture: () => Promise<unknown>;
  apply: (change: Partial<ReaderLayoutPreferences>) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true);
  const pending = useRef<{
    context: string;
    change: Partial<ReaderLayoutPreferences>;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);

  const cancel = () => {
    pending.current = null;
  };
  const change = (update: Change) => {
    if (!mounted.current) return;
    const current = latest.current;
    const active = pending.current?.context === current.context ? pending.current : null;
    const before = { ...current.preferences, ...active?.change };
    const next = typeof update === 'function' ? update(before) : update;
    if (
      Object.entries(next).every(
        ([key, value]) => before[key as keyof ReaderLayoutPreferences] === value,
      )
    )
      return;
    if (active) {
      active.change = { ...active.change, ...next };
      return;
    }
    const work = { context: current.context, change: next };
    pending.current = work;
    void (async () => {
      try {
        await current.capture();
      } catch {
        // The last trusted anchor remains usable when native measurement is unavailable.
      }
      if (!mounted.current || pending.current !== work || latest.current.context !== work.context)
        return;
      pending.current = null;
      latest.current.apply(work.change);
    })();
  };
  return { change, cancel };
}
