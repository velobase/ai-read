import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AIRequestError, streamAI, translationKey } from './ai';
import type { Book, Chapter, Paragraph, Settings } from './types';

type TranslationState = {
  status: 'idle' | 'translating' | 'retrying' | 'offline' | 'paused' | 'error';
  streaming: { id: string; text: string; minHeight: number } | null;
  error?: string;
};
type Options = {
  book: Book;
  chapter: Chapter;
  settings: Settings;
  enabled: boolean;
  readerRef: RefObject<HTMLElement | null>;
  getTranslation: (paragraph: Paragraph) => string | undefined;
  onComplete: (key: string, value: string) => void;
};

// A session owns one request at a time. Scrolling changes its queue, while chat
// keeps its own controller and remains usable throughout background translation.
export function useAutomaticTranslation(options: Options) {
  const { book, chapter, settings, enabled, readerRef } = options;
  const callbacks = useRef(options);
  useLayoutEffect(() => {
    callbacks.current = options;
  });
  const [state, setState] = useState<TranslationState>({ status: 'idle', streaming: null });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const root = readerRef.current;
    if (!enabled || !root) {
      setState({ status: 'idle', streaming: null });
      return;
    }
    let disposed = false;
    let blocked = false;
    let queue: Paragraph[] = [];
    let running: { id: string; controller: AbortController } | null = null;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const completed = new Set<string>();
    const failures = new Map<string, { attempts: number; retryAt: number }>();
    const available = () => !document.hidden && navigator.onLine;
    const currentSession = () => {
      const current = callbacks.current;
      return (
        !disposed &&
        current.enabled &&
        current.book === book &&
        current.chapter === chapter &&
        current.settings.baseUrl === settings.baseUrl &&
        current.settings.model === settings.model &&
        current.settings.apiKey === settings.apiKey &&
        current.settings.language === settings.language &&
        current.settings.readingMode === settings.readingMode
      );
    };
    const cached = (p: Paragraph) => completed.has(p.id) || callbacks.current.getTranslation(p);
    setState({ status: 'idle', streaming: null });

    async function pump() {
      if (!currentSession() || running || blocked || !available()) return;
      clearTimeout(retryTimer);
      const pending = queue.filter((p) => !cached(p));
      const p = pending.find((item) => (failures.get(item.id)?.retryAt || 0) <= Date.now());
      if (!p) {
        setState({ status: pending.length ? 'retrying' : 'idle', streaming: null });
        if (pending.length) {
          const next = Math.min(...pending.map((item) => failures.get(item.id)!.retryAt));
          retryTimer = setTimeout(() => void pump(), Math.max(50, next - Date.now()));
        }
        return;
      }
      const controller = new AbortController();
      running = { id: p.id, controller };
      const passage = Array.from(root!.querySelectorAll<HTMLElement>('[data-paragraph]')).find(
        (element) => element.dataset.paragraph === p.id,
      );
      // Keep the original/placeholder's space until a streamed translation is complete.
      const minHeight =
        passage?.querySelector('[data-translation]')?.getBoundingClientRect().height || 0;
      setState({ status: 'translating', streaming: { id: p.id, text: '', minHeight } });
      try {
        const index = chapter.paragraphs.findIndex((item) => item.id === p.id);
        const sources = chapter.paragraphs
          .slice(Math.max(0, index - 2), index + 2)
          .map((item) => ({ id: item.id, chapter: chapter.title, text: item.text }));
        const value = await streamAI(
          settings,
          { action: 'translate', title: book.title, target: p.text, sources },
          controller.signal,
          (text) => {
            if (currentSession() && !controller.signal.aborted)
              setState({ status: 'translating', streaming: { id: p.id, text, minHeight } });
          },
        );
        if (!currentSession() || controller.signal.aborted) return;
        completed.add(p.id);
        failures.delete(p.id);
        callbacks.current.onComplete(translationKey(settings, p.id), value);
      } catch (error) {
        if (!currentSession() || controller.signal.aborted) return;
        const attempts = (failures.get(p.id)?.attempts || 0) + 1;
        const retryable = !(error instanceof AIRequestError) || error.retryable;
        if (!retryable || attempts >= 3) {
          blocked = true;
          setState({
            status: 'error',
            streaming: null,
            error: error instanceof Error ? error.message : '译文暂时无法生成。',
          });
        } else {
          failures.set(p.id, { attempts, retryAt: Date.now() + (attempts === 1 ? 2000 : 6000) });
        }
      } finally {
        running = null;
        if (currentSession() && !blocked) scan();
      }
    }

    function scan() {
      if (!currentSession()) return;
      clearTimeout(scanTimer);
      if (!available()) {
        running?.controller.abort();
        clearTimeout(retryTimer);
        if (!blocked)
          setState({ status: navigator.onLine ? 'paused' : 'offline', streaming: null });
        return;
      }
      const bounds = root!.getBoundingClientRect();
      const elements = Array.from(root!.querySelectorAll<HTMLElement>('[data-paragraph]'));
      const visible = elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > bounds.top + 24 && rect.top < bounds.bottom - 24;
      });
      // At the chapter heading, prepare the first passage before it enters view.
      const first =
        visible[0] || elements.find((element) => element.getBoundingClientRect().top >= bounds.top);
      const ids = new Set(visible.map((element) => element.dataset.paragraph));
      if (first) ids.add(first.dataset.paragraph);
      const visibleParagraphs = chapter.paragraphs.filter((p) => ids.has(p.id));
      const last = visibleParagraphs.at(-1);
      const lastIndex = last ? chapter.paragraphs.findIndex((p) => p.id === last.id) : -1;
      queue = [
        ...visibleParagraphs,
        ...(lastIndex >= 0 ? chapter.paragraphs.slice(lastIndex + 1, lastIndex + 4) : []),
      ];
      if (running && !queue.some((p) => p.id === running!.id)) {
        running.controller.abort();
        setState({ status: 'idle', streaming: null });
      }
      void pump();
    }
    function scheduleScan() {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scan, 150);
    }
    const resize = new ResizeObserver(scheduleScan);
    resize.observe(root);
    const page = root.querySelector('[data-book-page]');
    if (page) resize.observe(page);
    root.addEventListener('scroll', scheduleScan, { passive: true });
    window.addEventListener('online', scan);
    window.addEventListener('offline', scan);
    document.addEventListener('visibilitychange', scan);
    // Allow position restoration and the first layout to settle before issuing a request.
    scheduleScan();
    return () => {
      disposed = true;
      running?.controller.abort();
      clearTimeout(scanTimer);
      clearTimeout(retryTimer);
      resize.disconnect();
      root.removeEventListener('scroll', scheduleScan);
      window.removeEventListener('online', scan);
      window.removeEventListener('offline', scan);
      document.removeEventListener('visibilitychange', scan);
    };
  }, [
    book,
    chapter,
    enabled,
    settings.baseUrl,
    settings.model,
    settings.apiKey,
    settings.language,
    settings.readingMode,
    readerRef,
    revision,
  ]);

  return { ...state, retry: () => setRevision((value) => value + 1) };
}
