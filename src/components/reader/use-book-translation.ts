'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdentity } from '@/components/auth/identity-provider';
import { storageUserId } from '@/lib/storage-scope';
import { translationFingerprint } from '@/lib/translation-prompt';
import { selectLegacyTranslations } from '@/lib/translation-selection';
import { readSavedTranslationSnapshot } from '@/lib/saved-translation-storage';
import { sameData } from '@/lib/sync-types';
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
  translationBookSource,
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
    Object.entries(value.paragraphs).every(([id, text]) =>
      chapter.paragraphs.some(
        (p) => p.id === id && (readableText(text) || (!p.text.trim() && text === p.text)),
      ),
    )
  );
}
async function api(
  book: Book,
  language: string,
  userId: string | null,
  query: Record<string, string> = {},
  command?: { chapter: number; action: 'ensure' | 'retry' },
) {
  const response = await fetch(
    command
      ? '/api/translations'
      : '/api/translations?' + new URLSearchParams({ bookId: book.id, language, ...query }),
    {
      method: command ? 'POST' : 'GET',
      cache: 'no-store',
      headers: {
        'x-reader-user': userId || '',
        ...(command ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(command
        ? { body: JSON.stringify({ book: translationBookSource(book), language, ...command }) }
        : {}),
      // This bounds a status request only; the durable worker has its own lifetime.
      signal: AbortSignal.timeout(60000),
    },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error('翻译进度暂时无法读取，请重试。', {
      cause: { status: response.status, response: value },
    });
  return value;
}

export function useBookTranslation(
  book: Book,
  settings: Settings,
  options: {
    chapter: number;
    enabled: boolean;
    legacy?: Record<string, string>;
  },
) {
  const { enabled: accounts, user } = useIdentity();
  const scope = JSON.stringify([user?.id || storageUserId(), book.id, settings.language]);
  const sameLanguage = sameReadingLanguage(effectiveBookLanguage(book), settings.language);
  const [data, setData] = useState<{
    book?: Book;
    scope: string;
    manifest: TranslationManifest;
    chapters: ChapterTranslation[];
    cached: number;
    cachedIndices: number[];
    loaded: boolean;
  }>({ scope: '', manifest: empty, chapters: [], cached: 0, cachedIndices: [], loaded: false });
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const retryRequested = useRef(false);
  useEffect(() => {
    setError('');
    retryRequested.current = false;
  }, [book, scope]);
  const dataCurrent = data.book === book && data.scope === scope;
  const manifest = dataCurrent ? data.manifest : empty;
  const edition = manifest.editions.find((e) => e.id === manifest.selectedId);
  const source = useMemo(
    async () => ({
      ...(await translationSource(book)),
      fingerprint: translationBookFingerprint(book),
      fingerprints: book.chapters.map(translationChapterFingerprint),
    }),
    [book],
  );
  const chapters = dataCurrent ? data.chapters : [];
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
      const existing = result.get(index);
      const texts = { ...existing?.texts, ...artifact.paragraphs };
      result.set(index, {
        texts,
        keys: {
          ...existing?.keys,
          ...Object.fromEntries(
            Object.keys(artifact.paragraphs).map((id) => [
              id,
              editionNoteKey(settings.language, id, artifact.editionId),
            ]),
          ),
        },
        complete: book.chapters[index].paragraphs.every((p) => !!texts[p.id]),
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
    if (!options.enabled) return;
    let disposed = false;
    const requestUserId = storageUserId();
    const active = () => !disposed && storageUserId() === requestUserId;
    let syncing = false;
    let ensured = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const local = async () => {
      const next = await readManifest(book.id, settings.language);
      if (!active()) return;
      const hashes = await source;
      if (!active()) return;
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
      if (!active()) return;
      const cached: ChapterTranslation[] = [];
      if (selected)
        for (const index of indices.filter((index) => Math.abs(index - options.chapter) <= 2)) {
          const artifact = await readChapterTranslation(selected.id, index);
          if (!active()) return;
          if (usableArtifact(artifact, book, selected.id, index, hashes)) cached.push(artifact);
        }
      const value = {
        book,
        scope,
        manifest: { ...next, selectedId: selected?.id || null },
        chapters: cached,
        cached: indices.length,
        cachedIndices: indices,
        loaded: true,
      };
      if (active())
        setData((old) =>
          old.book === book && sameData({ ...old, book: undefined }, { ...value, book: undefined })
            ? old
            : {
                ...value,
                chapters: sameData(old.chapters, cached) ? old.chapters : cached,
              },
        );
    };
    const sync = async () => {
      if (!active() || syncing) return;
      syncing = true;
      clearTimeout(timer);
      let nextPoll: number | null = 5000;
      try {
        await local();
        if (!active() || sameLanguage || !navigator.onLine || (accounts && !user)) return;
        // Creating/reusing the server job does not depend on reading mode or visibility.
        // A later chapter change only updates priority; no browser request owns the job.
        const action = retryRequested.current ? 'retry' : 'ensure';
        const next: TranslationManifest = await api(
          book,
          settings.language,
          requestUserId,
          {},
          !ensured ? { chapter: options.chapter, action } : undefined,
        );
        if (!active()) return;
        ensured = true;
        retryRequested.current = false;
        await cacheManifest(book.id, settings.language, next);
        if (!active()) return;
        await local();
        if (!active()) return;
        const hashes = await source;
        if (!active()) return;
        const selected = next.editions.find((e) => e.id === next.selectedId);
        nextPoll = selected?.state === 'ready' ? null : selected?.state === 'active' ? 2000 : 5000;
        if (selected && matchesTranslationSource(selected, hashes.hash, hashes.fingerprint)) {
          const nearby = selected.chapters
            .filter(
              (c) =>
                Number.isSafeInteger(c.index) &&
                c.index >= 0 &&
                !!book.chapters[c.index] &&
                Math.abs(c.index - options.chapter) <= 2 &&
                matchesTranslationSource(c, hashes.chapters[c.index], hashes.fingerprints[c.index]),
            )
            .sort(
              (a, b) => Math.abs(a.index - options.chapter) - Math.abs(b.index - options.chapter),
            );
          for (const chapter of nearby) {
            if (!active()) return;
            const cached = await readChapterTranslation(selected.id, chapter.index);
            if (!active()) return;
            if (
              usableArtifact(cached, book, selected.id, chapter.index, hashes) &&
              Object.keys(cached.paragraphs).length === chapter.completedChunks
            )
              continue;
            if (chapter.state !== 'ready' && chapter.completedChunks === 0) continue;
            const artifact: ChapterTranslation = await api(book, settings.language, requestUserId, {
              editionId: selected.id,
              chapter: String(chapter.index),
            });
            if (!active()) return;
            if (!usableArtifact(artifact, book, selected.id, chapter.index, hashes))
              throw new Error('已保存的译文未能完整读取，请重试。');
            await cacheChapterTranslation(artifact, selected.language);
            if (!active()) return;
            await local();
          }
        }
        if (active()) setError('');
      } catch (cause) {
        nextPoll = 5000;
        console.error('Background translation synchronization failed', { bookId: book.id, cause });
        if (active()) setError(cause instanceof Error ? cause.message : '翻译进度暂时无法读取。');
      } finally {
        syncing = false;
        if (active() && nextPoll !== null) timer = setTimeout(() => void sync(), nextPoll);
      }
    };
    const update = () => {
      setOnline(navigator.onLine);
      void sync();
    };
    const localUpdate = () => {
      void local().catch((cause) => {
        console.error('Saved translations could not be loaded', cause);
        if (active()) setError(cause instanceof Error ? cause.message : String(cause));
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
    update();
    return () => {
      // Stop observing only. The durable worker continues even if this page is closed.
      disposed = true;
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener('bypage-translations', localUpdate);
      window.removeEventListener('ai-read-library-change', localUpdate);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('focus', update);
    };
  }, [
    book,
    scope,
    options.enabled,
    options.chapter,
    accounts,
    user?.id,
    source,
    refresh,
    sameLanguage,
  ]);

  const text = (index: number, paragraphId: string) =>
    legacy.get(index)?.texts[paragraphId] || artifacts.get(index)?.paragraphs[paragraphId] || '';
  const key = (index: number, paragraphId: string) =>
    legacy.get(index)?.keys[paragraphId] ||
    (artifacts.has(index) && edition
      ? editionNoteKey(settings.language, paragraphId, edition.id)
      : '');
  const loaded = dataCurrent && data.loaded && exactLoaded;
  const completed = edition?.progress?.completed || 0;
  const total =
    edition?.progress?.total || book.chapters.reduce((n, c) => n + c.paragraphs.length, 0);
  return {
    sameLanguage,
    loaded,
    online,
    error: error || edition?.error || '',
    pending: !sameLanguage && (!accounts || !!user) && edition?.state !== 'ready',
    progress: total ? Math.min(100, Math.floor((completed / total) * 100)) : 0,
    retry() {
      retryRequested.current = true;
      setError('');
      setRefresh((value) => value + 1);
    },
    text,
    key,
    revision: contentRevision,
    version: manifest.selectedId || 'legacy',
  };
}

export type BookTranslationController = ReturnType<typeof useBookTranslation>;
