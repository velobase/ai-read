import { useSyncExternalStore } from 'react';
import { fetch as nativeFetch } from 'expo/fetch';
import * as nativeAuth from '../../modules/bypage-auth';
import { measured } from './diagnostics';
import { apiOrigin, requireServiceOrigin } from './server-origin';
import { type MobilePermission } from '@bypage/api-client';

export type AccountSession = {
  user: { id: string; name: string | null; email: string; image?: string | null };
  expiresAt: string;
  sessionId: string;
  permissions: MobilePermission[];
};
type AccountState = {
  origin: string;
  session: AccountSession | null;
  loading: boolean;
  busy: boolean;
  verified: boolean;
  revision: number;
  issue: '' | 'expired' | 'offline' | 'storage' | 'origin';
};
let state: AccountState = {
  origin: '',
  session: null,
  loading: false,
  busy: false,
  verified: false,
  revision: 0,
  issue: '',
};
const listeners = new Set<() => void>();
const requests = new Set<AbortController>();
function publish(patch: Partial<AccountState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
function invalidate(patch: Partial<AccountState> = {}) {
  for (const controller of requests) controller.abort();
  requests.clear();
  publish({ ...patch, revision: state.revision + 1 });
}
const cancelled = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });
export const accountAvailable = () => nativeAuth.available;
export const libraryAccountAvailable = () => nativeAuth.libraryAvailable;
export const accountSnapshot = () => state;
export const accountRevision = () => state.revision;
export function subscribeAccount(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const useAccount = () =>
  useSyncExternalStore(subscribeAccount, accountSnapshot, accountSnapshot);

/** Identity changes are synchronous; pending work cannot acquire a new account halfway through. */
export function initializeAccount() {
  const origin = apiOrigin;
  if (origin === state.origin) return;
  void nativeAuth.cancelSignIn();
  invalidate({
    origin,
    session: null,
    loading: !!origin && nativeAuth.available,
    busy: false,
    verified: false,
    issue: '',
  });
  const revision = state.revision;
  if (!origin || !nativeAuth.available) return;
  void import('./account-cleanup').then((cleanup) => cleanup.retryAccountCleanup()).catch(() => {});
  void nativeAuth
    .readSession(origin)
    .then((session) => {
      if (state.revision !== revision) return;
      if (session) invalidate({ session, loading: false });
      else publish({ loading: false });
      if (session) void refreshAccount();
    })
    .catch(() => {
      if (state.revision === revision) publish({ loading: false, issue: 'storage' });
    });
}

export function requestScope(raw: string, signal?: AbortSignal, timeout?: number) {
  const origin = requireServiceOrigin(raw);
  if (!origin) throw new Error('not_configured');
  const revision = state.revision;
  const session = origin === state.origin && !state.busy ? state.session : null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  requests.add(controller);
  const timer = timeout ? setTimeout(abort, timeout) : undefined;
  const assertCurrent = () => {
    if (controller.signal.aborted || state.revision !== revision) throw cancelled();
  };
  return {
    origin,
    signal: controller.signal,
    assertCurrent,
    async headers(): Promise<Record<string, string>> {
      assertCurrent();
      // A credential exists only for this request's captured session and exact origin.
      const authorization = session
        ? await nativeAuth.authorization(origin, session.sessionId)
        : null;
      assertCurrent();
      if (session && !authorization) {
        await expireAccount(revision, origin, session.sessionId);
        throw new Error('native_session_expired');
      }
      return authorization ? { Authorization: authorization } : {};
    },
    async checkStatus(status: number) {
      assertCurrent();
      if (status === 401 && session) {
        await expireAccount(revision, origin, session.sessionId);
        throw new Error('native_session_expired');
      }
    },
    close() {
      if (timer) clearTimeout(timer);
      requests.delete(controller);
      signal?.removeEventListener('abort', abort);
    },
  };
}
async function expireAccount(revision: number, origin: string, sessionId: string) {
  if (state.revision !== revision || state.origin !== origin) return;
  invalidate({ session: null, verified: false, issue: 'expired', loading: false, busy: true });
  const clearingRevision = state.revision;
  // No remote logout is needed for an already invalid server session.
  await nativeAuth.clearSession(origin, sessionId).catch(() => {});
  if (state.revision === clearingRevision) publish({ busy: false });
}
export const signInAccount = (provider: 'apple' | 'google' = 'google') => signIn(false, provider);
/** A separate confirmation fences the account shown to the user before granting sync. */
export const signInLibraryAccount = (expectedSessionId: string) =>
  signIn(true, 'google', expectedSessionId);
async function signIn(
  library: boolean,
  provider: 'apple' | 'google' = 'google',
  expectedSessionId?: string,
) {
  const origin = state.origin;
  if (!origin || !nativeAuth.available || state.busy || state.loading)
    throw new Error('native_auth_unavailable');
  if (library && !nativeAuth.libraryAvailable) throw new Error('native_library_auth_unavailable');
  if (library && (!expectedSessionId || state.session?.sessionId !== expectedSessionId))
    throw new Error('account_changed');
  invalidate({ busy: true, issue: '' });
  const revision = state.revision;
  try {
    const session = await measured('account.signin', () =>
      library
        ? nativeAuth.signInLibrary(origin, expectedSessionId!)
        : nativeAuth.signIn(origin, provider),
    );
    if (revision !== state.revision || state.origin !== origin) throw cancelled();
    invalidate({ session, busy: false, verified: true, issue: '' });
  } finally {
    if (revision === state.revision) publish({ busy: false });
  }
}
export async function signOutAccount() {
  const origin = state.origin;
  if (state.busy) return undefined;
  void nativeAuth.cancelSignIn();
  invalidate({ session: null, busy: true, verified: false, issue: '' });
  const revision = state.revision;
  try {
    const result = await measured('account.signout', () => nativeAuth.logout(origin));
    return state.revision === revision ? result.revoked : undefined;
  } finally {
    if (state.revision === revision) publish({ busy: false });
  }
}
let refreshingRevision: number | undefined;
export async function refreshAccount() {
  if (refreshingRevision === state.revision || !state.session || state.busy || state.loading)
    return;
  const revision = state.revision;
  refreshingRevision = revision;
  const scope = requestScope(state.origin, undefined, 35000);
  try {
    const current = state.session!;
    const session = await nativeAuth.renewSession(state.origin, current.sessionId);
    scope.assertCurrent();
    if (
      session.sessionId !== current.sessionId ||
      session.user.id !== current.user.id ||
      session.permissions.length !== current.permissions.length ||
      session.permissions.some((permission) => !current.permissions.includes(permission))
    )
      throw new Error('invalid_account_response');
    publish({ session, verified: true, issue: '' });
  } catch (cause) {
    if (cause instanceof Error && /native_session_expired/.test(cause.message)) {
      const session = state.session;
      if (session) await expireAccount(revision, scope.origin, session.sessionId);
    }
    try {
      scope.assertCurrent();
      publish({ verified: false, issue: 'offline' });
    } catch {
      /* New identity owns the UI. */
    }
  } finally {
    scope.close();
    if (refreshingRevision === revision) refreshingRevision = undefined;
  }
}

/** Called only after explicit destructive confirmation and switching away from account storage. */
export async function deleteAccount(expectedUserId: string) {
  const { origin, session } = state;
  if (!session || session.user.id !== expectedUserId || state.busy || state.loading)
    throw new Error('account_changed');
  const authorization = await nativeAuth.authorization(origin, session.sessionId);
  if (!authorization || state.session !== session || state.busy) throw new Error('account_changed');
  invalidate({ busy: true, issue: '' });
  const revision = state.revision;
  try {
    const response = await nativeFetch(`${origin}/api/mobile/v1/account`, {
      method: 'DELETE',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(35000),
      headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: authorization },
      body: JSON.stringify({ confirmation: expectedUserId }),
    });
    if (!response.ok) throw new Error('account_deletion_retry');
    let cleanupPending = false;
    try {
      const cleanup = await import('./account-cleanup');
      await cleanup.queueAccountCleanup(origin, expectedUserId);
    } catch {
      cleanupPending = true;
    }
    try {
      await nativeAuth.clearSession(origin, session.sessionId);
    } catch {
      cleanupPending = true;
    }
    if (state.revision === revision)
      invalidate({ session: null, busy: false, verified: false, issue: '' });
    return { cleanupPending };
  } finally {
    if (state.revision === revision) publish({ busy: false });
  }
}
