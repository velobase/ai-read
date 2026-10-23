import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  createNotesExportLocator,
  MAX_NOTES_EXPORT_BYTES,
  normalizeSearch,
  notesExportLabels,
  notesMarkdownBook,
  notesMarkdownEntry,
  notesMarkdownHeader,
  type Book,
  type Note,
  type NotesExportLocale,
} from '@bypage/reading-core';
import { openLibraryDatabase } from './database';
import type { LibraryHandle, LibraryLease } from './library-scope';

export type NotesExportScope = { bookId?: string; query?: string };
export type NotesExportSnapshot = {
  libraryKey: string;
  markdown: string;
  noteCount: number;
  bookCount: number;
  bookTitle?: string;
};

/** Capture all matching notes in one SQLite snapshot; UI list limits never apply. */
export async function prepareNotesExport(
  handle: LibraryHandle,
  scope: NotesExportScope,
  locale: NotesExportLocale,
  signal?: AbortSignal,
): Promise<NotesExportSnapshot> {
  const check = () => {
    if (signal?.aborted) {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };
  check();
  const bookId = scope.bookId;
  const needle = normalizeSearch(scope.query?.trim() || '');
  const labels = notesExportLabels(locale);
  const parts: string[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  let noteCount = 0;
  let bookCount = 0;
  let bookTitle: string | undefined;
  const append = (text: string) => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > MAX_NOTES_EXPORT_BYTES) throw new Error('notes_export_too_large');
    parts.push(text);
  };
  append(notesMarkdownHeader(labels));
  const db = await openLibraryDatabase(handle);
  check();
  await db.withExclusiveTransactionAsync(async (tx) => {
    let afterBook: string | undefined;
    while (true) {
      check();
      const book = await tx.getFirstAsync<{
        id: string;
        title: string;
        author: string;
        language: string;
        importedAt: number;
      }>(
        `SELECT b.id, b.title, b.author, b.language, b.imported_at AS importedAt
         FROM books b WHERE EXISTS(SELECT 1 FROM notes n WHERE n.book_id = b.id)
         ${bookId ? 'AND b.id = ?' : ''} ${afterBook !== undefined ? 'AND b.id > ?' : ''}
         ORDER BY b.id LIMIT 1`,
        [...(bookId ? [bookId] : []), ...(afterBook !== undefined ? [afterBook] : [])],
      );
      check();
      if (!book) break;
      let locator: ReturnType<typeof createNotesExportLocator> | undefined;
      let cursor: { created_at: number; id: string } | undefined;
      const titleMatches = !!needle && normalizeSearch(book.title).includes(needle);
      while (true) {
        check();
        const rows = await tx.getAllAsync<{ id: string; created_at: number; body: string }>(
          `SELECT id, created_at, body FROM notes WHERE book_id = ?
           ${cursor ? 'AND (created_at, id) > (?, ?)' : ''}
           ORDER BY created_at, id LIMIT 64`,
          cursor ? [book.id, cursor.created_at, cursor.id] : [book.id],
        );
        check();
        let characters = 0;
        for (const row of rows) {
          check();
          const note = JSON.parse(row.body) as Note;
          if (
            !note ||
            note.id !== row.id ||
            note.bookId !== book.id ||
            typeof note.quote !== 'string' ||
            typeof note.text !== 'string' ||
            typeof note.paragraphId !== 'string' ||
            typeof note.createdAt !== 'number'
          )
            throw new Error('notes_export_invalid');
          characters += note.quote.length + note.text.length;
          if (characters >= 64000) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            check();
            characters = 0;
          }
          if (
            needle &&
            !titleMatches &&
            !normalizeSearch(`${note.quote} ${note.text} ${book.title}`).includes(needle)
          )
            continue;
          if (!locator) {
            // Read one book's navigation only after its first match. Never load media, cover,
            // translations, credentials or assistant history, nor repeat chapters per note row.
            const structure = await tx.getFirstAsync<{
              chapters: string;
              toc: string | null;
              sourceFormat: Book['sourceFormat'] | null;
            }>(
              `SELECT json_extract(body, '$.chapters') AS chapters,
               json_extract(body, '$.toc') AS toc, json_extract(body, '$.sourceFormat') AS sourceFormat
               FROM books WHERE id = ?`,
              [book.id],
            );
            check();
            if (!structure) throw new Error('notes_export_invalid');
            locator = createNotesExportLocator({
              ...book,
              chapters: JSON.parse(structure.chapters),
              ...(structure.toc ? { toc: JSON.parse(structure.toc) } : {}),
              ...(structure.sourceFormat ? { sourceFormat: structure.sourceFormat } : {}),
            });
            append(notesMarkdownBook(book, labels));
            bookCount++;
            if (bookId) bookTitle = book.title;
          }
          append(notesMarkdownEntry(note, locator(note.paragraphId), labels));
          noteCount++;
        }
        if (rows.length < 64) break;
        cursor = rows[rows.length - 1];
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (bookId) break;
      afterBook = book.id;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    check();
  });
  check();
  if (!noteCount) throw new Error('notes_export_empty');
  return {
    libraryKey: handle.key,
    markdown: parts.join(''),
    noteCount,
    bookCount,
    ...(bookTitle ? { bookTitle } : {}),
  };
}

/** Only an explicit share action writes a private temporary file. */
export async function shareNotesExport(
  lease: LibraryLease,
  snapshot: NotesExportSnapshot,
): Promise<void> {
  lease.assertCurrent();
  if (snapshot.libraryKey !== lease.handle.key) throw new Error('library_scope_changed');
  const { markdown, noteCount } = snapshot;
  if (!noteCount || !markdown) throw new Error('notes_export_empty');
  if (new TextEncoder().encode(markdown).byteLength > MAX_NOTES_EXPORT_BYTES)
    throw new Error('notes_export_too_large');
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  lease.assertCurrent();
  const directory = new Directory(Paths.cache, 'bypage-exports', lease.handle.attachmentScope);
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `LeafRead-notes-${Crypto.randomUUID()}.md`);
  try {
    file.create();
    file.write(markdown);
    lease.assertCurrent();
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/markdown',
      UTI: 'net.daringfireball.markdown',
      dialogTitle: 'LeafRead',
    });
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Keep share success/cancellation intact; this private cache is also disposable by iOS.
    }
  }
}
