import {
  validatePortableLibrary,
  type PortableCollection,
  type PortableLibrary,
  type PortableTranslation,
} from '../../packages/reading-core/src/portable';
import {
  assertSameSavedTranslationVersion,
  validateSavedTranslationVersion,
  validateSavedTranslationSelection,
  type SavedTranslationVersion,
  type SavedTranslationSelection,
} from '../../packages/reading-core/src/saved-translation';
import { resolveTranslationKey } from '../../packages/reading-core/src/translation-key';
import {
  translationBookFingerprint,
  translationChapterFingerprint,
} from '../../packages/reading-core/src/translation-source';
import type { ReadingBackup } from './reading-backup';
import { idb, localTransaction } from './local-database';
import {
  translationSource,
  matchesTranslationSource,
  editionNoteKey,
  type ChapterTranslation,
  type TranslationManifest,
} from './translation-edition';
import { sampleBook, sampleTranslations } from './sample';
import { assertLibraryScope, captureLibraryScope, portableCollections } from './library-state';
import {
  createSavedTranslationRecord,
  savedTranslationSnapshot,
} from './saved-translation-storage';
import { selectLegacyTranslations } from './translation-selection';
import { translationFingerprint } from './translation-prompt';
import { storageKey } from './storage-scope';

export { validatePortableLibrary };
export type { PortableLibrary, PortableTranslation, PortableCollection };
export type PortableTranslationSnapshot = {
  manifestKeys: (IDBValidKey | undefined)[];
  manifests: TranslationManifest[];
  chapters: ChapterTranslation[];
  legacy: (readonly [string, Record<string, string>])[];
  versions: SavedTranslationVersion[];
  selections: SavedTranslationSelection[];
};

function preferredLegacyVersion() {
  let value: Record<string, unknown> = {};
  try {
    value = JSON.parse(localStorage.getItem(storageKey('ai-read-settings')) || '{}') || {};
  } catch {}
  return translationFingerprint({
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    model: typeof value.model === 'string' ? value.model : '',
    translationPrompt: typeof value.translationPrompt === 'string' ? value.translationPrompt : '',
  });
}

/** Export every exact local version. Selection never changes the identity of a saved quote. */
export async function portableLibraryFromSnapshot(
  backup: ReadingBackup,
  snapshot: PortableTranslationSnapshot,
  collections?: PortableCollection[],
): Promise<PortableLibrary> {
  const translationVersions: SavedTranslationVersion[] = [];
  const translationSelections: SavedTranslationSelection[] = [];
  const preferred = preferredLegacyVersion();
  for (const book of backup.books) {
    const versions = new Map<string, SavedTranslationVersion>();
    const selected = new Map<string, SavedTranslationSelection>();
    const selectionId = (language: string, paragraphId: string) =>
      JSON.stringify([language, paragraphId]);
    const add = (value: SavedTranslationVersion) => {
      const existing = versions.get(value.key);
      if (existing) assertSameSavedTranslationVersion(existing, value);
      else versions.set(value.key, value);
    };
    for (const value of snapshot.versions.filter((v) => v.bookId === book.id))
      add(validateSavedTranslationVersion(book, value));
    for (const value of snapshot.selections.filter((v) => v.bookId === book.id)) {
      const selection = validateSavedTranslationSelection(book, value, versions);
      selected.set(selectionId(selection.language, selection.paragraphId), selection);
    }
    const paragraphIds = new Set(book.chapters.flatMap((c) => c.paragraphs.map((p) => p.id)));
    const legacy = snapshot.legacy.find(([id]) => id === book.id)?.[1] || {};
    const old = book.id === sampleBook.id ? { ...sampleTranslations, ...legacy } : legacy;
    const languages = new Set<string>();
    for (const [key, text] of Object.entries(old)) {
      const identity = resolveTranslationKey(key, paragraphIds);
      if (!identity || typeof text !== 'string' || !text.trim()) continue;
      add(createSavedTranslationRecord(book, key, text, book.importedAt));
      languages.add(identity.language);
    }
    for (const language of languages) {
      for (const chapter of selectLegacyTranslations(book, language, old, preferred).values())
        for (const [paragraphId, key] of Object.entries(chapter.keys)) {
          const id = selectionId(language, paragraphId);
          if (!selected.has(id)) selected.set(id, { bookId: book.id, language, paragraphId, key });
        }
    }
    const source = await translationSource(book);
    const fingerprint = translationBookFingerprint(book);
    const chapterFingerprints = book.chapters.map(translationChapterFingerprint);
    for (const [manifestIndex, manifest] of snapshot.manifests.entries()) {
      const key = snapshot.manifestKeys[manifestIndex];
      let scope: unknown;
      try {
        scope = typeof key === 'string' ? JSON.parse(key) : null;
      } catch {
        continue;
      }
      // Older recovery archives had no manifest keys. Their own homogeneous
      // edition tuples provide scope; an empty/ambiguous archive cannot invent it.
      if (key === undefined && Array.isArray(manifest?.editions) && manifest.editions.length) {
        const first = manifest.editions[0];
        if (
          manifest.editions.every((e) => e.bookId === first.bookId && e.language === first.language)
        )
          scope = [first.bookId, first.language];
      }
      if (
        !Array.isArray(scope) ||
        scope.length !== 2 ||
        scope[0] !== book.id ||
        typeof scope[1] !== 'string' ||
        (key !== undefined && key !== JSON.stringify(scope))
      )
        continue;
      const language = scope[1];
      if (manifest?.selectedId)
        for (const [id, selection] of selected)
          if (selection.language === language) selected.delete(id);
      for (const edition of Array.isArray(manifest?.editions) ? manifest.editions : []) {
        if (
          !edition ||
          edition.bookId !== book.id ||
          edition.language !== language ||
          !matchesTranslationSource(edition, source.hash, fingerprint)
        )
          continue;
        for (const chapter of snapshot.chapters) {
          if (
            !chapter ||
            chapter.bookId !== book.id ||
            chapter.editionId !== edition.id ||
            !Number.isSafeInteger(chapter.index) ||
            chapter.index < 0 ||
            !book.chapters[chapter.index] ||
            !matchesTranslationSource(
              chapter,
              source.chapters[chapter.index],
              chapterFingerprints[chapter.index],
            )
          )
            continue;
          const original = book.chapters[chapter.index];
          const paragraphs = chapter.paragraphs;
          if (
            !paragraphs ||
            typeof paragraphs !== 'object' ||
            Array.isArray(paragraphs) ||
            Object.keys(paragraphs).length !== original.paragraphs.length ||
            !original.paragraphs.every(
              (p) => typeof paragraphs[p.id] === 'string' && paragraphs[p.id].trim(),
            )
          )
            continue;
          for (const paragraph of original.paragraphs) {
            const key = editionNoteKey(language, paragraph.id, edition.id);
            add(
              createSavedTranslationRecord(book, key, paragraphs[paragraph.id], edition.createdAt),
            );
            if (edition.id === manifest.selectedId)
              selected.set(selectionId(language, paragraph.id), {
                bookId: book.id,
                language,
                paragraphId: paragraph.id,
                key,
              });
          }
        }
      }
    }
    translationVersions.push(...versions.values());
    translationSelections.push(...selected.values());
  }
  return validatePortableLibrary({
    format: 'bypage-portable-library',
    version: 2,
    backup,
    translations: [],
    translationVersions,
    translationSelections,
    ...(collections !== undefined ? { collections } : {}),
  });
}

export async function createPortableLibrary(
  backup: ReadingBackup,
  { includeEmptyCollections = false }: { includeEmptyCollections?: boolean } = {},
): Promise<PortableLibrary> {
  const scope = captureLibraryScope();
  const collections = portableCollections(
    backup.books.map((book) => book.id),
    includeEmptyCollections,
  );
  const snapshot = await localTransaction(
    'readonly',
    async (tx) => {
      const exact = await Promise.all(
        backup.books.map((book) => savedTranslationSnapshot(tx, book.id)),
      );
      return {
        manifestKeys: await idb(tx.objectStore('translation-manifests').getAllKeys()),
        manifests: (await idb(
          tx.objectStore('translation-manifests').getAll(),
        )) as TranslationManifest[],
        chapters: (await idb(
          tx.objectStore('chapter-translations').getAll(),
        )) as ChapterTranslation[],
        legacy: await Promise.all(
          backup.books.map(
            async (book) =>
              [book.id, (await idb(tx.objectStore('translations').get(book.id))) || {}] as const,
          ),
        ),
        versions: exact.flatMap((entry) => entry.versions),
        selections: exact.flatMap((entry) => entry.selections),
      };
    },
    [
      'translation-manifests',
      'chapter-translations',
      'translations',
      'translation-versions',
      'translation-selections',
    ],
  );
  const pack = await portableLibraryFromSnapshot(backup, snapshot, collections);
  assertLibraryScope(scope);
  return pack;
}
export function downloadPortableLibrary(pack: PortableLibrary) {
  const value = JSON.stringify(pack);
  if (new Blob([value]).size > 50 * 1024 * 1024)
    throw new Error('阅读包超过 50 MB，请从书籍详情分别导出。');
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ByPage-reading-pack-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
