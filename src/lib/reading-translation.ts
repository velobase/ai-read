import {
  effectiveBookLanguage,
  savedTranslationKey,
  translationChapterFingerprint,
  validateSavedTranslationVersion,
  validateSavedTranslationSelection,
  translationBookFingerprint,
} from '../../packages/reading-core/src';
import { AIRequestError, streamAI } from './ai';
import {
  idb,
  localTransaction,
  notifyLocalData,
  notifySyncDirty,
  readLocal,
} from './local-database';
import { createSavedTranslationRecord } from './saved-translation-storage';
import { ensureLocalBook, stage } from './sync-storage';
import { translationFingerprint } from './translation-prompt';
import { selectLegacyTranslations } from './translation-selection';
import { chapterKey, manifestKey } from './translation-storage';
import { libraryDatabaseName } from './storage-scope';
import {
  matchesTranslationSource,
  translationSource,
  type TranslationManifest,
  type ChapterTranslation,
} from './translation-edition';
import type { Book, Settings } from './types';

type Draft = { bookId: string; source: string; parts: { end: number; text: string }[] };
const aborted = () => new DOMException('Reading context changed', 'AbortError');
const sourceCache = new WeakMap<
  Book,
  Promise<
    Awaited<ReturnType<typeof translationSource>> & {
      fingerprint: string;
      fingerprints: string[];
    }
  >
>();
function bookSource(book: Book) {
  let source = sourceCache.get(book);
  if (!source) {
    source = translationSource(book).then((hashes) => ({
      ...hashes,
      fingerprint: translationBookFingerprint(book),
      fingerprints: book.chapters.map(translationChapterFingerprint),
    }));
    sourceCache.set(book, source);
  }
  return source;
}

/** Complete paragraphs only. Draft chunks never enter reading text or note anchors. */
export async function translateReadingParagraph(
  book: Book,
  index: number,
  paragraphId: string,
  settings: Settings,
  signal: AbortSignal,
) {
  const chapter = book.chapters[index];
  const paragraph = chapter.paragraphs.find((item) => item.id === paragraphId)!;
  const hashes = await bookSource(book);
  const source = hashes.fingerprints[index];
  const sourceLanguage = effectiveBookLanguage(book);
  const context = JSON.stringify([
    book.id,
    settings.language,
    paragraphId,
    sourceLanguage,
    source,
    translationFingerprint(settings),
  ]);
  const draftKey = `reading:${context}`;
  const checkBook = async (tx: IDBTransaction) => {
    if (signal.aborted) throw aborted();
    const stored: Book | undefined = await idb(tx.objectStore('books').get(book.id));
    if (
      !stored ||
      effectiveBookLanguage(stored) !== sourceLanguage ||
      !stored.chapters[index] ||
      translationChapterFingerprint(stored.chapters[index]) !== source
    )
      throw aborted();
  };
  const alreadySaved = async (tx: IDBTransaction) => {
    const selected = await idb(
      tx.objectStore('translation-selections').get([book.id, settings.language, paragraphId]),
    );
    if (selected) {
      const version = validateSavedTranslationVersion(
        book,
        await idb(tx.objectStore('translation-versions').get([book.id, selected.key])),
      );
      validateSavedTranslationSelection(book, selected, new Map([[version.key, version]]));
      return true;
    }
    const legacy = (await idb(tx.objectStore('translations').get(book.id))) || {};
    if (selectLegacyTranslations(book, settings.language, legacy).get(index)?.texts[paragraphId])
      return true;
    const manifest: TranslationManifest | undefined = await idb(
      tx.objectStore('translation-manifests').get(manifestKey(book.id, settings.language)),
    );
    const edition = manifest?.editions.find((item) => item.id === manifest.selectedId);
    if (edition && matchesTranslationSource(edition, hashes.hash, hashes.fingerprint)) {
      const artifact: ChapterTranslation | undefined = await idb(
        tx.objectStore('chapter-translations').get(chapterKey(edition.id, index)),
      );
      if (
        artifact?.bookId === book.id &&
        artifact.editionId === edition.id &&
        artifact.index === index &&
        matchesTranslationSource(artifact, hashes.chapters[index], source) &&
        artifact.paragraphs &&
        Object.keys(artifact.paragraphs).length === chapter.paragraphs.length &&
        chapter.paragraphs.every(
          (p) =>
            typeof artifact.paragraphs[p.id] === 'string' &&
            artifact.paragraphs[p.id].trim() &&
            artifact.paragraphs[p.id].length <= 1024 * 1024,
        )
      )
        return true;
    }
    return false;
  };
  const run = async () => {
    const skip = await localTransaction('readwrite', async (tx) => {
      if (!(await ensureLocalBook(tx, book.id))) throw aborted();
      await checkBook(tx);
      return alreadySaved(tx);
    });
    if (skip) {
      notifyLocalData();
      return;
    }
    const saved = await readLocal<Draft>('translation-jobs', draftKey);
    const parts = saved?.source === source ? [...saved.parts] : [];
    let offset = parts.at(-1)?.end || 0;
    while (offset < paragraph.text.length) {
      if (signal.aborted) throw aborted();
      let end = Math.min(paragraph.text.length, offset + 6000);
      if (end < paragraph.text.length) {
        const boundary = paragraph.text.lastIndexOf(' ', end - 1);
        if (boundary > end - 800) end = boundary + 1;
        if (/[\uD800-\uDBFF]/.test(paragraph.text[end - 1])) end--;
      }
      const ordinal = chapter.paragraphs.indexOf(paragraph);
      const text = await streamAI(
        settings,
        {
          action: 'translate',
          title: book.title,
          bookLanguage: sourceLanguage,
          target: paragraph.text.slice(offset, end),
          sources: chapter.paragraphs
            .slice(Math.max(0, ordinal - 1), ordinal + 2)
            .map((p) => ({ id: p.id, chapter: chapter.title, text: p.text.slice(0, 4000) })),
        },
        AbortSignal.any([signal, AbortSignal.timeout(120000)]),
        () => {},
      );
      if (parts.reduce((n, part) => n + part.text.length, text.length) > 100000)
        throw new AIRequestError('译文过长，未保存不完整的段落。');
      parts.push({ end, text });
      await localTransaction(
        'readwrite',
        async (tx) => {
          await checkBook(tx);
          await idb(
            tx
              .objectStore('translation-jobs')
              .put({ bookId: book.id, source, parts } satisfies Draft, draftKey),
          );
        },
        ['books', 'translation-jobs'],
      );
      offset = end;
    }
    const key = savedTranslationKey(settings.language, paragraphId, crypto.randomUUID());
    const text = parts.map((part) => part.text).join('\n\n');
    const record = createSavedTranslationRecord(book, key, text, Date.now());
    await localTransaction('readwrite', async (tx) => {
      await checkBook(tx);
      if (!(await alreadySaved(tx))) {
        const legacy = (await idb(tx.objectStore('translations').get(book.id))) || {};
        legacy[key] = text;
        await idb(tx.objectStore('translations').put(legacy, book.id));
        await idb(tx.objectStore('translation-versions').put(record, [book.id, key]));
        await idb(
          tx
            .objectStore('translation-selections')
            .put({ bookId: book.id, language: settings.language, paragraphId, key }, [
              book.id,
              settings.language,
              paragraphId,
            ]),
        );
        await stage(tx, 'translation', book.id, key, { key, text });
      }
      await idb(tx.objectStore('translation-jobs').delete(draftKey));
    });
    notifyLocalData();
    notifySyncDirty();
  };
  // The same saved paragraph can be reached from multiple tabs at once.
  await navigator.locks.request(
    `${libraryDatabaseName()}:reading:${JSON.stringify([book.id, settings.language, paragraphId, sourceLanguage, source])}`,
    { signal },
    run,
  );
}
