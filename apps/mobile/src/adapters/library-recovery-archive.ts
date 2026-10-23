import {
  normalizeCollectionName,
  sha256,
  utf8,
  validateBackup,
  validateBook,
  validatePortableLibrary,
  validSyncId,
  type Book,
  type Bookmark,
  type Note,
  type PortableCollection,
  type PortableTranslation,
  type Position,
  type SavedTranslationVersion,
  type SavedTranslationSelection,
  MAX_PORTABLE_TRANSLATION_VERSIONS,
  MAX_PORTABLE_TRANSLATION_SELECTIONS,
} from '@bypage/reading-core';
import { validateAssistantHistoryTurn, type AssistantHistoryTurn } from './assistant-history';
import {
  translationDraftScopeKey,
  validateTranslationDraft,
  type TranslationDraft,
} from './translation-drafts';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const archiveBrand = Symbol('ValidatedLibraryRecoveryArchive');
export type RecoveryCounts = Readonly<{
  notes: number;
  bookmarks: number;
  translations: number;
  translationVersions?: number;
  translationSelections?: number;
  history: number;
  drafts: number;
  skippedHistory: number;
  skippedDrafts: number;
}>;
export type ValidatedLibraryRecoveryArchive = Readonly<{
  [archiveBrand]: true;
  format: 'bypage-library-recovery';
  version: 1 | 2;
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  reason: string;
  /** An archival label only. Never use it to open a database or an attachment directory. */
  libraryKey: string;
  digest: string;
  hasPdf: boolean;
  counts: RecoveryCounts;
}>;
export type RecoveryData = {
  book: Book;
  position?: Position;
  notes: Note[];
  bookmarks: Bookmark[];
  translations: PortableTranslation[];
  translationVersions: SavedTranslationVersion[];
  translationSelections: SavedTranslationSelection[];
  history: AssistantHistoryTurn[];
  drafts: TranslationDraft[];
  collections: PortableCollection[];
  finished: boolean;
  lastOpened: number;
};
const archives = new WeakMap<ValidatedLibraryRecoveryArchive, RecoveryData>();
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
const invalid = (): never => {
  throw new Error('library_recovery_invalid');
};
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    object(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
function body(row: Row): unknown {
  if (typeof row.body !== 'string') return invalid();
  try {
    return JSON.parse(row.body);
  } catch {
    return invalid();
  }
}
function rows(value: unknown, maximum: number): Row[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((row) => !object(row)))
    return invalid();
  return value;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) invalid();
}
function sameBookRows(values: Row[], id: string) {
  if (values.some((row) => row.book_id !== id)) invalid();
}
const byId = <T extends { id: string }>(values: T[]) =>
  [...values].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

/** Strict, local-only archive parsing. Invalid private rows remain in the source archive. */
export function validateLibraryRecoveryArchive(raw: unknown): ValidatedLibraryRecoveryArchive {
  if (!object(raw)) return invalid();
  // This bound also covers private history/drafts, which are not covered by portable limits.
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return invalid();
  }
  if (serialized.length > MAX_ARCHIVE_BYTES || utf8(serialized).length > MAX_ARCHIVE_BYTES)
    throw new Error('library_recovery_too_large');
  if (
    raw.format !== 'bypage-library-recovery' ||
    (raw.version !== 1 && raw.version !== 2) ||
    !validSyncId(raw.id) ||
    !validSyncId(raw.bookId) ||
    !time(raw.createdAt) ||
    typeof raw.reason !== 'string' ||
    !raw.reason ||
    raw.reason.length > 100 ||
    typeof raw.libraryKey !== 'string' ||
    !/^account-[a-f0-9]{64}$/.test(raw.libraryKey) ||
    typeof raw.title !== 'string' ||
    raw.title.length > 2000 ||
    !object(raw.book) ||
    raw.book.id !== raw.bookId ||
    !object(raw.rows)
  )
    return invalid();
  const book = validateBook(body(raw.book));
  if (
    book.id !== raw.bookId ||
    raw.book.title !== book.title ||
    raw.book.author !== book.author ||
    raw.book.language !== book.language ||
    raw.book.chapters !== book.chapters.length ||
    raw.book.sample !== (book.sample ? 1 : 0) ||
    !time(raw.book.imported_at) ||
    !time(raw.book.last_opened) ||
    (raw.book.finished !== 0 && raw.book.finished !== 1) ||
    typeof raw.book.progress !== 'number' ||
    !Number.isFinite(raw.book.progress) ||
    raw.book.progress < 0 ||
    raw.book.progress > 1
  )
    return invalid();
  const positions = rows(raw.rows.positions, 1);
  const noteRows = rows(raw.rows.notes, 100000);
  const bookmarkRows = rows(raw.rows.bookmarks, 1000);
  const translationRows = rows(raw.rows.translations, 2000);
  const hasExact = raw.version === 2;
  const versionRows = rows(
    raw.rows.translation_versions === undefined ? [] : raw.rows.translation_versions,
    MAX_PORTABLE_TRANSLATION_VERSIONS,
  );
  const selectionRows = rows(
    raw.rows.translation_selections === undefined ? [] : raw.rows.translation_selections,
    MAX_PORTABLE_TRANSLATION_SELECTIONS,
  );
  if (raw.version === 1 && (versionRows.length || selectionRows.length)) return invalid();
  if (
    raw.version === 2 &&
    (raw.rows.translation_versions === undefined || raw.rows.translation_selections === undefined)
  )
    return invalid();
  const historyRows = rows(raw.rows.assistant_history, 100000);
  const draftRows = rows(raw.rows.translation_drafts, 100000);
  const memberships = rows(raw.rows.book_collections, 1);
  const groups = rows(raw.rows.shelf_collections, 1);
  const syncRows = rows(raw.rows.library_sync_state, 102000);
  for (const set of [
    positions,
    noteRows,
    bookmarkRows,
    translationRows,
    versionRows,
    selectionRows,
    historyRows,
    draftRows,
    memberships,
    syncRows,
  ])
    sameBookRows(set, book.id);
  const scopedBodies = (values: Row[]) =>
    values.map((row) => {
      const value = body(row);
      if (
        !object(value) ||
        value.bookId !== book.id ||
        value.id !== row.id ||
        value.createdAt !== row.created_at
      )
        return invalid();
      return value;
    });
  const backup = validateBackup({
    format: 'ai-read-books-and-notes',
    version: 1,
    exportedAt: raw.createdAt,
    books: [book],
    notes: scopedBodies(noteRows),
    bookmarks: scopedBodies(bookmarkRows),
    positions: positions.length ? { [book.id]: body(positions[0]) } : {},
  });
  const versionValues = versionRows.map((row) => {
    const value = body(row);
    if (
      !object(value) ||
      value.bookId !== book.id ||
      value.key !== row.key ||
      value.language !== row.language ||
      value.paragraphId !== row.paragraph_id
    )
      return invalid();
    return value;
  });
  // Validate completed caches independently: do not rebind note/bookmark keys.
  // Exact rows are all preserved, including versions which are not selected.
  const completed = validatePortableLibrary({
    format: 'bypage-portable-library',
    version: hasExact ? 2 : 1,
    backup: { ...backup, notes: [], bookmarks: [] },
    translations: translationRows.map((row) => ({
      bookId: book.id,
      language: row.language,
      paragraphs: body(row),
    })),
    ...(hasExact
      ? {
          translationVersions: versionValues,
          translationSelections: selectionRows.map((row) => ({
            bookId: row.book_id,
            language: row.language,
            paragraphId: row.paragraph_id,
            key: row.key,
          })),
        }
      : {}),
  });
  const translations = completed.translations.sort((a, b) => a.language.localeCompare(b.language));
  const translationVersions = (completed.version === 2 ? completed.translationVersions : []).sort(
    (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const translationSelections = (
    completed.version === 2 ? completed.translationSelections : []
  ).sort((a, b) =>
    JSON.stringify([a.language, a.paragraphId]).localeCompare(
      JSON.stringify([b.language, b.paragraphId]),
    ),
  );
  const collections: PortableCollection[] = [];
  if (groups.length !== memberships.length) return invalid();
  if (groups.length) {
    const group = groups[0];
    const name = normalizeCollectionName(group.name);
    if (
      !validSyncId(group.id) ||
      !name ||
      group.name !== name.name ||
      group.name_key !== name.key ||
      !time(group.created_at) ||
      memberships[0].collection_id !== group.id
    )
      return invalid();
    collections.push({ name: name.name, bookIds: [book.id] });
  }
  const history: AssistantHistoryTurn[] = [];
  const skippedHistory: { id: string; digest: string }[] = [];
  for (const row of historyRows) {
    if (!validSyncId(row.id) || !time(row.created_at)) return invalid();
    const value = body(row);
    if (
      !object(value) ||
      value.bookId !== book.id ||
      value.id !== row.id ||
      value.createdAt !== row.created_at
    )
      return invalid();
    try {
      history.push(validateAssistantHistoryTurn(book, value));
    } catch {
      skippedHistory.push({ id: row.id, digest: sha256(utf8(canonical(value))) });
    }
  }
  unique(historyRows.map((row) => String(row.id)));
  const drafts: TranslationDraft[] = [];
  const skippedDrafts: { id: string; digest: string }[] = [];
  const draftKeys: string[] = [];
  for (const row of draftRows) {
    if (
      typeof row.paragraph_id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(String(row.scope_key)) ||
      !time(row.updated_at)
    )
      return invalid();
    const value = body(row);
    if (
      !object(value) ||
      value.bookId !== book.id ||
      value.paragraphId !== row.paragraph_id ||
      value.updatedAt !== row.updated_at
    )
      return invalid();
    const id = JSON.stringify([row.scope_key, row.paragraph_id]);
    draftKeys.push(id);
    try {
      const draft = validateTranslationDraft(book, value);
      if (translationDraftScopeKey(draft.scope) !== row.scope_key) return invalid();
      drafts.push(draft);
    } catch {
      skippedDrafts.push({ id, digest: sha256(utf8(canonical(value))) });
    }
  }
  unique(draftKeys);
  // Outbox is fingerprinted for identity, never replayed into the device library.
  const sync = syncRows.map((row) => {
    const value = body(row);
    if (
      !['book', 'position', 'note', 'bookmark'].includes(String(row.entity)) ||
      !validSyncId(row.id) ||
      !time(row.updated_at) ||
      !object(value) ||
      value.entity !== row.entity ||
      value.bookId !== book.id ||
      value.id !== row.id ||
      value.key !== JSON.stringify([row.entity, book.id, row.id]) ||
      !Number.isSafeInteger(value.version) ||
      (value.version as number) < 0 ||
      typeof value.deleted !== 'boolean'
    )
      return invalid();
    return { id: value.key as string, digest: sha256(utf8(canonical(value))) };
  });
  unique(sync.map((entry) => entry.id));
  const data: RecoveryData = {
    book,
    position: backup.positions[book.id],
    notes: byId(backup.notes),
    bookmarks: byId(backup.bookmarks || []),
    translations,
    translationVersions,
    translationSelections,
    history: byId(history),
    drafts: drafts.sort((a, b) =>
      JSON.stringify([translationDraftScopeKey(a.scope), a.paragraphId]).localeCompare(
        JSON.stringify([translationDraftScopeKey(b.scope), b.paragraphId]),
      ),
    ),
    collections,
    finished: raw.book.finished === 1,
    lastOpened: raw.book.last_opened,
  };
  // Preserve the identity of old archives: adding empty optional exact-version
  // arrays must not invalidate a previously completed restore marker.
  const {
    translationVersions: _versions,
    translationSelections: _selections,
    ...legacyData
  } = data;
  const digest = sha256(
    utf8(
      canonical({
        id: raw.id,
        sourceBookId: book.id,
        libraryKey: raw.libraryKey,
        createdAt: raw.createdAt,
        reason: raw.reason,
        title: raw.title,
        originalShelfImportedAt: raw.book.imported_at,
        data: hasExact ? data : legacyData,
        skippedHistory: byId(skippedHistory),
        skippedDrafts: byId(skippedDrafts),
        sync: byId(sync),
      }),
    ),
  );
  const result: ValidatedLibraryRecoveryArchive = Object.freeze({
    [archiveBrand]: true as const,
    format: 'bypage-library-recovery',
    version: raw.version,
    id: raw.id,
    bookId: book.id,
    title: book.title,
    createdAt: raw.createdAt,
    reason: raw.reason,
    libraryKey: raw.libraryKey,
    digest,
    hasPdf: book.sourceFormat === 'pdf' || /^[a-fA-F0-9]{64}\.pdf(?:kit|js)-/.test(book.id),
    counts: Object.freeze({
      notes: data.notes.length,
      bookmarks: data.bookmarks.length,
      translations: translations.reduce(
        (sum, entry) => sum + Object.keys(entry.paragraphs).length,
        0,
      ),
      translationVersions: translationVersions.length,
      translationSelections: translationSelections.length,
      history: history.length,
      drafts: drafts.length,
      skippedHistory: skippedHistory.length,
      skippedDrafts: skippedDrafts.length,
    }),
  });
  archives.set(result, data);
  return result;
}

/** Internal access to validated data. A JSON object cannot impersonate a validated archive. */
export function recoveryArchiveData(archive: ValidatedLibraryRecoveryArchive): RecoveryData {
  const data = archives.get(archive);
  if (!data) return invalid();
  return data;
}
