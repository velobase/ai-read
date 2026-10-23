import 'server-only';
import { mobileLibraryEntities } from '../../../packages/api-client/src/library';
import { database } from './database';
import { MobileAuthError, mobileAuthFailure, requireMobileLibrarySession } from './mobile-auth';
import { listRecords, readRecord, syncBody, validId, writeRecord } from './sync';

const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const invalid = (): never => {
  throw new Error('invalid-sync-data');
};
function libraryEntity(value: unknown) {
  // This permission's consent covers these four entities only. Adding chats,
  // translations or preferences requires a new permission/version and renewed
  // consent, never silently broadening existing library_sync tokens.
  if (typeof value !== 'string') return invalid();
  const entity = mobileLibraryEntities.find((candidate) => candidate === value);
  return entity ?? invalid();
}
async function identity(request: Request) {
  const session = await requireMobileLibrarySession(request);
  // The bearer session is authoritative. This header also fences a client that
  // accidentally attaches a new account's token to an old account's outbox.
  if (request.headers.get('x-reader-user') !== session.user.id)
    throw new MobileAuthError('sync_identity_mismatch', 403);
  return session;
}
function failure(error: unknown) {
  if (error instanceof MobileAuthError) return mobileAuthFailure(error);
  const message = error instanceof Error ? error.message : '';
  const tooLarge = message === 'sync-body-too-large';
  const badData =
    error instanceof SyntaxError ||
    tooLarge ||
    [
      'invalid-sync-data',
      '备份格式不正确，未修改本地数据。',
      '书籍正文过长，请选择较小的文件。',
      'Invalid book images',
      'Invalid book references',
      'Invalid bookmark',
    ].includes(message);
  return response(
    { error: badData ? 'sync-invalid' : 'sync-unavailable' },
    tooLarge ? 413 : badData ? 400 : 503,
  );
}

function readQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(['entity', 'bookId', 'id', 'after', 'content']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) invalid();
  }
  const entity = libraryEntity(params.get('entity') ?? 'book');
  const bookId = params.get('bookId');
  const id = params.get('id');
  const after = params.get('after');
  const content = params.get('content');
  for (const value of [bookId, id, after]) {
    if (value !== null && !validId(value)) invalid();
  }
  if (content !== null && content !== '0' && content !== '1') invalid();
  if (id !== null) {
    if (!bookId || after !== null) invalid();
    if ((entity === 'book' || entity === 'position') && bookId !== id) invalid();
    if (entity !== 'book' && content !== null) invalid();
  } else {
    if (content !== null) invalid();
    if (entity === 'book' ? bookId !== null : !bookId) invalid();
    if (entity === 'position' && after !== null) invalid();
  }
  return { entity, bookId: bookId ?? '', id, after: after ?? '', includeContent: content !== '0' };
}

/** The native transport deliberately exposes only the four negotiated library entities. */
export async function mobileSyncGET(request: Request) {
  try {
    const session = await identity(request);
    const query = readQuery(request);
    const userId = session.user.id;
    if (query.id !== null) {
      const record = await readRecord(
        database,
        userId,
        query.entity,
        query.bookId,
        query.id,
        query.includeContent,
      );
      return record ? response({ userId, record }) : response({ error: 'sync-missing' }, 404);
    }
    return response({
      userId,
      ...(await listRecords(userId, query.entity, query.bookId, query.after)),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function mobileSyncPOST(request: Request) {
  try {
    const session = await identity(request);
    if (new URL(request.url).search) invalid();
    const body = await syncBody(request);
    libraryEntity(body.entity);
    // A large body may arrive after logout or revocation; resolve permission
    // again before the shared transaction, rather than relying on a stale lookup.
    const current = await identity(request);
    if (current.sessionId !== session.sessionId || current.user.id !== session.user.id)
      throw new MobileAuthError('invalid_session');
    const result = await writeRecord(current.user.id, body);
    return response({ userId: current.user.id, ...result }, result.status);
  } catch (error) {
    return failure(error);
  }
}
