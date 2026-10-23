'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Settings } from '@/lib/types';
import {
  activeFrame,
  chapterFrames,
  isPaged,
  pageCount,
  pageIndex,
  readReadingAnchor,
  readingTop,
  readingBottom,
  restoreReadingAnchor,
  setPage,
  type ReadingAnchor,
} from './reading-layout';
import { createPageMotion } from './page-motion';
export { readReadingAnchor, restoreReadingAnchor } from './reading-layout';
export type { ReadingAnchor } from './reading-layout';

type Direction = -1 | 1;
type Options = {
  root: RefObject<HTMLElement | null>;
  surfaceReady: boolean;
  chapterId: string;
  chapterIndex: number;
  chapterCount: number;
  mode: Settings['navigationMode'];
  effect: Settings['pageEffect'];
  layoutKey: string;
  rtl: boolean;
  enabled: boolean;
  blocked: boolean;
  onChapter: (index: number, edge?: 'start' | 'end') => void;
};
type Turn = {
  frame: HTMLElement;
  target: HTMLElement;
  index: number;
  page: number;
  direction: Direction;
};
type Drag = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  progress: number;
  direction: Direction;
  turn?: Turn;
};
const interactive = 'button,a,input,textarea,select,[contenteditable="true"],[role="slider"]';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useReadingNavigation(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [metrics, setMetrics] = useState({ page: 1, pages: 1, atStart: true, atEnd: false });
  const [turning, setTurning] = useState(false);
  const anchor = useRef<ReadingAnchor | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const motion = useRef<ReturnType<typeof createPageMotion> | null>(null);
  const raf = useRef(0);
  const drag = useRef<Drag | null>(null);
  const queued = useRef<Direction | null>(null);
  const suppressClick = useRef(0);
  const turnAgain = useRef<(direction: Direction) => void>(() => {});

  const refresh = useCallback((publish = false) => {
    const current = latest.current;
    const root = current.root.current;
    if (!root || locked.current) return;
    const frame = activeFrame(root);
    const pages = frame && isPaged(root) ? pageCount(frame) : 1;
    const page = frame && isPaged(root) ? Math.min(pageIndex(frame) + 1, pages) : 1;
    const next = {
      page,
      pages,
      atStart: isPaged(root) ? page === 1 : root.scrollTop < 2,
      atEnd: isPaged(root)
        ? page === pages
        : root.scrollTop >= root.scrollHeight - root.clientHeight - 3,
    };
    setMetrics((previous) =>
      Object.keys(next).every(
        (key) => previous[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? previous
        : next,
    );
    anchor.current = readReadingAnchor(root);
    if (publish) root.dispatchEvent(new Event('reader-location'));
  }, []);

  const cancel = useCallback(() => {
    cancelAnimationFrame(raf.current);
    motion.current?.remove();
    motion.current = null;
    locked.current = false;
    drag.current = null;
    queued.current = null;
    if (latest.current.root.current) latest.current.root.current.dataset.turning = 'false';
    if (mounted.current) setTurning(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  useLayoutEffect(() => {
    const root = options.root.current;
    if (!options.surfaceReady || !root) return;
    cancel();
    for (const frame of chapterFrames(root)) {
      const content = frame.querySelector<HTMLElement>('[data-book-page]');
      if (options.mode === 'scroll' && content) content.style.transform = '';
      else setPage(frame, pageIndex(frame));
    }
    if (anchor.current && !document.hidden) restoreReadingAnchor(root, anchor.current);
    const frame = requestAnimationFrame(() => refresh(true));
    return () => cancelAnimationFrame(frame);
  }, [options.mode, options.layoutKey, options.surfaceReady, cancel, refresh, options.root]);

  useLayoutEffect(() => {
    const root = options.root.current;
    if (!options.surfaceReady || !root) return;
    const frame = requestAnimationFrame(() => refresh());
    let first = true;
    let disposed = false;
    const resize = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      const previous = anchor.current;
      cancel();
      if (previous) restoreReadingAnchor(root, previous);
      refresh(true);
    });
    resize.observe(root);
    for (const frame of chapterFrames(root)) {
      const area = frame.querySelector('.page-viewport');
      if (area) resize.observe(area);
    }
    const scroll = () => refresh();
    root.addEventListener('scroll', scroll, { passive: true });
    const fontReady = () => {
      if (disposed) return;
      const previous = anchor.current;
      cancel();
      if (previous) restoreReadingAnchor(root, previous);
      refresh(true);
    };
    document.fonts.addEventListener('loadingdone', fontReady);
    return () => {
      disposed = true;
      resize.disconnect();
      root.removeEventListener('scroll', scroll);
      document.fonts.removeEventListener('loadingdone', fontReady);
      cancelAnimationFrame(frame);
    };
  }, [
    options.chapterId,
    options.mode,
    options.enabled,
    options.surfaceReady,
    options.root,
    cancel,
    refresh,
  ]);

  const destination = useCallback((direction: Direction): Turn | null => {
    const current = latest.current;
    const root = current.root.current;
    const frame = root && activeFrame(root);
    if (!root || !frame) return null;
    const nextPage = pageIndex(frame) + direction;
    if (nextPage >= 0 && nextPage < pageCount(frame))
      return { frame, target: frame, page: nextPage, index: current.chapterIndex, direction };
    const index = current.chapterIndex + direction;
    const target = chapterFrames(root).find((node) => Number(node.dataset.chapterIndex) === index);
    return target
      ? { frame, target, page: direction > 0 ? 0 : pageCount(target) - 1, index, direction }
      : null;
  }, []);

  const begin = useCallback((target: Turn, y = 0.5) => {
    const current = latest.current;
    const root = current.root.current!;
    root.focus({ preventScroll: true });
    locked.current = true;
    root.dataset.turning = 'true';
    setTurning(true);
    if (current.effect !== 'none' && !reducedMotion())
      motion.current = createPageMotion(
        root,
        target.frame,
        target.target,
        target.page,
        (target.direction * (current.rtl ? -1 : 1)) as Direction,
        current.effect,
        y,
      );
  }, []);

  const settle = useCallback(
    (target: Turn, from: number, commit: boolean) => {
      const goal = commit ? 1 : 0;
      const start = performance.now();
      const duration = motion.current ? Math.max(120, 260 * Math.abs(goal - from)) : 0;
      const finish = () => {
        const current = latest.current;
        if (commit) {
          setPage(target.target, target.page);
          if (target.index !== current.chapterIndex)
            current.onChapter(target.index, target.direction > 0 ? 'start' : 'end');
        }
        // Keep the visual cover through React's chapter commit.
        raf.current = requestAnimationFrame(() => {
          motion.current?.remove();
          motion.current = null;
          locked.current = false;
          if (current.root.current) current.root.current.dataset.turning = 'false';
          if (!mounted.current) return;
          setTurning(false);
          refresh(commit);
          const next = queued.current;
          queued.current = null;
          if (next) raf.current = requestAnimationFrame(() => turnAgain.current(next));
        });
      };
      const step = (now: number) => {
        const t = duration ? Math.min(1, (now - start) / duration) : 1;
        motion.current?.draw(from + (goal - from) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) raf.current = requestAnimationFrame(step);
        else finish();
      };
      raf.current = requestAnimationFrame(step);
    },
    [refresh],
  );

  const changeChapter = useCallback((index: number, edge: 'start' | 'end' = 'start') => {
    const current = latest.current;
    if (
      !current.enabled ||
      current.blocked ||
      locked.current ||
      index < 0 ||
      index >= current.chapterCount
    )
      return;
    current.onChapter(index, edge);
  }, []);

  const turn = useCallback(
    (direction: Direction) => {
      const current = latest.current;
      if (!current.enabled || current.blocked || window.getSelection()?.toString().trim()) return;
      if (current.mode === 'scroll') {
        changeChapter(current.chapterIndex + direction, direction < 0 ? 'end' : 'start');
        return;
      }
      if (locked.current) {
        if (!drag.current) queued.current = direction;
        return;
      }
      const target = destination(direction);
      if (!target) return;
      begin(target);
      settle(target, 0, true);
    },
    [begin, changeChapter, destination, settle],
  );
  useLayoutEffect(() => {
    turnAgain.current = turn;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = latest.current;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !current.enabled ||
        current.blocked ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest(interactive) ||
        document.querySelector('[role="dialog"]') ||
        window.getSelection()?.toString().trim()
      )
        return;
      if (target && !current.root.current?.contains(target) && target !== document.body) return;
      const pageDirection =
        event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)
          ? 1
          : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)
            ? -1
            : 0;
      if (current.mode === 'scroll') {
        if (!pageDirection) return;
        event.preventDefault();
        const root = current.root.current;
        if (root) {
          const content = root.querySelector('[data-book-page]');
          const line = content ? parseFloat(getComputedStyle(content).lineHeight) || 36 : 36;
          root.scrollBy({
            top:
              pageDirection *
              Math.max(80, root.clientHeight - readingTop(root) - readingBottom(root) - line),
            behavior: reducedMotion() ? 'instant' : 'smooth',
          });
        }
        return;
      }
      const physical = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      const direction = pageDirection || physical * (current.rtl ? -1 : 1);
      if (!direction) return;
      event.preventDefault();
      if (!event.repeat) turn(direction as Direction);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);

  useEffect(() => {
    const root = options.root.current;
    if (!options.surfaceReady || !root || options.mode !== 'paged') return;
    let amount = 0,
      last = 0,
      consumed = false;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || latest.current.blocked) return;
      event.preventDefault();
      const now = performance.now();
      if (now - last > 220) {
        amount = 0;
        consumed = false;
      }
      last = now;
      if (consumed) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const delta = horizontal ? event.deltaX * (latest.current.rtl ? -1 : 1) : event.deltaY;
      amount +=
        delta * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? root.clientHeight : 1);
      if (Math.abs(amount) < 44) return;
      consumed = true;
      turn(amount > 0 ? 1 : -1);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [options.root, options.mode, options.surfaceReady, turn]);

  return {
    ...metrics,
    turning,
    turn,
    changeChapter,
    refresh,
    get suppressClick() {
      return performance.now() < suppressClick.current;
    },
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      const target = event.target as Element;
      if (!event.isPrimary) {
        const start = drag.current;
        drag.current = null;
        suppressClick.current = performance.now() + 500;
        if (start?.turn) settle(start.turn, start.progress, false);
        return;
      }
      if (
        (event.pointerType === 'mouse' && !target.closest('[data-page-grip]')) ||
        target.closest(interactive) ||
        latest.current.mode !== 'paged' ||
        !latest.current.enabled ||
        latest.current.blocked ||
        locked.current ||
        window.getSelection()?.toString().trim()
      )
        return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastAt: performance.now(),
        velocity: 0,
        progress: 0,
        direction: 1,
      };
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>) {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x,
        dy = event.clientY - start.y;
      if (!start.turn) {
        if (
          window.getSelection()?.toString().trim() ||
          Math.abs(dy) > Math.max(12, Math.abs(dx) * 1.2)
        ) {
          drag.current = null;
          return;
        }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        const physical = dx < 0 ? 1 : -1;
        start.direction = (physical * (latest.current.rtl ? -1 : 1)) as Direction;
        const target = destination(start.direction);
        if (!target) {
          drag.current = null;
          return;
        }
        start.turn = target;
        const rect = target.frame.getBoundingClientRect();
        begin(target, Math.max(0, Math.min(1, (start.y - rect.top) / rect.height)));
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      suppressClick.current = performance.now() + 500;
      const physical = start.direction * (latest.current.rtl ? -1 : 1);
      const now = performance.now();
      start.velocity =
        (-(event.clientX - start.lastX) * physical) / Math.max(1, now - start.lastAt);
      start.lastX = event.clientX;
      start.lastAt = now;
      start.progress = Math.max(0, Math.min(1, (-dx * physical) / start.turn.frame.clientWidth));
      motion.current?.draw(start.progress);
    },
    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      drag.current = null;
      if (!start.turn) return;
      suppressClick.current = performance.now() + 500;
      const speed = performance.now() - start.lastAt < 100 ? start.velocity : 0;
      settle(
        start.turn,
        start.progress,
        start.progress >= 0.45 || (start.progress >= 0.07 && speed > 0.5),
      );
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel(event: React.PointerEvent<HTMLElement>) {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      drag.current = null;
      if (start.turn) settle(start.turn, start.progress, false);
    },
  };
}
