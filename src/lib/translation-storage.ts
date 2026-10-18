import { idb, localTransaction, readLocal } from './local-database';
import type {
  ChapterTranslation,
  ChunkResult,
  Term,
  TranslationManifest,
} from './translation-edition';

export const manifestKey = (bookId: string, language: string) => JSON.stringify([bookId, language]);
export const chapterKey = (editionId: string, index: number): [string, number] => [
  editionId,
  index,
];
export type LocalTranslationJob = {
  editionId: string;
  bookId: string;
  language: string;
  terms: Term[];
  chapters: Record<
    number,
    { results: ChunkResult[]; priority: number; attempts: number; retryAt: number }
  >;
};
export function translationChanged() {
  window.dispatchEvent(new Event('bypage-translations'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('bypage-translations');
    channel.postMessage('changed');
    channel.close();
  }
}
export const readManifest = async (
  bookId: string,
  language: string,
): Promise<TranslationManifest> =>
  (await readLocal<TranslationManifest>(
    'translation-manifests',
    manifestKey(bookId, language),
  )) || { selectedId: null, editions: [] };
export async function cacheManifest(
  bookId: string,
  language: string,
  manifest: TranslationManifest,
) {
  await localTransaction(
    'readwrite',
    async (tx) => {
      // Do not resurrect caches after a book was removed while a fetch was pending.
      if (!(await idb(tx.objectStore('books').get(bookId)))) return;
      await idb(
        tx.objectStore('translation-manifests').put(manifest, manifestKey(bookId, language)),
      );
    },
    ['books', 'translation-manifests'],
  );
}
export const readChapterTranslation = (editionId: string, index: number) =>
  readLocal<ChapterTranslation>('chapter-translations', chapterKey(editionId, index));
export const cachedChapterIndices = (editionId: string) =>
  localTransaction(
    'readonly',
    async (tx) =>
      (
        await idb(
          tx
            .objectStore('chapter-translations')
            .getAllKeys(IDBKeyRange.bound([editionId, 0], [editionId, Number.MAX_SAFE_INTEGER])),
        )
      ).map((key) => Number((key as [string, number])[1])),
    ['chapter-translations'],
  );
export async function cacheChapterTranslation(chapter: ChapterTranslation) {
  await localTransaction(
    'readwrite',
    async (tx) => {
      if (!(await idb(tx.objectStore('books').get(chapter.bookId)))) return;
      await idb(
        tx
          .objectStore('chapter-translations')
          .put(chapter, chapterKey(chapter.editionId, chapter.index)),
      );
    },
    ['books', 'chapter-translations'],
  );
}
export async function removeBookTranslations(tx: IDBTransaction, bookId: string) {
  for (const name of ['translation-manifests', 'chapter-translations', 'translation-jobs']) {
    const store = tx.objectStore(name);
    const keys = await idb(store.getAllKeys());
    for (const key of keys) {
      const value = await idb(store.get(key));
      if (
        value?.bookId === bookId ||
        (name === 'translation-manifests' && JSON.parse(String(key))[0] === bookId)
      )
        await idb(store.delete(key));
    }
  }
}
