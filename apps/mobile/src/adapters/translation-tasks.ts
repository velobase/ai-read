import { fetch as nativeFetch } from 'expo/fetch';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  effectiveBookLanguage,
  contentHash,
  editionNoteKey,
  sha256,
  utf8,
  translationBookSource,
  translationSource,
  translationChapterFingerprint,
  TRANSLATION_SOURCE_SCHEME,
  type Book,
  type ChapterTranslation,
  type TranslationCommand,
  type TranslationEdition,
  type TranslationManifest,
  type SavedTranslationVersion,
} from '@bypage/reading-core';
import { accountRevision, accountSnapshot, requestScope } from './account';
import { apiOrigin } from './server-origin';
import { openLibraryDatabase, getTranslationDisplay } from './database';
import {
  importTranslationVersions,
  ensureBookTranslationMigration,
  notifyTranslationStore,
} from './translation-store';
import type { LibraryLease } from './library-scope';

export const emptyManifest: TranslationManifest = { selectedId: null, editions: [] };
export type TranslationTaskContext = {
  owner: string;
  lease: LibraryLease;
  signal: AbortSignal;
  check: () => void;
};
export function translationTaskContext(
  lease: LibraryLease,
  signal: AbortSignal,
): TranslationTaskContext {
  const account = accountSnapshot(),
    revision = accountRevision();
  if (!account.session || account.busy || account.loading || account.origin !== apiOrigin)
    throw new Error('native_session_required');
  if (
    lease.handle.kind === 'account' &&
    (lease.handle.userId !== account.session.user.id || lease.handle.origin !== apiOrigin)
  )
    throw new Error('library_scope_changed');
  const owner = JSON.stringify([apiOrigin, account.session.user.id]);
  return {
    owner,
    lease,
    signal,
    check() {
      lease.assertCurrent();
      if (signal.aborted || accountRevision() !== revision || accountSnapshot().busy)
        throw Object.assign(new Error('account_changed'), { name: 'AbortError' });
    },
  };
}
const initialized = new WeakSet<SQLiteDatabase>();
async function store(context: TranslationTaskContext) {
  context.check();
  const db = await openLibraryDatabase(context.lease.handle);
  if (!initialized.has(db)) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS translation_task_manifests (
      owner TEXT NOT NULL, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      language TEXT NOT NULL, body TEXT NOT NULL,
      PRIMARY KEY(owner, book_id, language)
    );
    CREATE TABLE IF NOT EXISTS translation_task_chapters (
      owner TEXT NOT NULL, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      edition_id TEXT NOT NULL, chapter_index INTEGER NOT NULL,
      PRIMARY KEY(owner, book_id, edition_id, chapter_index)
    );`);
    initialized.add(db);
  }
  context.check();
  return db;
}
export async function readTaskManifest(
  context: TranslationTaskContext,
  bookId: string,
  language: string,
) {
  const db = await store(context);
  const row = await db.getFirstAsync<{ body: string }>(
    'SELECT body FROM translation_task_manifests WHERE owner = ? AND book_id = ? AND language = ?',
    [context.owner, bookId, language],
  );
  context.check();
  return row ? (JSON.parse(row.body) as TranslationManifest) : emptyManifest;
}
async function request(
  context: TranslationTaskContext,
  book: Book,
  language: string,
  query: Record<string, string> = {},
  command?: TranslationCommand,
): Promise<unknown> {
  context.check();
  const scope = requestScope(apiOrigin, context.signal, 60000);
  try {
    const headers = await scope.headers();
    context.check();
    const body = command
      ? JSON.stringify({
          bookId: book.id,
          language,
          ...command,
          sourceHash: (await translationSource(book)).hash,
          ...(['prepare', 'new'].includes(command.action)
            ? { book: translationBookSource(book) }
            : {}),
        })
      : undefined;
    const response = await nativeFetch(
      `${scope.origin}/api/translations?${new URLSearchParams({ bookId: book.id, language, ...query })}`,
      {
        method: command ? 'POST' : 'GET',
        credentials: 'omit',
        redirect: 'error',
        signal: scope.signal,
        headers: {
          ...headers,
          Accept: 'application/json',
          Origin: scope.origin,
          ...(command ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      },
    );
    await scope.checkStatus(response.status);
    const value = await response.json();
    scope.assertCurrent();
    context.check();
    if (!response.ok)
      throw new Error(typeof value?.error === 'string' ? value.error : `HTTP ${response.status}`);
    return value;
  } finally {
    scope.close();
  }
}
function manifestValue(value: unknown, book: Book, language: string): TranslationManifest {
  const raw = value as TranslationManifest;
  if (
    !raw ||
    !Array.isArray(raw.editions) ||
    (raw.selectedId !== null && typeof raw.selectedId !== 'string')
  )
    throw new Error('invalid_translation_manifest');
  for (const edition of raw.editions) {
    if (
      !edition ||
      typeof edition.id !== 'string' ||
      edition.bookId !== book.id ||
      edition.language !== language ||
      !/^[a-f0-9]{64}$/.test(edition.sourceHash) ||
      !Number.isSafeInteger(edition.createdAt) ||
      !['idle', 'active', 'paused', 'error'].includes(edition.state) ||
      !Array.isArray(edition.chapters) ||
      !edition.profile ||
      typeof edition.profile.model !== 'string' ||
      edition.chapters.some(
        (chapter, index) =>
          chapter.index !== index ||
          !/^[a-f0-9]{64}$/.test(chapter.sourceHash) ||
          !['missing', 'queued', 'running', 'ready', 'error'].includes(chapter.state) ||
          !Number.isSafeInteger(chapter.totalChunks) ||
          !Number.isSafeInteger(chapter.completedChunks) ||
          chapter.completedChunks < 0 ||
          chapter.totalChunks < chapter.completedChunks,
      )
    )
      throw new Error('invalid_translation_manifest');
  }
  if (raw.selectedId && !raw.editions.some((e) => e.id === raw.selectedId))
    throw new Error('invalid_translation_manifest');
  return raw;
}
export async function fetchTaskManifest(
  context: TranslationTaskContext,
  book: Book,
  language: string,
  command?: TranslationCommand,
) {
  return manifestValue(await request(context, book, language, {}, command), book, language);
}
async function assertBook(
  tx: SQLiteDatabase,
  context: TranslationTaskContext,
  book: Book,
  index?: number,
) {
  context.check();
  const row = await tx.getFirstAsync<{ body: string }>(
    "SELECT json_remove(body, '$.media', '$.references', '$.toc', '$.cover') AS body FROM books WHERE id = ?",
    [book.id],
  );
  if (!row) throw new Error('book_missing');
  const stored = JSON.parse(row.body) as Book;
  if (effectiveBookLanguage(stored) !== effectiveBookLanguage(book))
    throw new Error('translation_source_changed');
  if (
    index !== undefined &&
    (!stored.chapters[index] ||
      translationChapterFingerprint(stored.chapters[index]) !==
        translationChapterFingerprint(book.chapters[index]))
  )
    throw new Error('translation_source_changed');
  context.check();
}
async function selectChapter(
  tx: SQLiteDatabase,
  book: Book,
  language: string,
  editionId: string,
  index: number,
) {
  for (const p of book.chapters[index].paragraphs)
    await tx.runAsync(
      `INSERT INTO translation_selections(book_id, language, paragraph_id, key) VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id, language, paragraph_id) DO UPDATE SET key = excluded.key`,
      [book.id, language, p.id, editionNoteKey(language, p.id, editionId)],
    );
}
async function saveChapter(
  context: TranslationTaskContext,
  book: Book,
  edition: TranslationEdition,
  raw: unknown,
  selected: boolean,
  expectedIndex: number,
) {
  const artifact = raw as ChapterTranslation;
  if (
    !artifact ||
    artifact.bookId !== book.id ||
    artifact.editionId !== edition.id ||
    artifact.index !== expectedIndex ||
    !book.chapters[artifact.index] ||
    !artifact.paragraphs ||
    typeof artifact.paragraphs !== 'object'
  )
    throw new Error('invalid_translation_chapter');
  const source = book.chapters[artifact.index];
  if (
    artifact.sourceHash !== (await contentHash(source)) ||
    artifact.sourceHash !== edition.chapters[artifact.index]?.sourceHash ||
    Object.keys(artifact.paragraphs).length !== source.paragraphs.length
  )
    throw new Error('translation_source_changed');
  const versions: SavedTranslationVersion[] = source.paragraphs.map((p) => {
    const text = artifact.paragraphs[p.id];
    if (typeof text !== 'string' || !text.trim() || text.length > 100000)
      throw new Error('invalid_translation_chapter');
    return {
      version: 1,
      bookId: book.id,
      key: editionNoteKey(edition.language, p.id, edition.id),
      language: edition.language,
      paragraphId: p.id,
      kind: 'published',
      chapterIndex: artifact.index,
      sourceScheme: TRANSLATION_SOURCE_SCHEME,
      sourceFingerprint: translationChapterFingerprint(source),
      text,
      textHash: sha256(utf8(text)),
      createdAt: edition.createdAt,
    };
  });
  const db = await store(context);
  await db.withExclusiveTransactionAsync(async (tx) => {
    await assertBook(tx, context, book, artifact.index);
    await ensureBookTranslationMigration(tx, book);
    await importTranslationVersions(tx, book, versions, []);
    if (selected) await selectChapter(tx, book, edition.language, edition.id, artifact.index);
    await tx.runAsync(
      'INSERT OR IGNORE INTO translation_task_chapters(owner,book_id,edition_id,chapter_index) VALUES (?,?,?,?)',
      [context.owner, book.id, edition.id, artifact.index],
    );
    context.check();
  });
  notifyTranslationStore(context.lease.handle, book.id);
}
/** Polling/downloads are disposable; the server task continues independently of this connection. */
export async function syncTaskTranslations(
  context: TranslationTaskContext,
  book: Book,
  language: string,
  manifest: TranslationManifest,
  chapter: number,
  onChapter: () => Promise<void>,
  shouldYield: () => boolean,
) {
  const db = await store(context),
    source = translationBookSource(book),
    hashes = await translationSource(source);
  const previous = await readTaskManifest(context, book.id, language);
  for (const edition of [...manifest.editions].sort(
    (a, b) => Number(b.id === manifest.selectedId) - Number(a.id === manifest.selectedId),
  )) {
    if (edition.sourceHash !== hashes.hash) continue;
    const rows = await db.getAllAsync<{ chapter_index: number }>(
      'SELECT chapter_index FROM translation_task_chapters WHERE owner = ? AND book_id = ? AND edition_id = ?',
      [context.owner, book.id, edition.id],
    );
    const cached = new Set(rows.map((r) => r.chapter_index));
    for (const progress of [...edition.chapters].sort(
      (a, b) => Math.abs(a.index - chapter) - Math.abs(b.index - chapter),
    )) {
      context.check();
      if (shouldYield()) return getTranslationDisplay(context.lease.handle, book.id);
      if (
        progress.state !== 'ready' ||
        progress.sourceHash !== hashes.chapters[progress.index] ||
        cached.has(progress.index)
      )
        continue;
      const artifact = await request(context, book, language, {
        editionId: edition.id,
        chapter: String(progress.index),
      });
      await saveChapter(
        context,
        source,
        edition,
        artifact,
        manifest.selectedId === edition.id,
        progress.index,
      );
      await onChapter();
    }
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    await assertBook(tx, context, book);
    const selected = manifest.editions.find((e) => e.id === manifest.selectedId);
    if (
      selected &&
      selected.sourceHash === hashes.hash &&
      previous.selectedId !== manifest.selectedId
    ) {
      const rows = await tx.getAllAsync<{ chapter_index: number }>(
        'SELECT chapter_index FROM translation_task_chapters WHERE owner = ? AND book_id = ? AND edition_id = ?',
        [context.owner, book.id, selected.id],
      );
      for (const row of rows) {
        await assertBook(tx, context, book, row.chapter_index);
        await selectChapter(tx, book, language, selected.id, row.chapter_index);
      }
    }
    await tx.runAsync(
      `INSERT INTO translation_task_manifests(owner,book_id,language,body) VALUES (?,?,?,?)
      ON CONFLICT(owner,book_id,language) DO UPDATE SET body=excluded.body`,
      [context.owner, book.id, language, JSON.stringify(manifest)],
    );
    context.check();
  });
  notifyTranslationStore(context.lease.handle, book.id);
  context.check();
  return getTranslationDisplay(context.lease.handle, book.id);
}
