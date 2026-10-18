import { idb, localTransaction, readLocal } from './local-database';
import { libraryDatabaseName } from './storage-scope';
import {
  assembleChapter,
  chunkInput,
  mergeTerms,
  planChapter,
  translationSource,
  translationProfile,
  validateChunk,
  type TranslationManifest,
  type ChunkResult,
} from './translation-edition';
import {
  chapterKey,
  manifestKey,
  translationChanged,
  type LocalTranslationJob,
} from './translation-storage';
import type { Book, Settings } from './types';

const credentials = new Map<string, string>();
let storageBlocked = false;
export function rememberTranslationCredentials(settings: Settings) {
  const url = translationProfile(settings).baseUrl;
  if (url) credentials.set(url, settings.apiKey);
}
export type TranslationCommand = {
  action: 'prepare' | 'new' | 'pause' | 'resume' | 'select';
  chapter: number;
  scope?: 'chapter' | 'book';
  auto?: boolean;
  prefetch?: boolean;
  editionId?: string;
  requestId?: string;
};
export async function changeLocalTranslation(
  book: Book,
  settings: Settings,
  command: TranslationCommand,
) {
  if (storageBlocked && command.auto) return;
  rememberTranslationCredentials(settings);
  const source = await translationSource(book);
  const key = manifestKey(book.id, settings.language);
  await localTransaction(
    'readwrite',
    async (tx) => {
      if (!(await idb(tx.objectStore('books').get(book.id))))
        throw new Error('请先将书籍加入书架。');
      const store = tx.objectStore('translation-manifests');
      const manifest: TranslationManifest = (await idb(store.get(key))) || {
        selectedId: null,
        editions: [],
      };
      let edition = manifest.editions.find(
        (e) =>
          e.id ===
          (command.action === 'new' ? command.requestId : command.editionId || manifest.selectedId),
      );
      if (!edition && ['prepare', 'new'].includes(command.action)) {
        if (!settings.baseUrl || !settings.model) throw new Error('请先连接翻译模型。');
        edition = {
          id: command.requestId || crypto.randomUUID(),
          bookId: book.id,
          language: settings.language,
          sourceHash: source.hash,
          profile: translationProfile(settings),
          state: 'idle',
          createdAt: Date.now(),
          chapters: book.chapters.map((chapter, index) => ({
            index,
            sourceHash: source.chapters[index],
            state: 'missing',
            completedChunks: 0,
            totalChunks: planChapter(chapter).length,
          })),
        };
        if (command.action === 'new')
          for (const other of manifest.editions)
            if (other.state === 'active') other.state = 'paused';
        manifest.editions.unshift(edition);
        if (!manifest.selectedId) manifest.selectedId = edition.id;
      }
      if (!edition) throw new Error('没有找到这个译本。');
      const jobs = tx.objectStore('translation-jobs');
      const job: LocalTranslationJob = (await idb(jobs.get(edition.id))) || {
        editionId: edition.id,
        bookId: book.id,
        language: settings.language,
        terms: [],
        chapters: {},
      };
      if (command.action === 'select') {
        if (edition.sourceHash !== source.hash) throw new Error('原文已变化，请创建新译本。');
        const selected = manifest.editions.find((e) => e.id === manifest.selectedId);
        if (
          selected &&
          selected.id !== edition.id &&
          edition.createdAt >= selected.createdAt &&
          edition.chapters.some((c) => c.state !== 'ready')
        )
          throw new Error('新译本完成后即可切换，当前译本仍可阅读。');
        manifest.selectedId = edition.id;
      } else if (command.action === 'pause') edition.state = 'paused';
      else if (!(command.auto && ['paused', 'error'].includes(edition.state))) {
        if (edition.sourceHash !== source.hash) throw new Error('原文已变化，请创建新译本。');
        const indices =
          command.scope === 'book' || command.action === 'new'
            ? book.chapters.map((_, i) => i)
            : [
                command.chapter,
                ...(command.prefetch === false ? [] : [command.chapter + 1]),
              ].filter((i) => i < book.chapters.length);
        if (command.action === 'resume')
          indices.push(...edition.chapters.filter((c) => c.state === 'error').map((c) => c.index));
        for (const index of indices) {
          const chapter = edition.chapters[index];
          if (chapter.state === 'missing' || (!command.auto && chapter.state === 'error')) {
            chapter.state = 'queued';
            chapter.error = undefined;
            job.chapters[index] = {
              results: job.chapters[index]?.results || [],
              attempts: 0,
              retryAt: 0,
              priority: 0,
            };
          }
        }
        if (job.chapters[command.chapter]) job.chapters[command.chapter].priority = Date.now();
        edition.state = edition.chapters.some((c) => ['queued', 'running'].includes(c.state))
          ? 'active'
          : 'idle';
        edition.error = undefined;
      }
      await idb(jobs.put(job, edition.id));
      await idb(store.put(manifest, key));
    },
    ['books', 'translation-manifests', 'translation-jobs'],
  );
  storageBlocked = false;
  translationChanged();
}

async function runLocalChunk() {
  if (!navigator.onLine) return;
  const jobs = await localTransaction(
    'readonly',
    (tx) => idb(tx.objectStore('translation-jobs').getAll()) as Promise<LocalTranslationJob[]>,
    ['translation-jobs'],
  );
  for (const job of jobs) {
    const key = manifestKey(job.bookId, job.language);
    const manifest = await readLocal<TranslationManifest>('translation-manifests', key);
    const edition = manifest?.editions.find((e) => e.id === job.editionId);
    if (!edition || edition.state !== 'active') continue;
    const chapter = edition.chapters
      .filter(
        (c) =>
          ['queued', 'running'].includes(c.state) &&
          (job.chapters[c.index]?.retryAt || 0) <= Date.now(),
      )
      .sort(
        (a, b) =>
          (job.chapters[b.index]?.priority || 0) - (job.chapters[a.index]?.priority || 0) ||
          a.index - b.index,
      )[0];
    if (!chapter) continue;
    const book = await readLocal<Book>('books', job.bookId);
    if (!book) continue;
    const checkpoint = job.chapters[chapter.index];
    if (!checkpoint) continue;
    let result: ChunkResult | undefined,
      failure: string | undefined,
      retryable = true;
    const chunks = planChapter(book.chapters[chapter.index]);
    try {
      const source = await translationSource(book);
      if (source.hash !== edition.sourceHash) throw new Error('原文已变化，请创建新译本。');
      const response = await fetch('/api/translations/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: chunkInput(
            book,
            chapter.index,
            edition.language,
            chunks[checkpoint.results.length],
            job.terms,
            checkpoint.results.at(-1),
          ),
          profile: edition.profile,
          apiKey: credentials.get(edition.profile.baseUrl) || '',
        }),
        signal: AbortSignal.timeout(130000),
      });
      const data = await response.json();
      if (!response.ok) {
        retryable = data.retryable ?? response.status >= 500;
        throw new Error(data.error || '翻译暂时不可用。');
      }
      result = validateChunk(data, chunks[checkpoint.results.length]);
    } catch (error) {
      failure = error instanceof Error ? error.message : '翻译连接中断，已保留完成的部分。';
    }
    await localTransaction(
      'readwrite',
      async (tx) => {
        const store = tx.objectStore('translation-manifests');
        const current: TranslationManifest | undefined = await idb(store.get(key));
        const target = current?.editions.find((e) => e.id === edition.id);
        const latest: LocalTranslationJob | undefined = await idb(
          tx.objectStore('translation-jobs').get(edition.id),
        );
        if (!current || !target || !latest || !(await idb(tx.objectStore('books').get(book.id))))
          return;
        const saved = latest.chapters[chapter.index],
          progress = target.chapters[chapter.index];
        if (!saved || saved.results.length !== checkpoint.results.length) return;
        if (result) {
          saved.results.push(result);
          saved.attempts = 0;
          saved.retryAt = 0;
          latest.terms = mergeTerms(latest.terms, result.terms);
          progress.completedChunks = saved.results.length;
          progress.error = undefined;
          if (saved.results.length === chunks.length) {
            const paragraphs = assembleChapter(book.chapters[chapter.index], chunks, saved.results);
            await idb(
              tx.objectStore('chapter-translations').put(
                {
                  editionId: target.id,
                  bookId: book.id,
                  index: chapter.index,
                  sourceHash: chapter.sourceHash,
                  paragraphs,
                },
                chapterKey(target.id, chapter.index),
              ),
            );
            progress.state = 'ready';
            saved.results = [];
          } else progress.state = 'queued';
        } else {
          saved.attempts++;
          saved.retryAt = Date.now() + saved.attempts * 10000;
          progress.error = failure;
          if (!retryable || saved.attempts >= 3) {
            progress.state = 'error';
            target.error = failure;
            if (target.state !== 'paused') target.state = 'error';
          }
        }
        if (
          target.state === 'active' &&
          !target.chapters.some((c) => ['queued', 'running'].includes(c.state))
        )
          target.state = 'idle';
        await idb(store.put(current, key));
        await idb(tx.objectStore('translation-jobs').put(latest, latest.editionId));
      },
      ['books', 'translation-manifests', 'translation-jobs', 'chapter-translations'],
    );
    translationChanged();
    return;
  }
}
let running = false;
export function startLocalTranslationRunner() {
  let stopped = false,
    timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (!running && !stopped && !storageBlocked) {
      running = true;
      try {
        // Cross-tab serialization. A browser without Web Locks must not run an
        // unsafe, duplicate paid job; supported browsers expose this on localhost/HTTPS.
        if (navigator.locks)
          await navigator.locks.request(
            `translation:${libraryDatabaseName()}`,
            { ifAvailable: true },
            async (lock) => {
              if (lock) await runLocalChunk();
            },
          );
      } catch {
        storageBlocked = true;
        window.dispatchEvent(new Event('bypage-translation-storage-error'));
      } finally {
        running = false;
      }
    }
    if (!stopped) timer = setTimeout(() => void tick(), 1500);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
