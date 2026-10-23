import { fetch as nativeFetch } from 'expo/fetch';
import {
  createLibraryApiClient,
  mobileLibraryEntities,
  type MobileLibraryEntity,
} from '@bypage/api-client';
import { validSyncId } from '@bypage/reading-core';
import { accountRevision, accountSnapshot, requestScope } from './account';
import { measured } from './diagnostics';
import { assertLibraryHandle, type LibraryLease } from './library-scope';
import { normalizeServerOrigin } from './server-origin';

export type LibrarySyncQuery = {
  entity: MobileLibraryEntity;
  bookId?: string;
  id?: string;
  after?: string;
  content?: boolean;
};
export type LibrarySyncMutation = {
  entity: MobileLibraryEntity;
  bookId: string;
  id: string;
  mutationId: string;
  baseVersion: number;
  deleted: boolean;
  data?: unknown;
};
export type LibrarySyncRequest =
  { query: LibrarySyncQuery; mutation?: never } | { mutation: LibrarySyncMutation; query?: never };
/** The sync engine must validate record payloads before applying them to SQLite. */
export type LibrarySyncResponse = { status: 200 | 404 | 409; body: unknown };

export class LibrarySyncError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 0,
  ) {
    super(code);
    this.name = 'LibrarySyncError';
  }
}
const MAX_SYNC_BYTES = 96 * 1024 * 1024;
const MAX_CONFIG_BYTES = 64 * 1024;
const invalidRequest = (): never => {
  throw new LibrarySyncError('library_sync_invalid_request');
};
const invalidResponse = (): never => {
  throw new LibrarySyncError('library_sync_invalid_response');
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const entity = (value: unknown): value is MobileLibraryEntity =>
  mobileLibraryEntities.includes(value as MobileLibraryEntity);
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalidRequest();
}

function queryString(query: LibrarySyncQuery) {
  if (!object(query) || !entity(query.entity)) return invalidRequest();
  fields(query, ['entity', 'bookId', 'id', 'after', 'content']);
  for (const value of [query.bookId, query.id, query.after]) {
    if (value !== undefined && !validSyncId(value)) invalidRequest();
  }
  if (query.content !== undefined && typeof query.content !== 'boolean') invalidRequest();
  if (query.id !== undefined) {
    if (!query.bookId || query.after !== undefined) invalidRequest();
    if ((query.entity === 'book' || query.entity === 'position') && query.id !== query.bookId)
      invalidRequest();
    if (query.entity !== 'book' && query.content !== undefined) invalidRequest();
  } else {
    if (query.content !== undefined) invalidRequest();
    if (query.entity === 'book' ? query.bookId !== undefined : !query.bookId) invalidRequest();
    if (query.entity === 'position' && query.after !== undefined) invalidRequest();
  }
  const params = new URLSearchParams({ entity: query.entity });
  for (const key of ['bookId', 'id', 'after'] as const) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  if (query.content !== undefined) params.set('content', query.content ? '1' : '0');
  return params.toString();
}

function mutationBody(mutation: LibrarySyncMutation) {
  if (!object(mutation) || !entity(mutation.entity)) return invalidRequest();
  fields(mutation, ['entity', 'bookId', 'id', 'mutationId', 'baseVersion', 'deleted', 'data']);
  if (
    !validSyncId(mutation.bookId) ||
    !validSyncId(mutation.id) ||
    !validSyncId(mutation.mutationId) ||
    mutation.mutationId.length > 100 ||
    !Number.isSafeInteger(mutation.baseVersion) ||
    mutation.baseVersion < 0 ||
    typeof mutation.deleted !== 'boolean' ||
    (!mutation.deleted && !object(mutation.data)) ||
    ((mutation.entity === 'book' || mutation.entity === 'position') &&
      mutation.id !== mutation.bookId)
  )
    return invalidRequest();
  // Tombstones do not transmit the previous private content again.
  const body = JSON.stringify({
    entity: mutation.entity,
    bookId: mutation.bookId,
    id: mutation.id,
    mutationId: mutation.mutationId,
    baseVersion: mutation.baseVersion,
    deleted: mutation.deleted,
    ...(!mutation.deleted ? { data: mutation.data } : {}),
  });
  if (new TextEncoder().encode(body).byteLength > MAX_SYNC_BYTES)
    throw new LibrarySyncError('library_sync_too_large', 413);
  return body;
}

async function readJSON(
  response: Awaited<ReturnType<typeof nativeFetch>>,
  limit: number,
  check: () => void,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    return invalidResponse();
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return invalidResponse();
  const reader = response.body?.getReader();
  if (!reader) return invalidResponse();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      check();
      const { done, value } = await reader.read();
      check();
      if (value) {
        bytes += value.byteLength;
        if (bytes > limit) return invalidResponse();
        parts.push(decoder.decode(value, { stream: true }));
      }
      if (done) break;
    }
    parts.push(decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  check();
  try {
    return JSON.parse(parts.join('')) as unknown;
  } catch {
    return invalidResponse();
  }
}

async function exchange(
  origin: string,
  path: string,
  options: {
    body?: string;
    lease?: LibraryLease;
    userId?: string;
    signal?: AbortSignal;
    limit: number;
    timeout: number;
  },
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, options.timeout);
  const signals = [options.signal, options.lease?.signal].filter(
    (signal): signal is AbortSignal => !!signal,
  );
  for (const signal of signals) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  const scope = requestScope(origin, controller.signal);
  const check = () => {
    if (timedOut) throw new LibrarySyncError('library_sync_timeout');
    options.lease?.assertCurrent();
    scope.assertCurrent();
  };
  try {
    check();
    const authorization = await scope.headers();
    check();
    if (options.userId && !authorization.Authorization)
      throw new LibrarySyncError('library_sign_in_required', 401);
    const response = await nativeFetch(`${origin}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: scope.signal,
      headers: {
        Accept: 'application/json',
        Origin: origin,
        ...authorization,
        ...(options.userId ? { 'x-reader-user': options.userId } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    check();
    await scope.checkStatus(response.status);
    check();
    let body: unknown;
    try {
      body = await readJSON(
        response,
        response.status === 200 || response.status === 409 ? options.limit : MAX_CONFIG_BYTES,
        check,
      );
    } catch (error) {
      check();
      // A proxy may reject a large request with HTML. Preserve rejection status
      // so the engine does not repeatedly upload the same invalid mutation.
      if (response.status === 400) throw new LibrarySyncError('library_sync_invalid_request', 400);
      if (response.status === 413) throw new LibrarySyncError('library_sync_too_large', 413);
      if (response.status === 403) throw new LibrarySyncError('library_permission_required', 403);
      throw error;
    }
    check();
    return { status: response.status, body };
  } catch (error) {
    if (timedOut) throw new LibrarySyncError('library_sync_timeout');
    if (error instanceof Error && error.message === 'native_session_expired')
      throw new LibrarySyncError('native_session_expired', 401);
    if (
      error instanceof LibrarySyncError ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error;
    if (scope.signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    throw new LibrarySyncError('library_sync_unavailable');
  } finally {
    clearTimeout(timer);
    scope.close();
    for (const signal of signals) signal.removeEventListener('abort', abort);
  }
}

/** Discovery itself uploads no library data and does not grant or enable synchronization. */
export const checkLibraryConnection = (origin: string, signal?: AbortSignal) =>
  measured('server.check', () => {
    const canonical = normalizeServerOrigin(origin);
    if (!canonical) throw new LibrarySyncError('not_configured');
    return createLibraryApiClient((path) =>
      exchange(canonical, path, { signal, limit: MAX_CONFIG_BYTES, timeout: 8000 }),
    ).getCapabilities();
  });

/** One request belongs to an immutable account library and one captured mobile session. */
export async function librarySyncRequest(
  lease: LibraryLease,
  request: LibrarySyncRequest,
  signal?: AbortSignal,
): Promise<LibrarySyncResponse> {
  lease.assertCurrent();
  if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  assertLibraryHandle(lease.handle);
  const handle = lease.handle;
  if (handle.kind !== 'account') throw new LibrarySyncError('library_account_required');
  const account = accountSnapshot();
  if (account.loading || account.busy || !account.session)
    throw new LibrarySyncError('library_sign_in_required', 401);
  if (account.origin !== handle.origin || account.session.user.id !== handle.userId)
    throw new LibrarySyncError('sync_identity_mismatch', 403);
  if (!account.session.permissions.includes('library_sync'))
    throw new LibrarySyncError('library_permission_required', 403);
  const revision = accountRevision();
  if (!object(request)) invalidRequest();
  const hasQuery = Object.prototype.hasOwnProperty.call(request, 'query');
  const hasMutation = Object.prototype.hasOwnProperty.call(request, 'mutation');
  if (hasQuery === hasMutation) invalidRequest();
  fields(request, ['query', 'mutation']);
  const query = request.query;
  const body = request.mutation === undefined ? undefined : mutationBody(request.mutation);
  const path = `/api/mobile/v2/sync${query ? `?${queryString(query)}` : ''}`;
  if (query === undefined && body === undefined) invalidRequest();
  lease.assertCurrent();
  const response = await exchange(handle.origin, path, {
    body,
    lease,
    userId: handle.userId,
    signal,
    limit: MAX_SYNC_BYTES,
    timeout: 60000,
  });
  lease.assertCurrent();
  if (accountRevision() !== revision)
    throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  if (
    response.status === 404 &&
    query?.id &&
    object(response.body) &&
    response.body.error === 'sync-missing'
  )
    return { status: 404, body: response.body };
  if (response.status === 403) {
    const code =
      object(response.body) && response.body.error === 'sync_identity_mismatch'
        ? 'sync_identity_mismatch'
        : 'library_permission_required';
    throw new LibrarySyncError(code, 403);
  }
  if (response.status !== 200 && response.status !== 409) {
    throw new LibrarySyncError(
      response.status === 400
        ? 'library_sync_invalid_request'
        : response.status === 413
          ? 'library_sync_too_large'
          : 'library_sync_unavailable',
      response.status,
    );
  }
  if (
    (response.status === 409 && query) ||
    !object(response.body) ||
    response.body.userId !== handle.userId
  )
    return invalidResponse();
  return { status: response.status, body: response.body };
}
