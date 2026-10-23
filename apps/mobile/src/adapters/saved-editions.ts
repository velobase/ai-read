import { fetch as nativeFetch } from 'expo/fetch';
import {
  effectiveBookLanguage,
  editionNoteKey,
  sha256,
  utf8,
  translationSource,
  translationChapterFingerprint,
  TRANSLATION_SOURCE_SCHEME,
  type Book,
  type ChapterTranslation,
  type TranslationManifest,
  type SavedTranslationVersion,
} from '@bypage/reading-core';
import { accountRevision, accountSnapshot, requestScope } from './account';
import { openLibraryDatabase } from './database';
import {
  ensureBookTranslationMigration,
  importTranslationVersions,
  notifyTranslationStore,
  type TranslationStoreGuard,
} from './translation-store';
import type { LibraryLease } from './library-scope';

/** Recover saved server artifacts only. This adapter never starts or polls a server task. */
export async function hydrateSavedTranslationChapters(
  lease: LibraryLease,
  book: Book,
  origin: string,
  language: string,
  chapters: readonly number[],
  guard: TranslationStoreGuard,
): Promise<void> {
  const revision = accountRevision();
  const account = accountSnapshot();
  const check = () => {
    const current = accountSnapshot();
    lease.assertCurrent();
    if (
      guard.signal.aborted ||
      !guard.isCurrent() ||
      accountRevision() !== revision ||
      current.loading ||
      current.busy ||
      current.origin !== origin
    )
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  };
  check();
  // A local, unsigned reader has no account-owned server artifacts to recover.
  if (!account.session) return;
  if (
    lease.handle.kind === 'account' &&
    (lease.handle.userId !== account.session.user.id || lease.handle.origin !== origin)
  )
    throw new Error('library_scope_changed');

  async function get(query: Record<string, string> = {}): Promise<unknown> {
    check();
    const scope = requestScope(origin, guard.signal, 60000);
    try {
      const headers = await scope.headers();
      check();
      const response = await nativeFetch(
        `${scope.origin}/api/translations?${new URLSearchParams({ bookId: book.id, language, ...query })}`,
        {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          signal: scope.signal,
          headers: { ...headers, Accept: 'application/json', Origin: scope.origin },
        },
      );
      await scope.checkStatus(response.status);
      const text = await response.text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        throw Object.assign(new Error('invalid_translation_response', { cause: { error, text } }), {
          status: response.status,
          requestId: response.headers.get('x-request-id'),
        });
      }
      scope.assertCurrent();
      check();
      if (!response.ok)
        throw Object.assign(new Error('saved_translation_unavailable', { cause: value }), {
          status: response.status,
          requestId: response.headers.get('x-request-id'),
        });
      return value;
    } finally {
      scope.close();
    }
  }

  const raw = await get();
  const manifest = raw as TranslationManifest;
  if (
    !manifest ||
    !Array.isArray(manifest.editions) ||
    (manifest.selectedId !== null && typeof manifest.selectedId !== 'string') ||
    manifest.editions.some(
      (edition) =>
        !edition ||
        typeof edition.id !== 'string' ||
        edition.bookId !== book.id ||
        edition.language !== language ||
        !/^[a-f0-9]{64}$/.test(edition.sourceHash) ||
        !Number.isSafeInteger(edition.createdAt) ||
        !Array.isArray(edition.chapters),
    )
  )
    throw new Error('invalid_translation_manifest', { cause: raw });
  const edition = manifest.editions.find((item) => item.id === manifest.selectedId);
  if (!edition) {
    if (manifest.selectedId !== null)
      throw new Error('invalid_translation_manifest', { cause: raw });
    return;
  }
  const identity = await translationSource(book);
  check();
  if (edition.sourceHash !== identity.hash) return;
  for (const index of new Set(chapters)) {
    check();
    const source = book.chapters[index];
    const progress = edition.chapters.find((item) => item.index === index);
    if (!source || !progress || progress.state !== 'ready') continue;
    if (progress.sourceHash !== identity.chapters[index])
      throw new Error('translation_source_changed');
    const rawChapter = await get({ editionId: edition.id, chapter: String(index) });
    const artifact = rawChapter as ChapterTranslation;
    if (
      !artifact ||
      artifact.bookId !== book.id ||
      artifact.editionId !== edition.id ||
      artifact.index !== index ||
      artifact.sourceHash !== identity.chapters[index] ||
      !artifact.paragraphs ||
      typeof artifact.paragraphs !== 'object' ||
      Array.isArray(artifact.paragraphs) ||
      Object.keys(artifact.paragraphs).length !== source.paragraphs.length
    )
      throw new Error('invalid_translation_chapter', { cause: rawChapter });
    const fingerprint = translationChapterFingerprint(source);
    const versions: SavedTranslationVersion[] = source.paragraphs.map((paragraph) => {
      const text = artifact.paragraphs[paragraph.id];
      if (typeof text !== 'string' || !text.trim() || text.length > 100000)
        throw new Error('invalid_translation_chapter', { cause: rawChapter });
      return {
        version: 1,
        bookId: book.id,
        key: editionNoteKey(language, paragraph.id, edition.id),
        language,
        paragraphId: paragraph.id,
        kind: 'published',
        chapterIndex: index,
        sourceScheme: TRANSLATION_SOURCE_SCHEME,
        sourceFingerprint: fingerprint,
        text,
        textHash: sha256(utf8(text)),
        createdAt: edition.createdAt,
      };
    });
    const db = await openLibraryDatabase(lease.handle);
    check();
    await db.withExclusiveTransactionAsync(async (tx) => {
      check();
      const row = await tx.getFirstAsync<{ body: string }>(
        "SELECT json_remove(body, '$.media', '$.references', '$.toc', '$.cover') AS body FROM books WHERE id = ?",
        [book.id],
      );
      if (!row) throw new Error('book_missing');
      const stored = JSON.parse(row.body) as Book;
      if (
        effectiveBookLanguage(stored) !== effectiveBookLanguage(book) ||
        !stored.chapters[index] ||
        translationChapterFingerprint(stored.chapters[index]) !== fingerprint
      )
        throw new Error('translation_source_changed');
      await ensureBookTranslationMigration(tx, book);
      // Additive imports preserve every existing exact paragraph selection.
      await importTranslationVersions(
        tx,
        book,
        versions,
        versions.map(({ bookId, language, paragraphId, key }) => ({
          bookId,
          language,
          paragraphId,
          key,
        })),
      );
      check();
    });
    notifyTranslationStore(lease.handle, book.id);
    check();
  }
}
