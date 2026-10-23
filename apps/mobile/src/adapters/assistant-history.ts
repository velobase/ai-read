import {
  resolveTranslationKey,
  validSyncId,
  type Book,
  type Paragraph,
} from '@bypage/reading-core';
import type { PassageSelection } from '../components/passage';
import { accountSnapshot } from './account';
import { openLibraryDatabase } from './database';
import type { LibraryHandle } from './library-scope';
import { measured } from './diagnostics';
import { normalizeServerOrigin } from './server-origin';

export type AssistantHistoryPartition = {
  origin: string;
  accountId: string | null;
  /** Older servers can save local answers, but cannot safely reuse their history. */
  contextKey: string | null;
};
export type AssistantHistoryRange = {
  paragraphId: string;
  start: number;
  end: number;
};
export type AssistantHistoryFocus = AssistantHistoryRange &
  (
    | { source: 'original' }
    | { source: 'translation'; language: string; translationKey: string; quote: string }
  );
export type AssistantHistoryTurn = {
  id: string;
  bookId: string;
  createdAt: number;
  updatedAt: number;
  partition: AssistantHistoryPartition;
  model?: string;
  scope: 'chapter' | 'read' | 'book';
  context?: { totalParagraphs: number; partial: boolean };
  question: string;
  answer: string;
  status: 'complete' | 'stopped' | 'error';
  saved: boolean;
  focus: AssistantHistoryFocus;
  sources: AssistantHistoryRange[];
};
export type AssistantHistoryInput = Omit<AssistantHistoryTurn, 'updatedAt'>;
export type AssistantHistoryCursor = { createdAt: number; id: string };
export type AssistantHistoryPage = {
  turns: AssistantHistoryTurn[];
  nextCursor: AssistantHistoryCursor | null;
};
export type AssistantHistorySource = {
  id: string;
  chapter: string;
  chapterIndex: number;
  start: number;
  text: string;
};

const MAX_ANSWER = 100000;
const MAX_FOCUS = 4000;
const MAX_SOURCE_CHARACTERS = 16000;
const validContext = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new Error('Invalid assistant history');
};
const validTime = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8640000000000000;
const indexes = new WeakMap<
  Book,
  Map<string, { paragraph: Paragraph; chapter: string; chapterIndex: number }>
>();
function paragraphIndex(book: Book) {
  let index = indexes.get(book);
  if (!index) {
    index = new Map();
    book.chapters.forEach((chapter, chapterIndex) => {
      for (const paragraph of chapter.paragraphs)
        index!.set(paragraph.id, { paragraph, chapter: chapter.title, chapterIndex });
    });
    indexes.set(book, index);
  }
  return index;
}

function validatePartition(value: unknown): AssistantHistoryPartition {
  if (
    !object(value) ||
    typeof value.origin !== 'string' ||
    value.origin.length > 2048 ||
    (value.accountId !== null && !validSyncId(value.accountId)) ||
    (value.contextKey !== null && !validContext(value.contextKey))
  )
    return invalid();
  // Stored origins are labels, never request destinations. An older development
  // origin must remain readable even in a later production installation.
  let url: URL;
  try {
    url = new URL(value.origin);
  } catch {
    return invalid();
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.origin !== value.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    return invalid();
  return {
    origin: value.origin,
    accountId: value.accountId as string | null,
    contextKey: value.contextKey as string | null,
  };
}

/** Capture before starting a request, never after an account or service change. */
export function assistantHistoryPartition(
  rawOrigin: string,
  contextKey?: string,
): AssistantHistoryPartition | null {
  let origin: string;
  try {
    origin = normalizeServerOrigin(rawOrigin);
  } catch {
    return null;
  }
  const account = accountSnapshot();
  if (!origin || origin !== account.origin || account.loading || account.busy) return null;
  return {
    origin,
    accountId: account.session?.user.id ?? null,
    contextKey: validContext(contextKey) ? contextKey : null,
  };
}

/** The UI may display local history; only this exact scope may be sent again. */
export function sameAssistantHistoryPartition(
  left: AssistantHistoryPartition | null | undefined,
  right: AssistantHistoryPartition | null | undefined,
): boolean {
  return !!(
    left &&
    right &&
    validContext(left.contextKey) &&
    validContext(right.contextKey) &&
    left.origin === right.origin &&
    left.accountId === right.accountId &&
    left.contextKey === right.contextKey
  );
}

function validateRange(book: Book, value: unknown, translated = false): AssistantHistoryRange {
  if (
    !object(value) ||
    typeof value.paragraphId !== 'string' ||
    !Number.isSafeInteger(value.start) ||
    !Number.isSafeInteger(value.end)
  )
    return invalid();
  const paragraph = paragraphIndex(book).get(value.paragraphId)?.paragraph;
  const start = value.start as number;
  const end = value.end as number;
  if (
    !paragraph ||
    start < 0 ||
    end <= start ||
    end > (translated ? MAX_ANSWER : paragraph.text.length)
  )
    return invalid();
  return { paragraphId: paragraph.id, start, end };
}

function validateFocus(book: Book, value: unknown): AssistantHistoryFocus {
  if (!object(value) || !['original', 'translation'].includes(value.source as string))
    return invalid();
  const range = validateRange(book, value, value.source === 'translation');
  if (range.end - range.start > MAX_FOCUS) return invalid();
  if (value.source === 'original') return { ...range, source: 'original' };
  if (
    typeof value.language !== 'string' ||
    value.language.length > 30 ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.language) ||
    typeof value.quote !== 'string' ||
    value.quote.length !== range.end - range.start ||
    !validSyncId(value.translationKey)
  )
    return invalid();
  return {
    ...range,
    source: 'translation',
    language: value.language,
    translationKey: value.translationKey,
    quote: value.quote,
  };
}

/** Store only an immutable original reference, or the exact selected translated quote. */
export function captureAssistantHistoryFocus(selection: PassageSelection): AssistantHistoryFocus {
  if (
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end <= selection.start ||
    selection.end > selection.text.length ||
    selection.end - selection.start > MAX_FOCUS
  )
    return invalid();
  const range = {
    paragraphId: selection.paragraph.id,
    start: selection.start,
    end: selection.end,
  };
  if (selection.source === 'original') {
    if (selection.text !== selection.paragraph.text) return invalid();
    return { ...range, source: 'original' };
  }
  const identity = resolveTranslationKey(
    selection.translationKey,
    new Set([selection.paragraph.id]),
  );
  if (!selection.language || identity?.language !== selection.language) return invalid();
  return {
    ...range,
    source: 'translation',
    language: selection.language,
    translationKey: selection.translationKey!,
    quote: selection.text.slice(selection.start, selection.end),
  };
}

/** Allowlist every persisted field: no credentials, provider payloads or copied source chapters. */
export function validateAssistantHistoryTurn(book: Book, value: unknown): AssistantHistoryTurn {
  if (
    !object(value) ||
    !validSyncId(value.id) ||
    value.bookId !== book.id ||
    !validTime(value.createdAt) ||
    !validTime(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    !['chapter', 'read', 'book'].includes(value.scope as string) ||
    typeof value.question !== 'string' ||
    !value.question.trim() ||
    value.question.length > 3000 ||
    typeof value.answer !== 'string' ||
    (value.status === 'complete' && !value.answer.trim()) ||
    value.answer.length > MAX_ANSWER ||
    !['complete', 'stopped', 'error'].includes(value.status as string) ||
    typeof value.saved !== 'boolean' ||
    (value.model !== undefined && (typeof value.model !== 'string' || value.model.length > 200)) ||
    !Array.isArray(value.sources) ||
    value.sources.length > 200
  )
    return invalid();
  if (
    value.context !== undefined &&
    (!object(value.context) ||
      !Number.isSafeInteger(value.context.totalParagraphs) ||
      (value.context.totalParagraphs as number) < 0 ||
      (value.context.totalParagraphs as number) > 20 * 1024 * 1024 ||
      typeof value.context.partial !== 'boolean')
  )
    return invalid();
  const sources = value.sources.map((source) => validateRange(book, source));
  if (
    sources.some((source) => source.end - source.start > MAX_FOCUS) ||
    new Set(sources.map((source) => source.paragraphId)).size !== sources.length ||
    sources.reduce((sum, source) => sum + source.end - source.start, 0) > MAX_SOURCE_CHARACTERS
  )
    return invalid();
  const context = value.context as AssistantHistoryTurn['context'];
  if (
    context &&
    (context.totalParagraphs < sources.length ||
      (context.totalParagraphs > sources.length && !context.partial))
  )
    return invalid();
  return {
    id: value.id,
    bookId: book.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    partition: validatePartition(value.partition),
    ...(value.model !== undefined ? { model: value.model as string } : {}),
    scope: value.scope as AssistantHistoryTurn['scope'],
    ...(context
      ? {
          context: {
            totalParagraphs: context.totalParagraphs,
            partial: context.partial,
          },
        }
      : {}),
    question: value.question,
    answer: value.answer,
    status: value.status as AssistantHistoryTurn['status'],
    saved: value.saved,
    focus: validateFocus(book, value.focus),
    sources,
  };
}

/** Keyset pagination never deletes older turns or shifts a cursor when a new turn arrives. */
export async function listAssistantHistory(
  handle: LibraryHandle,
  book: Book,
  options: {
    identity: Pick<AssistantHistoryPartition, 'origin' | 'accountId'>;
    before?: AssistantHistoryCursor;
    limit?: number;
  },
): Promise<AssistantHistoryPage> {
  return measured('ai.history.load', async () => {
    const identity = validatePartition({ ...options.identity, contextKey: null });
    const { before } = options;
    if (before && (!validTime(before.createdAt) || !validSyncId(before.id))) return invalid();
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return invalid();
    const rows = await (
      await openLibraryDatabase(handle)
    ).getAllAsync<{ body: string }>(
      `SELECT body FROM assistant_history WHERE book_id = ? AND json_extract(body, '$.partition.origin') = ? AND json_extract(body, '$.partition.accountId') IS ? ${before ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
      before
        ? [
            book.id,
            identity.origin,
            identity.accountId,
            before.createdAt,
            before.createdAt,
            before.id,
            limit + 1,
          ]
        : [book.id, identity.origin, identity.accountId, limit + 1],
    );
    const turns = rows
      .slice(0, limit)
      .map((row) => validateAssistantHistoryTurn(book, JSON.parse(row.body)));
    const last = turns[turns.length - 1];
    return {
      turns,
      nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  });
}

/** Terminal writes are idempotent; stale partial writes cannot replace a finished answer. */
export async function saveAssistantTurn(
  handle: LibraryHandle,
  book: Book,
  input: AssistantHistoryInput,
): Promise<AssistantHistoryTurn> {
  return measured('ai.history.save', async () => {
    let result = validateAssistantHistoryTurn(book, {
      ...input,
      updatedAt: Math.max(Date.now(), input.createdAt),
    });
    const db = await openLibraryDatabase(handle);
    await db.withExclusiveTransactionAsync(async (tx) => {
      const exists = await tx.getFirstAsync('SELECT id FROM books WHERE id = ?', [book.id]);
      if (!exists) throw new Error('Book not found');
      const row = await tx.getFirstAsync<{ body: string }>(
        'SELECT body FROM assistant_history WHERE book_id = ? AND id = ?',
        [book.id, result.id],
      );
      if (row) {
        const existing = validateAssistantHistoryTurn(book, JSON.parse(row.body));
        const identity = (turn: AssistantHistoryTurn) =>
          JSON.stringify([
            turn.createdAt,
            turn.partition,
            turn.model,
            turn.scope,
            turn.context,
            turn.question,
            turn.focus,
            turn.sources,
          ]);
        if (identity(existing) !== identity(result)) throw new Error('Assistant history conflict');
        if (existing.status === 'complete') {
          if (!existing.answer.startsWith(result.answer))
            throw new Error('Assistant history conflict');
          // Keeping a complete answer also keeps its completion status, even when
          // closing the sheet scheduled a later stopped/error write.
          result = { ...existing, saved: existing.saved || result.saved };
        } else if (result.answer.startsWith(existing.answer)) {
          result = { ...result, saved: existing.saved || result.saved };
        } else if (existing.answer.startsWith(result.answer)) {
          result = { ...existing, saved: existing.saved || result.saved };
        } else {
          throw new Error('Assistant history conflict');
        }
        result.updatedAt = Math.max(existing.updatedAt, Date.now(), result.createdAt);
        await tx.runAsync('UPDATE assistant_history SET body = ? WHERE book_id = ? AND id = ?', [
          JSON.stringify(result),
          book.id,
          result.id,
        ]);
      } else {
        await tx.runAsync(
          'INSERT INTO assistant_history(id, book_id, body, created_at) VALUES (?, ?, ?, ?)',
          [result.id, book.id, JSON.stringify(result), result.createdAt],
        );
      }
    });
    return result;
  });
}

/** A separate transactional flag cannot be reset by a concurrent terminal write. */
export async function markAssistantTurnSaved(
  handle: LibraryHandle,
  bookId: string,
  id: string,
): Promise<void> {
  const db = await openLibraryDatabase(handle);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ body: string }>(
      'SELECT body FROM assistant_history WHERE book_id = ? AND id = ?',
      [bookId, id],
    );
    if (!row) throw new Error('Assistant history not found');
    const turn = JSON.parse(row.body) as AssistantHistoryTurn;
    await tx.runAsync('UPDATE assistant_history SET body = ? WHERE book_id = ? AND id = ?', [
      JSON.stringify({ ...turn, saved: true, updatedAt: Math.max(Date.now(), turn.updatedAt) }),
      bookId,
      id,
    ]);
  });
}

/** Rebuild only from this book and an exact cached translation; never invent text offsets. */
export function hydrateAssistantHistoryTurn(
  book: Book,
  input: AssistantHistoryTurn,
  exactTranslations: Record<string, string> = {},
): { sources: AssistantHistorySource[]; focus: PassageSelection | null } {
  const turn = validateAssistantHistoryTurn(book, input);
  const index = paragraphIndex(book);
  const sources = turn.sources.map((range) => {
    const { paragraph, chapter, chapterIndex } = index.get(range.paragraphId)!;
    return {
      id: paragraph.id,
      chapter,
      chapterIndex,
      start: range.start,
      text: paragraph.text.slice(range.start, range.end),
    };
  });
  const { focus } = turn;
  const paragraph = index.get(focus.paragraphId)!.paragraph;
  if (focus.source === 'original')
    return {
      sources,
      focus: {
        paragraph,
        source: 'original',
        text: paragraph.text,
        start: focus.start,
        end: focus.end,
      },
    };
  const identity = resolveTranslationKey(focus.translationKey, new Set(index.keys()));
  const text = exactTranslations[focus.translationKey];
  if (
    identity?.language !== focus.language ||
    identity.paragraphId !== focus.paragraphId ||
    typeof text !== 'string' ||
    text.slice(focus.start, focus.end) !== focus.quote
  )
    return { sources, focus: null };
  return {
    sources,
    focus: {
      paragraph,
      source: 'translation',
      text,
      start: focus.start,
      end: focus.end,
      language: focus.language,
      translationKey: focus.translationKey,
    },
  };
}
