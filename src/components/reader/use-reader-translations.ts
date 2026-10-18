'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Book, Paragraph, Settings } from '@/lib/types';
import { readReadingAnchor, restoreReadingAnchor, type ReadingAnchor } from './reading-layout';

export function useReaderTranslations({
  book,
  settings,
  chapterIndex,
  translations,
  getTranslation,
  root,
}: {
  book: Book;
  settings: Settings;
  chapterIndex: number;
  translations: Record<string, string>;
  getTranslation: (paragraph: Paragraph) => string;
  root: RefObject<HTMLElement | null>;
}) {
  const cache = useMemo(
    () => new Map<string, Record<string, string>>(),
    [
      book.id,
      settings.language,
      settings.readingMode,
      settings.navigationMode,
      settings.model,
      settings.baseUrl,
      settings.translationPrompt,
    ],
  );
  const visited = useMemo(() => new Set<string>(), [cache]);
  const latest = useRef({ book, settings, getTranslation, chapterIndex });
  latest.current = { book, settings, getTranslation, chapterIndex };
  const [revision, setRevision] = useState(0);
  const anchor = useRef<ReadingAnchor | null>(null);
  const snapshot = (index: number) =>
    Object.fromEntries(book.chapters[index].paragraphs.map((p) => [p.id, getTranslation(p)]));
  const chapter = book.chapters[chapterIndex];
  // A chapter version lives through adjacent forward/back navigation.
  if (!cache.has(chapter.id)) cache.set(chapter.id, snapshot(chapterIndex));
  visited.add(chapter.id);
  useLayoutEffect(() => {
    if (anchor.current && root.current) {
      restoreReadingAnchor(root.current, anchor.current);
      root.current.dispatchEvent(new Event('reader-location'));
      anchor.current = null;
    }
  }, [revision, root]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let pressed = false;
    const publish = () => {
      if (
        pressed ||
        element.dataset.turning === 'true' ||
        window.getSelection()?.toString().trim()
      ) {
        timer = setTimeout(publish, 400);
        return;
      }
      const current = latest.current;
      let changed = false;
      anchor.current = readReadingAnchor(element);
      for (const [id, old] of cache) {
        if (current.settings.navigationMode === 'paged' && visited.has(id)) continue;
        const nextChapter = current.book.chapters.find((c) => c.id === id);
        if (!nextChapter) continue;
        const next = Object.fromEntries(
          nextChapter.paragraphs.map((p) => [p.id, current.getTranslation(p)]),
        );
        if (Object.keys(next).some((id) => next[id] !== old[id])) {
          cache.set(id, next);
          changed = true;
        }
      }
      if (changed) setRevision((value) => value + 1);
      else anchor.current = null;
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(publish, 400);
    };
    const down = () => {
      pressed = true;
      clearTimeout(timer);
    };
    const up = () => {
      pressed = false;
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
  }, [translations, cache, visited, root, chapterIndex, settings.navigationMode]);
  return {
    revision,
    pending:
      settings.readingMode !== 'original' &&
      chapter.paragraphs.some(
        (p) => getTranslation(p) && getTranslation(p) !== cache.get(chapter.id)?.[p.id],
      ),
    read(index: number, paragraph: Paragraph) {
      const chapter = book.chapters[index];
      if (!cache.has(chapter.id)) cache.set(chapter.id, snapshot(index));
      return cache.get(chapter.id)?.[paragraph.id] || '';
    },
    apply() {
      if (!root.current || root.current.dataset.turning === 'true') return;
      anchor.current = readReadingAnchor(root.current);
      cache.set(chapter.id, snapshot(chapterIndex));
      setRevision((value) => value + 1);
    },
  };
}
