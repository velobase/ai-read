import { fetch as nativeFetch } from 'expo/fetch';
import {
  effectiveBookLanguage,
  editionNoteKey,
  sha256,
  utf8,
  translationSource,
  translationBookSource,
  translationChapterFingerprint,
  TRANSLATION_SOURCE_SCHEME,
  type Book,
  type ChapterTranslation,
  type TranslationManifest,
  type TranslationEdition,
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

/** Requests only register durable work or read it. There is no client translation execution. */
export function bookTranslationSession(
  lease: LibraryLease,
  book: Book,
  origin: string,
  language: string,
  guard: TranslationStoreGuard,
) {
  const revision = accountRevision();
  const identity = translationSource(book);
  const downloaded = new Map<number, number>();
  let activeEdition: string | null = null;
  function check() {
    const account = accountSnapshot();
    lease.assertCurrent();
    if (
      guard.signal.aborted ||
      !guard.isCurrent() ||
      accountRevision() !== revision ||
      account.loading ||
      account.busy ||
      account.origin !== origin
    )
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    if (!account.session) throw new Error('authentication_required');
    if (
      lease.handle.kind === 'account' &&
      (lease.handle.userId !== account.session.user.id || lease.handle.origin !== origin)
    )
      throw new Error('library_scope_changed');
  }
  async function request(
    method: 'GET' | 'POST',
    query: Record<string, string> = {},
    body?: unknown,
  ) {
    check();
    // Leaving the page must not cancel an already submitted ensure request.
    // GET cancellation only detaches this display; it never cancels server work.
    const scope = requestScope(origin, method === 'GET' ? guard.signal : undefined, 60000);
    try {
      const headers = await scope.headers();
      const response = await nativeFetch(
        `${scope.origin}/api/translations${
          method === 'GET' ? `?${new URLSearchParams({ bookId: book.id, language, ...query })}` : ''
        }`,
        {
          method,
          credentials: 'omit',
          redirect: 'error',
          signal: scope.signal,
          headers: {
            ...headers,
            Accept: 'application/json',
            Origin: scope.origin,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      await scope.checkStatus(response.status);
      const text = await response.text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        throw new Error('invalid_translation_response', { cause: { error, text } });
      }
      scope.assertCurrent();
      if (!response.ok)
        throw Object.assign(new Error('translation_unavailable', { cause: value }), {
          status: response.status,
          requestId: response.headers.get('x-request-id'),
        });
      check();
      return value;
    } finally {
      scope.close();
    }
  }
  async function selected(raw: unknown): Promise<TranslationEdition | null> {
    const manifest = raw as TranslationManifest;
    if (
      !manifest ||
      !Array.isArray(manifest.editions) ||
      (manifest.selectedId !== null && typeof manifest.selectedId !== 'string')
    )
      throw new Error('invalid_translation_manifest', { cause: raw });
    const edition = manifest.editions.find((item) => item.id === manifest.selectedId);
    if (!edition) {
      if (manifest.selectedId !== null)
        throw new Error('invalid_translation_manifest', { cause: raw });
      return null;
    }
    if (
      edition.bookId !== book.id ||
      edition.language !== language ||
      edition.sourceHash !== (await identity).hash ||
      !Number.isSafeInteger(edition.createdAt) ||
      !Array.isArray(edition.chapters) ||
      !['active', 'error', 'ready'].includes(edition.state) ||
      !edition.progress ||
      !Number.isSafeInteger(edition.progress.completed) ||
      !Number.isSafeInteger(edition.progress.total) ||
      edition.progress.completed < 0 ||
      edition.progress.completed > edition.progress.total
    )
      throw new Error('invalid_translation_manifest', { cause: raw });
    check();
    if (activeEdition !== edition.id) {
      downloaded.clear();
      activeEdition = edition.id;
    }
    return edition;
  }
  async function download(edition: TranslationEdition, currentChapter: number) {
    const sourceIdentity = await identity;
    check();
    // Show the open chapter first, then retain the rest for offline reading and exact notes.
    const chapters = [...edition.chapters].sort((a, b) =>
      a.index === currentChapter ? -1 : b.index === currentChapter ? 1 : a.index - b.index,
    );
    for (const progress of chapters) {
      check();
      const index = progress.index;
      const source = book.chapters[index];
      if (!source || progress.sourceHash !== sourceIdentity.chapters[index])
        throw new Error('translation_source_changed');
      const stamp = progress.completedChunks;
      if (
        downloaded.get(index) === stamp ||
        (!progress.completedChunks && progress.state !== 'ready')
      )
        continue;
      const raw = await request('GET', { editionId: edition.id, chapter: String(index) });
      const artifact = raw as ChapterTranslation;
      const ids = new Set(source.paragraphs.map((paragraph) => paragraph.id));
      if (
        !artifact ||
        artifact.bookId !== book.id ||
        artifact.editionId !== edition.id ||
        artifact.index !== index ||
        artifact.sourceHash !== sourceIdentity.chapters[index] ||
        !artifact.paragraphs ||
        typeof artifact.paragraphs !== 'object' ||
        Array.isArray(artifact.paragraphs) ||
        Object.keys(artifact.paragraphs).some((id) => !ids.has(id))
      )
        throw new Error('invalid_translation_chapter', { cause: raw });
      const fingerprint = translationChapterFingerprint(source);
      const versions: SavedTranslationVersion[] = source.paragraphs
        .filter(
          (paragraph) => paragraph.text.trim() && Object.hasOwn(artifact.paragraphs, paragraph.id),
        )
        .map((paragraph) => {
          const text = artifact.paragraphs[paragraph.id];
          if (typeof text !== 'string' || !text.trim() || text.length > 100000)
            throw new Error('invalid_translation_chapter', { cause: raw });
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
      if (versions.length) notifyTranslationStore(lease.handle, book.id);
      check();
      downloaded.set(index, stamp);
    }
  }
  return {
    ensure: (chapter: number, action: 'ensure' | 'retry' = 'ensure') =>
      request('POST', {}, { book: translationBookSource(book), language, chapter, action }).then(
        selected,
      ),
    read: () => request('GET').then(selected),
    download,
  };
}
