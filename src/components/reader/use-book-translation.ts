'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdentity } from '@/components/auth/identity-provider';
import { storageUserId } from '@/lib/storage-scope';
import { translationFingerprint } from '@/lib/translation-prompt';
import { selectLegacyTranslations } from '@/lib/translation-selection';
import { readSavedTranslationSnapshot } from '@/lib/saved-translation-storage';
import { sameData } from '@/lib/sync-types';
import { translateReadingParagraph } from '@/lib/reading-translation';
import { AIRequestError } from '@/lib/ai';
import {
  cacheChapterTranslation,
  cacheManifest,
  readChapterTranslation,
  cachedChapterIndices,
  readManifest,
} from '@/lib/translation-storage';
import {
  editionNoteKey,
  matchesTranslationSource,
  translationSource,
  type ChapterTranslation,
  type TranslationManifest,
} from '@/lib/translation-edition';
import type { Book, Settings } from '@/lib/types';
import {
  sameReadingLanguage,
  effectiveBookLanguage,
  translationBookFingerprint,
  translationChapterFingerprint,
} from '../../../packages/reading-core/src';

const empty: TranslationManifest = { selectedId: null, editions: [] };
const readableText = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 1024 * 1024;
function usableArtifact(
  value: ChapterTranslation | undefined,
  book: Book,
  editionId: string,
  index: number,
  hashes: { chapters: string[]; fingerprints: string[] },
): value is ChapterTranslation {
  const chapter = book.chapters[index];
  return !!(
    value &&
    chapter &&
    value.bookId === book.id &&
    value.editionId === editionId &&
    value.index === index &&
    matchesTranslationSource(value, hashes.chapters[index], hashes.fingerprints[index]) &&
    value.paragraphs &&
    typeof value.paragraphs === 'object' &&
    !Array.isArray(value.paragraphs) &&
    Object.keys(value.paragraphs).length === chapter.paragraphs.length &&
    chapter.paragraphs.every((p) => readableText(value.paragraphs[p.id]))
  );
}
async function api(bookId: string, language: string, query: Record<string, string> = {}) {
  const response = await fetch(
    '/api/translations?' + new URLSearchParams({ bookId, language, ...query }),
    {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'x-reader-user': storageUserId() || '',
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error('已保存的译文暂时无法读取，请重试。', {
      cause: { status: response.status, response: value },
    });
  return value;
}

export function useBookTranslation(
  book: Book,
  settings: Settings,
  options: {
    chapter: number;
    paragraph: string;
    auto: boolean;
    enabled: boolean;
    connectionReady: boolean;
    legacy?: Record<string, string>;
  },
) {
  const { enabled: accounts, user } = useIdentity();
  const scope = `${book.id}:${settings.language}`;
  const sameLanguage = sameReadingLanguage(effectiveBookLanguage(book), settings.language);
  const [data, setData] = useState<{
    scope: string;
    manifest: TranslationManifest;
    chapters: ChapterTranslation[];
    cached: number;
    cachedIndices: number[];
    loaded: boolean;
  }>({ scope: '', manifest: empty, chapters: [], cached: 0, cachedIndices: [], loaded: false });
  const [remote, setRemote] = useState<{
    book?: Book;
    scope: string;
    chapter: number;
    userId?: string;
  }>({ scope: '', chapter: -1 });
  const remoteReady =
    !accounts ||
    !user ||
    (remote.book === book &&
      remote.scope === scope &&
      remote.chapter === options.chapter &&
      remote.userId === user.id);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setError('');
  }, [scope]);
  const manifest = data.scope === scope ? data.manifest : empty;
  const edition = manifest.editions.find((e) => e.id === manifest.selectedId);
  const source = useMemo(
    async () => ({
      ...(await translationSource(book)),
      fingerprint: translationBookFingerprint(book),
      fingerprints: book.chapters.map(translationChapterFingerprint),
    }),
    [book],
  );
  const chapters = data.scope === scope ? data.chapters : [];
  const artifacts = useMemo(() => new Map(chapters.map((c) => [c.index, c])), [chapters]);
  const [exact, setExact] = useState<{
    book?: Book;
    scope: string;
    snapshot?: Awaited<ReturnType<typeof readSavedTranslationSnapshot>>;
    loaded: boolean;
    failed?: boolean;
  }>({ scope: '', loaded: false });
  const exactCurrent = exact.book === book && exact.scope === scope;
  const exactLoaded = exactCurrent && exact.loaded;
  const exactReadable = exactLoaded && !exact.failed;
  useEffect(() => {
    if (!options.enabled) return;
    let disposed = false;
    let request = 0;
    const update = async () => {
      const token = ++request;
      try {
        const snapshot = await readSavedTranslationSnapshot(book);
        if (!disposed && token === request)
          setExact((previous) => {
            const old = previous.snapshot;
            if (
              previous.book === book &&
              previous.scope === scope &&
              !previous.failed &&
              old &&
              old.versions.size === snapshot.versions.size &&
              [...snapshot.versions].every(([key, value]) => {
                const before = old.versions.get(key);
                return (
                  before?.textHash === value.textHash &&
                  before.sourceFingerprint === value.sourceFingerprint
                );
              }) &&
              sameData(old.selections, snapshot.selections)
            )
              return previous;
            return { book, scope, snapshot, loaded: true };
          });
      } catch (error) {
        console.error('Saved translation selection could not be loaded', error);
        if (!disposed && token === request) {
          setExact({ book, scope, loaded: true, failed: true });
          setError(error instanceof Error ? error.message : '译本暂时无法读取。');
        }
      }
    };
    const changed = () => {
      void update();
    };
    const stored = (event: StorageEvent) => {
      if (event.key === 'ai-read-data-change') changed();
    };
    window.addEventListener('ai-read-library-change', changed);
    window.addEventListener('storage', stored);
    changed();
    return () => {
      disposed = true;
      window.removeEventListener('ai-read-library-change', changed);
      window.removeEventListener('storage', stored);
    };
  }, [book, scope, options.enabled, user?.id, refresh]);
  const legacy = useMemo(() => {
    const result = selectLegacyTranslations(
      book,
      settings.language,
      options.legacy || {},
      translationFingerprint(settings),
    );
    for (const [index, artifact] of artifacts) {
      result.set(index, {
        texts: { ...artifact.paragraphs },
        keys: Object.fromEntries(
          Object.keys(artifact.paragraphs).map((id) => [
            id,
            editionNoteKey(settings.language, id, artifact.editionId),
          ]),
        ),
        complete: true,
      });
    }
    if (exactCurrent && exact.snapshot) {
      for (const selection of exact.snapshot.selections) {
        if (selection.language !== settings.language) continue;
        const version = exact.snapshot.versions.get(selection.key);
        if (!version) continue;
        const chapter = result.get(version.chapterIndex) || {
          texts: Object.create(null),
          keys: Object.create(null),
          complete: false,
        };
        chapter.texts[version.paragraphId] = version.text;
        chapter.keys[version.paragraphId] = version.key;
        result.set(version.chapterIndex, chapter);
      }
      for (const [index, chapter] of result)
        chapter.complete = book.chapters[index].paragraphs.every((p) => !!chapter.texts[p.id]);
    }
    return result;
  }, [
    book,
    options.legacy,
    settings.language,
    settings.baseUrl,
    settings.model,
    settings.translationPrompt,
    exactCurrent,
    exact.snapshot,
    artifacts,
  ]);
  const contentRevision = useMemo(
    () => [chapters, legacy, exactCurrent ? exact.snapshot : undefined],
    [chapters, legacy, exactCurrent, exact.snapshot],
  );
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!options.enabled) return;
    let disposed = false,
      syncing = false;
    let remoteAt = 0;
    const invalidCached = new Set<string>();
    const local = async () => {
      const next = await readManifest(book.id, settings.language);
      const hashes = await source;
      const selected = next.editions.find(
        (e) =>
          e.id === next.selectedId &&
          e.bookId === book.id &&
          e.language === settings.language &&
          matchesTranslationSource(e, hashes.hash, hashes.fingerprint),
      );
      const indices = selected
        ? (await cachedChapterIndices(selected.id)).filter(
            (index) => Number.isSafeInteger(index) && index >= 0 && !!book.chapters[index],
          )
        : [];
      const window = indices.filter((index) => Math.abs(index - options.chapter) <= 2);
      const cached: ChapterTranslation[] = [];
      if (selected)
        for (const index of window) {
          const artifact = await readChapterTranslation(selected.id, index);
          const key = JSON.stringify([selected.id, index]);
          if (usableArtifact(artifact, book, selected.id, index, hashes)) {
            invalidCached.delete(key);
            cached.push(artifact);
          } else invalidCached.add(key);
        }
      const validIndices = selected
        ? indices.filter((index) => !invalidCached.has(JSON.stringify([selected.id, index])))
        : [];
      const value = {
        scope,
        manifest: next,
        chapters: cached,
        cached: validIndices.length,
        cachedIndices: validIndices,
        loaded: true,
      };
      if (!disposed)
        setData((old) =>
          sameData(old, value)
            ? old
            : {
                ...value,
                chapters: sameData(old.chapters, value.chapters) ? old.chapters : value.chapters,
              },
        );
    };
    const sync = async () => {
      if (disposed || syncing) return;
      syncing = true;
      try {
        await local();
        if (accounts && user && navigator.onLine && !document.hidden && Date.now() >= remoteAt) {
          remoteAt = Date.now() + 15000;
          const next: TranslationManifest = await api(book.id, settings.language);
          remoteAt = Date.now() + 30000;
          if (disposed) return;
          await cacheManifest(book.id, settings.language, next);
          await local();
          const hashes = await source;
          // Resolve existing saved text around this position before generating missing paragraphs.
          for (const e of next.editions.filter((edition) => edition.id === next.selectedId)) {
            if (
              e.bookId !== book.id ||
              e.language !== settings.language ||
              !matchesTranslationSource(e, hashes.hash, hashes.fingerprint)
            )
              continue;
            const cached = new Set(await cachedChapterIndices(e.id));
            const ordered = [...e.chapters].sort(
              (a, b) => Math.abs(a.index - options.chapter) - Math.abs(b.index - options.chapter),
            );
            for (const chapter of ordered) {
              if (disposed) return;
              if (
                chapter.state !== 'ready' ||
                !Number.isSafeInteger(chapter.index) ||
                chapter.index < 0 ||
                Math.abs(chapter.index - options.chapter) > 2 ||
                !book.chapters[chapter.index] ||
                !matchesTranslationSource(
                  chapter,
                  hashes.chapters[chapter.index],
                  hashes.fingerprints[chapter.index],
                )
              )
                continue;
              if (
                cached.has(chapter.index) &&
                !invalidCached.has(JSON.stringify([e.id, chapter.index]))
              )
                continue;
              const artifact: ChapterTranslation = await api(book.id, settings.language, {
                editionId: e.id,
                chapter: String(chapter.index),
              });
              if (disposed) return;
              if (!usableArtifact(artifact, book, e.id, chapter.index, hashes))
                throw new Error('已保存的译文未能完整读取，请重试。');
              await cacheChapterTranslation(artifact, e.language);
              invalidCached.delete(JSON.stringify([e.id, chapter.index]));
              if (e.id === next.selectedId) await local();
            }
          }
          if (!disposed) {
            setRemote({ book, scope, chapter: options.chapter, userId: user.id });
            setError('');
          }
        }
      } catch (error) {
        console.error('Saved translation content could not be loaded', error);
        if (!disposed) setError(error instanceof Error ? error.message : '译本暂时无法读取。');
      } finally {
        syncing = false;
      }
    };
    const update = () => {
      setOnline(navigator.onLine);
      remoteAt = 0;
      void sync();
    };
    const localUpdate = () => {
      void local().catch((cause) => {
        console.error('Saved translations could not be loaded', cause);
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    };
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bypage-translations');
    if (channel) channel.onmessage = localUpdate;
    window.addEventListener('bypage-translations', localUpdate);
    window.addEventListener('ai-read-library-change', localUpdate);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('focus', update);
    const interval = setInterval(() => void sync(), 5000);
    update();
    return () => {
      disposed = true;
      clearInterval(interval);
      channel?.close();
      window.removeEventListener('bypage-translations', localUpdate);
      window.removeEventListener('ai-read-library-change', localUpdate);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('focus', update);
    };
  }, [scope, options.enabled, options.chapter, accounts, user?.id, source, refresh]);

  const text = (index: number, paragraphId: string) =>
    legacy.get(index)?.texts[paragraphId] || artifacts.get(index)?.paragraphs[paragraphId] || '';
  const key = (index: number, paragraphId: string) =>
    legacy.get(index)?.keys[paragraphId] ||
    (artifacts.has(index) && edition
      ? editionNoteKey(settings.language, paragraphId, edition.id)
      : '');
  const loaded = data.scope === scope && data.loaded && exactLoaded;
  const entries = useMemo(
    () =>
      book.chapters.flatMap((chapter, index) =>
        chapter.paragraphs.map((paragraph) => ({ index, paragraph })),
      ),
    [book],
  );
  const at = Math.max(
    0,
    entries.findIndex((entry) => entry.paragraph.id === options.paragraph),
  );
  const targets = entries.slice(at, at + 3);
  const windowKey = targets.map((entry) => entry.paragraph.id).join('\0');
  const bookFingerprint = useMemo(() => translationBookFingerprint(book), [book]);
  const context = `${scope}:${bookFingerprint}:${effectiveBookLanguage(book)}:${translationFingerprint(settings)}`;
  const running = useRef<{ context: string; id: string; controller: AbortController } | null>(null);
  const failures = useRef(
    new Map<string, { attempts: number; error: string; retryAt: number; network: boolean }>(),
  );
  const completed = useRef(new Set<string>());
  const allowed =
    options.auto &&
    options.enabled &&
    !sameLanguage &&
    online &&
    visible &&
    loaded &&
    exactReadable &&
    remoteReady;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      running.current?.controller.abort();
    };
  }, []);
  useEffect(() => {
    const active = running.current;
    if (
      active &&
      (!allowed ||
        active.context !== context ||
        !targets.some((entry) => entry.paragraph.id === active.id))
    ) {
      active.controller.abort();
      return;
    }
    if (active || !allowed || !options.connectionReady || (accounts && !user)) return;
    const target = targets.find(
      ({ index, paragraph }) =>
        paragraph.text.trim() &&
        !text(index, paragraph.id) &&
        !completed.current.has(`${context}:${paragraph.id}`),
    );
    if (!target) return;
    const targetKey = `${context}:${target.paragraph.id}`;
    const failed = failures.current.get(targetKey);
    if (failed && !failed.retryAt) return;
    if (failed && failed.retryAt > Date.now()) {
      const timer = setTimeout(() => setTick((value) => value + 1), failed.retryAt - Date.now());
      return () => clearTimeout(timer);
    }
    const controller = new AbortController();
    const operation = { context, id: target.paragraph.id, controller };
    running.current = operation;
    void translateReadingParagraph(
      book,
      target.index,
      target.paragraph.id,
      settings,
      controller.signal,
    )
      .then(() => {
        if (!controller.signal.aborted) {
          completed.current.add(targetKey);
          failures.current.delete(targetKey);
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Reading translation failed', {
          bookId: book.id,
          paragraphId: target.paragraph.id,
          cause,
        });
        const attempts = (failures.current.get(targetKey)?.attempts || 0) + 1;
        const retryable =
          cause instanceof TypeError ||
          (cause instanceof AIRequestError && cause.retryable) ||
          (cause instanceof DOMException && cause.name === 'TimeoutError');
        failures.current.set(targetKey, {
          attempts,
          error: '这段暂时没有翻译成功，请重试。',
          network: cause instanceof TypeError,
          retryAt: retryable && attempts < 3 ? Date.now() + (attempts === 1 ? 1000 : 3000) : 0,
        });
      })
      .finally(() => {
        if (running.current === operation) running.current = null;
        if (mounted.current) setTick((value) => value + 1);
      });
  }, [allowed, context, windowKey, options.connectionReady, accounts, user, contentRevision, tick]);
  // Reconnection resumes interrupted network work, while terminal service errors require Retry.
  useEffect(() => {
    const connected = () => {
      for (const [key, failure] of failures.current)
        if (failure.network) failures.current.delete(key);
      setTick((value) => value + 1);
    };
    globalThis.window.addEventListener('online', connected);
    return () => globalThis.window.removeEventListener('online', connected);
  }, []);
  const currentFailure = targets
    .map(({ paragraph }) => failures.current.get(`${context}:${paragraph.id}`))
    .find((failure) => failure && !failure.retryAt);
  return {
    sameLanguage,
    loaded,
    online,
    error:
      error ||
      currentFailure?.error ||
      (options.auto && loaded && !options.connectionReady ? '翻译暂时不可用，请稍后重试。' : ''),
    retry() {
      window.dispatchEvent(new Event('ai-read-refresh-connection'));
      for (const { paragraph } of targets) {
        failures.current.delete(`${context}:${paragraph.id}`);
        completed.current.delete(`${context}:${paragraph.id}`);
      }
      setError('');
      setRefresh((value) => value + 1);
      setTick((value) => value + 1);
    },
    text,
    key,
    revision: contentRevision,
    version: manifest.selectedId || 'legacy',
  };
}
export type BookTranslationController = ReturnType<typeof useBookTranslation>;
