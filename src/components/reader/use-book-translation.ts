'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdentity } from '@/components/auth/identity-provider';
import { storageUserId } from '@/lib/storage-scope';
import { localTransaction } from '@/lib/local-database';
import { ensureLocalBook } from '@/lib/sync-storage';
import { translationKey } from '@/lib/ai';
import { sameData } from '@/lib/sync-types';
import {
  changeLocalTranslation,
  rememberTranslationCredentials,
  type TranslationCommand,
} from '@/lib/local-translation-runner';
import {
  cacheChapterTranslation,
  cacheManifest,
  readChapterTranslation,
  cachedChapterIndices,
  readManifest,
  translationChanged,
} from '@/lib/translation-storage';
import {
  editionNoteKey,
  translationSource,
  translationBookSource,
  type ChapterTranslation,
  type TranslationManifest,
} from '@/lib/translation-edition';
import type { Book, Settings } from '@/lib/types';

const empty: TranslationManifest = { selectedId: null, editions: [] };
async function api(
  bookId: string,
  language: string,
  query: Record<string, string> = {},
  command?: TranslationCommand,
  book?: Book,
) {
  const response = await fetch(
    '/api/translations?' + new URLSearchParams({ bookId, language, ...query }),
    {
      method: command ? 'POST' : 'GET',
      cache: 'no-store',
      headers: {
        'x-reader-user': storageUserId() || '',
        ...(command ? { 'Content-Type': 'application/json' } : {}),
      },
      body: command
        ? JSON.stringify({
            bookId,
            language,
            ...command,
            ...(book ? { sourceHash: (await translationSource(book)).hash } : {}),
            ...((command.action === 'prepare' || command.action === 'new') && book
              ? { book: translationBookSource(book) }
              : {}),
          })
        : undefined,
      signal: AbortSignal.timeout(30000),
    },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '译文任务暂时不可用。');
  return value;
}

export function useBookTranslation(
  book: Book,
  settings: Settings,
  options: {
    chapter: number;
    auto: boolean;
    enabled: boolean;
    legacy?: Record<string, string>;
  },
) {
  const { enabled: accounts, user } = useIdentity();
  const scope = `${book.id}:${settings.language}`;
  const [data, setData] = useState<{
    scope: string;
    manifest: TranslationManifest;
    chapters: ChapterTranslation[];
    cached: number;
    loaded: boolean;
  }>({ scope: '', manifest: empty, chapters: [], cached: 0, loaded: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [autoTick, setAutoTick] = useState(0);
  const operation = useRef(false);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => {
    setError('');
  }, [scope]);
  const manifest = data.scope === scope ? data.manifest : empty;
  const edition = manifest.editions.find((e) => e.id === manifest.selectedId);
  const work = manifest.editions[0] || edition;
  const source = useMemo(() => translationSource(book), [book]);
  const chapters = data.scope === scope ? data.chapters : [];
  const artifacts = useMemo(() => new Map(chapters.map((c) => [c.index, c])), [chapters]);
  const legacy = useMemo(() => {
    const values = options.legacy || {};
    const firstIds = new Set(book.chapters.map((chapter) => chapter.paragraphs[0]?.id));
    const firstKeys = new Map<string, string[]>();
    for (const key of Object.keys(values)) {
      const [language, paragraphId] = key.split(':');
      if (language !== settings.language || !firstIds.has(paragraphId)) continue;
      const keys = firstKeys.get(paragraphId) || [];
      keys.push(key);
      firstKeys.set(paragraphId, keys);
    }
    const result = new Map<
      number,
      { texts: Record<string, string>; keys: Record<string, string> }
    >();
    for (const [index, chapter] of book.chapters.entries()) {
      const first = chapter.paragraphs[0];
      if (!first) continue;
      const preferred = translationKey(settings, first.id);
      const candidates = [
        preferred,
        ...(firstKeys.get(first.id) || []).filter((key) => key !== preferred),
      ];
      for (const key of candidates) {
        const suffix = key.split(':').slice(2).join(':');
        const keys = Object.fromEntries(
          chapter.paragraphs.map((p) => [p.id, `${settings.language}:${p.id}:${suffix}`]),
        );
        if (chapter.paragraphs.every((p) => !!values[keys[p.id]])) {
          result.set(index, {
            keys,
            texts: Object.fromEntries(chapter.paragraphs.map((p) => [p.id, values[keys[p.id]]])),
          });
          break;
        }
      }
    }
    return result;
  }, [
    book,
    options.legacy,
    settings.language,
    settings.baseUrl,
    settings.model,
    settings.translationPrompt,
  ]);
  useEffect(() => {
    rememberTranslationCredentials(settings);
  }, [settings]);
  useEffect(() => {
    const failed = () => setError('译文无法保存到本机，已暂停。请检查浏览器存储空间后继续。');
    window.addEventListener('bypage-translation-storage-error', failed);
    return () => window.removeEventListener('bypage-translation-storage-error', failed);
  }, []);
  useEffect(() => {
    if (!options.enabled) return;
    let disposed = false,
      syncing = false;
    let remoteAt = 0;
    const local = async () => {
      const next = await readManifest(book.id, settings.language);
      const hashes = await source;
      const selected = next.editions.find((e) => e.id === next.selectedId);
      const indices = selected ? await cachedChapterIndices(selected.id) : [];
      const window = indices.filter((index) => Math.abs(index - options.chapter) <= 2);
      const cached = selected
        ? (
            await Promise.all(window.map((index) => readChapterTranslation(selected.id, index)))
          ).filter((c): c is ChapterTranslation => !!c && c.sourceHash === hashes.chapters[c.index])
        : [];
      const value = {
        scope,
        manifest: next,
        chapters: cached,
        cached: indices.length,
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
          remoteAt = Date.now() + (next.editions.some((e) => e.state === 'active') ? 5000 : 30000);
          if (disposed) return;
          await cacheManifest(book.id, settings.language, next);
          await local();
          const hashes = await source;
          // Download completed chapters once, including the rest of a prepared
          // book, so reopening it offline does not contact a model or the server.
          for (const e of [...next.editions].sort(
            (a, b) => Number(b.id === next.selectedId) - Number(a.id === next.selectedId),
          )) {
            const cached = new Set(await cachedChapterIndices(e.id));
            const ordered = [...e.chapters].sort(
              (a, b) => Math.abs(a.index - options.chapter) - Math.abs(b.index - options.chapter),
            );
            for (const chapter of ordered) {
              if (disposed) return;
              if (
                chapter.state !== 'ready' ||
                chapter.sourceHash !== hashes.chapters[chapter.index]
              )
                continue;
              if (cached.has(chapter.index)) continue;
              const artifact: ChapterTranslation = await api(book.id, settings.language, {
                editionId: e.id,
                chapter: String(chapter.index),
              });
              if (disposed) return;
              if (artifact.sourceHash !== hashes.chapters[chapter.index]) continue;
              await cacheChapterTranslation(artifact);
              if (e.id === next.selectedId) await local();
            }
          }
          if (!disposed) setError('');
        }
      } catch (error) {
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
      void local().catch(() => {});
    };
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('bypage-translations');
    if (channel) channel.onmessage = localUpdate;
    window.addEventListener('bypage-translations', localUpdate);
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
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('focus', update);
    };
  }, [scope, options.enabled, options.chapter, accounts, user?.id, source, refresh]);

  const command = async (command: TranslationCommand) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      if (!options.enabled || (accounts && !user)) throw new Error('请先登录，再准备译文。');
      if (!accounts && !navigator.locks)
        throw new Error('当前浏览器不支持持久翻译任务，请使用新版浏览器。');
      // Built-in books may not yet have a physical local record.
      const saved = await localTransaction('readwrite', (tx) => ensureLocalBook(tx, book.id));
      if (!saved) throw new Error('这本书已被删除。');
      if (accounts) {
        const next = await api(book.id, settings.language, {}, command, book);
        await cacheManifest(book.id, settings.language, next);
      } else await changeLocalTranslation(book, settings, command);
      translationChanged();
      if (activeScope.current === scope) setRefresh((v) => v + 1);
    } catch (error) {
      if (activeScope.current === scope)
        setError(error instanceof Error ? error.message : '译文任务暂时不可用。');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const ready = (index: number) =>
    book.language.toLowerCase() === settings.language.toLowerCase() ||
    artifacts.has(index) ||
    legacy.has(index);
  const lastAuto = useRef({ key: '', at: 0 });
  useEffect(() => {
    if (!options.auto || !options.enabled) return;
    const timer = setInterval(() => setAutoTick((v) => v + 1), 5000);
    return () => clearInterval(timer);
  }, [options.auto, options.enabled]);
  useEffect(() => {
    if (
      !options.auto ||
      !options.enabled ||
      !data.loaded ||
      data.scope !== scope ||
      !online ||
      (accounts && !user) ||
      !settings.baseUrl ||
      !settings.model ||
      (edition && ['paused', 'error'].includes(edition.state))
    )
      return;
    const needs = (index: number) =>
      index < book.chapters.length && !ready(index) && edition?.chapters[index]?.state !== 'ready';
    const currentNeeds = needs(options.chapter),
      nextNeeds = needs(options.chapter + 1);
    if (!currentNeeds && !nextNeeds) return;
    const target = currentNeeds ? options.chapter : options.chapter + 1;
    const key = `${scope}:${edition?.id || ''}:${target}`;
    if (
      lastAuto.current.key === key &&
      (Date.now() - lastAuto.current.at < 4900 ||
        ['queued', 'running'].includes(edition?.chapters[target]?.state || ''))
    )
      return;
    lastAuto.current = { key, at: Date.now() };
    void command({
      action: 'prepare',
      chapter: target,
      auto: true,
      prefetch: currentNeeds && nextNeeds,
    });
  }, [
    scope,
    options.auto,
    options.enabled,
    options.chapter,
    data,
    online,
    settings.baseUrl,
    settings.model,
    autoTick,
  ]);
  return {
    manifest,
    edition,
    work,
    error,
    busy,
    online,
    loaded: data.scope === scope && data.loaded,
    command,
    ready,
    accounts,
    canPrepare: (!accounts || !!user) && !!settings.baseUrl && !!settings.model,
    sameLanguage: book.language.toLowerCase() === settings.language.toLowerCase(),
    text(index: number, paragraphId: string) {
      return (
        artifacts.get(index)?.paragraphs[paragraphId] || legacy.get(index)?.texts[paragraphId] || ''
      );
    },
    key(index: number, paragraphId: string) {
      return artifacts.has(index) && edition
        ? editionNoteKey(settings.language, paragraphId, edition.id)
        : legacy.get(index)?.keys[paragraphId] || '';
    },
    cached: data.scope === scope ? data.cached : 0,
    legacyCount: legacy.size,
    revision: chapters,
    version: edition?.id || 'legacy',
  };
}
export type BookTranslationController = ReturnType<typeof useBookTranslation>;
