'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Book, Paragraph, Settings } from '@/lib/types';
import {
  readReadingAnchor,
  readyContentAnchor,
  restoreReadingAnchor,
  type PendingContentAnchor,
  type ReadingAnchor,
} from './reading-layout';

export function useReaderTranslations({
  book,
  settings,
  chapterIndex,
  translations,
  contentRevision,
  version,
  getTranslation,
  getKey,
  fallbackAnchor,
  contentScope,
  pendingContentAnchor,
  root,
  surfaceReady,
}: {
  book: Book;
  settings: Settings;
  chapterIndex: number;
  translations: Record<string, string>;
  contentRevision: unknown;
  version: string;
  getTranslation: (paragraph: Paragraph) => string;
  getKey: (paragraph: Paragraph) => string;
  fallbackAnchor: ReadingAnchor;
  contentScope: string;
  pendingContentAnchor: RefObject<PendingContentAnchor | null>;
  root: RefObject<HTMLElement | null>;
  surfaceReady: boolean;
}) {
  const cache = useMemo(
    () => new Map<string, Record<string, { text: string; key: string }>>(),
    [book.id, settings.language, settings.readingMode, settings.navigationMode],
  );
  const latest = useRef({
    book,
    settings,
    getTranslation,
    getKey,
    chapterIndex,
    fallbackAnchor,
    contentScope,
  });
  latest.current = {
    book,
    settings,
    getTranslation,
    getKey,
    chapterIndex,
    fallbackAnchor,
    contentScope,
  };
  const [revision, setRevision] = useState(0);
  const anchor = useRef<ReadingAnchor | null>(null);
  const pressed = useRef(false);
  const pending = pendingContentAnchor.current;
  const snapshot = (index: number) =>
    Object.fromEntries(
      book.chapters[index].paragraphs.map((p) => [
        p.id,
        { text: getTranslation(p), key: getKey(p) },
      ]),
    );
  const chapter = book.chapters[chapterIndex];
  // Cache rendered paragraphs until an idle moment allows an anchored layout update.
  if (!cache.has(chapter.id)) cache.set(chapter.id, snapshot(chapterIndex));
  useLayoutEffect(() => {
    const element = root.current;
    if (!surfaceReady || !element) return;
    const waiting = pendingContentAnchor.current;
    const resolved = readyContentAnchor(element, waiting, contentScope);
    const captured = resolved || anchor.current;
    anchor.current = null;
    if (!captured) return;
    // Navigation also restores during layout. Finish after those layout effects
    // so a stale placeholder position cannot overwrite the recovered text offset.
    const frame = requestAnimationFrame(() => {
      if (waiting && pendingContentAnchor.current !== waiting) return;
      if (
        pressed.current ||
        element.dataset.turning === 'true' ||
        window.getSelection()?.toString().trim()
      )
        return;
      restoreReadingAnchor(element, captured);
      if (resolved && pendingContentAnchor.current === waiting) pendingContentAnchor.current = null;
      element.dispatchEvent(new Event('reader-location'));
    });
    return () => cancelAnimationFrame(frame);
  }, [revision, cache, pending, contentScope, pendingContentAnchor, root, surfaceReady]);
  useEffect(() => {
    const element = root.current;
    if (!surfaceReady || !element) return;
    let timer: ReturnType<typeof setTimeout>;
    const publish = () => {
      if (
        pressed.current ||
        element.dataset.turning === 'true' ||
        window.getSelection()?.toString().trim()
      ) {
        timer = setTimeout(publish, 400);
        return;
      }
      const current = latest.current;
      let changed = false;
      const waiting = pendingContentAnchor.current;
      anchor.current =
        (waiting?.scope === current.contentScope ? waiting.anchor : null) ||
        readReadingAnchor(element) ||
        current.fallbackAnchor;
      for (const [id, old] of cache) {
        const nextChapter = current.book.chapters.find((c) => c.id === id);
        if (!nextChapter) continue;
        const next = Object.fromEntries(
          nextChapter.paragraphs.map((p) => [
            p.id,
            { text: current.getTranslation(p), key: current.getKey(p) },
          ]),
        );
        if (!Object.values(next).some((p) => p.text)) continue;
        if (
          Object.keys(next).some(
            (id) => next[id].text !== old[id]?.text || next[id].key !== old[id]?.key,
          )
        ) {
          cache.set(id, next);
          changed = true;
        }
      }
      if (changed || readyContentAnchor(element, waiting, current.contentScope))
        setRevision((value) => value + 1);
      else anchor.current = null;
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(publish, 400);
    };
    const down = () => {
      pressed.current = true;
      clearTimeout(timer);
    };
    const up = () => {
      pressed.current = false;
      schedule();
    };
    element.addEventListener('scroll', schedule, { passive: true });
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    schedule();
    return () => {
      clearTimeout(timer);
      element.removeEventListener('scroll', schedule);
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [
    translations,
    contentRevision,
    version,
    cache,
    root,
    surfaceReady,
    chapterIndex,
    settings.navigationMode,
    pendingContentAnchor,
  ]);
  return {
    revision,
    read(index: number, paragraph: Paragraph) {
      const chapter = book.chapters[index];
      if (!cache.has(chapter.id)) cache.set(chapter.id, snapshot(index));
      return cache.get(chapter.id)?.[paragraph.id]?.text || '';
    },
    key(index: number, paragraph: Paragraph) {
      const chapter = book.chapters[index];
      if (!cache.has(chapter.id)) cache.set(chapter.id, snapshot(index));
      return cache.get(chapter.id)?.[paragraph.id]?.key || '';
    },
  };
}
