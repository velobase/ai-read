'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Position, Settings } from '@/lib/types';

type Anchor = Pick<Position, 'paragraph' | 'offset'>;
type Direction = -1 | 1;
type Options = {
  root: RefObject<HTMLElement | null>;
  chapterId: string;
  chapterIndex: number;
  chapterCount: number;
  mode: Settings['navigationMode'];
  enabled: boolean;
  blocked: boolean;
  onChapter: (index: number, edge?: 'start' | 'end') => void;
};

const interactive = 'button,a,input,textarea,select,[contenteditable="true"],[role="slider"]';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function insets(root: HTMLElement) {
  const style = getComputedStyle(root);
  const app = root.closest('.reading-app');
  const header = app?.querySelector('.reading-header')?.getBoundingClientRect().height ?? 0;
  const footer = app?.querySelector('.mobile-reading-tools')?.getBoundingClientRect().height ?? 0;
  return {
    top: Math.max(parseFloat(style.getPropertyValue('--reader-top-inset')) || 88, header + 16),
    bottom: Math.max(
      parseFloat(style.getPropertyValue('--reader-bottom-inset')) || 64,
      footer + 16,
    ),
  };
}

export function readReadingAnchor(root: HTMLElement): Anchor | null {
  const top = root.getBoundingClientRect().top + insets(root).top;
  const passages = Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]'));
  const passage =
    passages.find((node) => node.getBoundingClientRect().bottom > top) ?? passages.at(-1);
  if (!passage?.dataset.paragraph) return null;
  const rect = passage.getBoundingClientRect();
  return {
    paragraph: passage.dataset.paragraph,
    offset:
      root.scrollTop < 2
        ? 0
        : Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height))),
  };
}

export function restoreReadingAnchor(root: HTMLElement, anchor: Anchor) {
  const passages = Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]'));
  const node = passages.find((item) => item.dataset.paragraph === anchor.paragraph);
  if (!node) return;
  const offset = Number.isFinite(anchor.offset) ? Math.max(0, Math.min(1, anchor.offset ?? 0)) : 0;
  const rect = node.getBoundingClientRect();
  const top =
    node === passages[0] && offset === 0
      ? 0
      : root.scrollTop +
        rect.top -
        root.getBoundingClientRect().top -
        insets(root).top +
        rect.height * offset;
  root.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
}

function measure(root: HTMLElement) {
  const { top, bottom } = insets(root);
  const page = root.querySelector<HTMLElement>('[data-book-page]');
  const line = page ? parseFloat(getComputedStyle(page).lineHeight) || 36 : 36;
  // Two lines of overlap keep a sentence readable even when it straddles a screen.
  const step = Math.max(100, root.clientHeight - top - bottom - line * 2);
  const max = Math.max(0, root.scrollHeight - root.clientHeight);
  const pages = Math.max(1, Math.ceil(max / step) + 1);
  const atEnd = root.scrollTop >= max - 3;
  return {
    step,
    max,
    pages,
    page: atEnd ? pages : Math.min(pages, Math.floor((root.scrollTop + 3) / step) + 1),
    atStart: root.scrollTop <= 3,
    atEnd,
  };
}

export function useReadingNavigation(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [metrics, setMetrics] = useState({ page: 1, pages: 1, atStart: true, atEnd: false });
  const [turning, setTurning] = useState(false);
  const animation = useRef<Animation | null>(null);
  const locked = useRef(false);
  const enterDirection = useRef<Direction | null>(null);
  const mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number; at: number } | null>(null);
  const suppressClick = useRef(0);

  const refresh = useCallback(() => {
    const root = latest.current.root.current;
    if (!root) return;
    const next = measure(root);
    setMetrics((previous) =>
      previous.page === next.page &&
      previous.pages === next.pages &&
      previous.atStart === next.atStart &&
      previous.atEnd === next.atEnd
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      animation.current?.cancel();
    };
  }, []);

  useEffect(() => {
    const root = options.root.current;
    if (!root || !options.enabled) return;
    let anchor = readReadingAnchor(root);
    const scroll = () => {
      anchor = readReadingAnchor(root);
      refresh();
    };
    const resize = new ResizeObserver(() => {
      // Also covers streamed translations, font loading and rotation.
      if (anchor && !locked.current) restoreReadingAnchor(root, anchor);
      refresh();
    });
    resize.observe(root);
    const page = root.querySelector('[data-book-page]');
    if (page) resize.observe(page);
    root.addEventListener('scroll', scroll, { passive: true });
    const frame = requestAnimationFrame(scroll);
    return () => {
      resize.disconnect();
      root.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame);
    };
  }, [options.root, options.chapterId, options.enabled, options.mode, refresh]);

  const animateIn = useCallback(async (direction: Direction) => {
    const page = latest.current.root.current?.querySelector<HTMLElement>('[data-book-page]');
    if (!page || reducedMotion()) return;
    const effect = page.animate(
      [
        { opacity: 0.55, transform: `translateX(${direction * 14}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' },
    );
    animation.current = effect;
    await effect.finished.catch(() => {});
  }, []);

  useLayoutEffect(() => {
    const direction = enterDirection.current;
    if (!direction) return;
    enterDirection.current = null;
    const frame = requestAnimationFrame(() => {
      void animateIn(direction).finally(() => {
        locked.current = false;
        if (mounted.current) {
          setTurning(false);
          refresh();
        }
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [options.chapterId, animateIn, refresh]);

  const changeChapter = useCallback((index: number, edge: 'start' | 'end' = 'start') => {
    const current = latest.current;
    if (
      !current.enabled ||
      current.blocked ||
      locked.current ||
      index < 0 ||
      index >= current.chapterCount ||
      index === current.chapterIndex
    )
      return;
    locked.current = true;
    setTurning(true);
    enterDirection.current = index > current.chapterIndex ? 1 : -1;
    current.onChapter(index, edge);
  }, []);

  const turn = useCallback(
    async (direction: Direction) => {
      const current = latest.current;
      const root = current.root.current;
      if (
        !root ||
        !current.enabled ||
        current.blocked ||
        locked.current ||
        window.getSelection()?.toString().trim()
      )
        return;
      const currentMetrics = measure(root);
      if (direction < 0 && currentMetrics.atStart) {
        changeChapter(current.chapterIndex - 1, 'end');
        return;
      }
      // The final screen is a deliberate stop: a fresh action moves to the next chapter.
      if (direction > 0 && currentMetrics.atEnd) {
        changeChapter(current.chapterIndex + 1);
        return;
      }
      locked.current = true;
      setTurning(true);
      const target = Math.max(
        0,
        Math.min(currentMetrics.max, root.scrollTop + direction * currentMetrics.step),
      );
      const page = root.querySelector<HTMLElement>('[data-book-page]');
      try {
        if (page && !reducedMotion()) {
          animation.current = page.animate(
            [
              { opacity: 1, transform: 'translateX(0)' },
              { opacity: 0.55, transform: `translateX(${-direction * 10}px)` },
            ],
            { duration: 80, easing: 'ease-out', fill: 'forwards' },
          );
          await animation.current.finished;
        }
        if (!mounted.current || latest.current.chapterId !== current.chapterId) return;
        root.scrollTo({ top: target, behavior: 'instant' });
        animation.current?.cancel();
        refresh();
        await animateIn(direction);
      } catch {
        /* A chapter change or unmount can cancel a transition. */
      } finally {
        animation.current?.cancel();
        locked.current = false;
        if (mounted.current) setTurning(false);
      }
    },
    [animateIn, changeChapter, refresh],
  );

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
      const direction = ['ArrowRight', 'PageDown', ' '].includes(event.key)
        ? 1
        : ['ArrowLeft', 'PageUp'].includes(event.key)
          ? -1
          : 0;
      if (!direction) return;
      event.preventDefault();
      if (event.repeat) return;
      void turn(event.key === ' ' && event.shiftKey ? -1 : direction);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);

  useEffect(() => {
    const root = options.root.current;
    if (!root || options.mode !== 'paged' || !options.enabled) return;
    let amount = 0;
    let last = 0;
    let consumed = false;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || latest.current.blocked) return;
      event.preventDefault();
      const now = performance.now();
      if (now - last > 200) {
        amount = 0;
        consumed = false;
      }
      last = now;
      if (consumed) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      amount +=
        delta * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? root.clientHeight : 1);
      if (Math.abs(amount) < 44) return;
      consumed = true;
      void turn(amount > 0 ? 1 : -1);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [options.root, options.mode, options.enabled, turn]);

  return {
    ...metrics,
    turning,
    turn,
    changeChapter,
    get suppressClick() {
      return performance.now() < suppressClick.current;
    },
    onPointerDown(event: React.PointerEvent<HTMLElement>) {
      gesture.current =
        event.isPrimary &&
        event.pointerType !== 'mouse' &&
        !(event.target as Element).closest(interactive)
          ? { x: event.clientX, y: event.clientY, at: performance.now() }
          : null;
    },
    onPointerCancel() {
      gesture.current = null;
    },
    onPointerUp(event: React.PointerEvent<HTMLElement>) {
      const start = gesture.current;
      gesture.current = null;
      if (!start || latest.current.mode !== 'paged') return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (
        performance.now() - start.at > 600 ||
        Math.abs(dx) < 48 ||
        Math.abs(dx) < Math.abs(dy) * 1.5
      )
        return;
      suppressClick.current = performance.now() + 400;
      void turn(dx < 0 ? 1 : -1);
    },
  };
}
