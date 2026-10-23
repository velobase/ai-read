import { LibrarySyncError } from './library-sync-transport';

export type LibrarySyncFailure = {
  kind:
    | 'authentication'
    | 'permission'
    | 'offline'
    | 'timeout'
    | 'server'
    | 'protocol'
    | 'rejected'
    | 'storage';
  retryable: boolean;
  httpStatus?: number;
};
export type LibrarySyncTrigger =
  'automatic' | 'mutation' | 'foreground' | 'authorization' | 'manual';
export type LibrarySyncStatus = {
  state: 'idle' | 'syncing' | 'ready' | 'error';
  phase: 'idle' | 'counting' | 'uploading' | 'downloading';
  pending: number;
  blocked: number;
  recoveries: number;
  countsState: 'loading' | 'ready' | 'error';
  countsUpdatedAt?: number;
  completedAt?: number;
  error?: LibrarySyncFailure;
  retryAt?: number;
  retryAttempt: number;
};

/** Fixed categories only: never expose raw database errors, URLs, or book content. */
export function librarySyncFailure(error: unknown): LibrarySyncFailure {
  const status = error instanceof LibrarySyncError ? error.status : 0;
  const code = error instanceof Error ? error.message : '';
  const http = status > 0 ? { httpStatus: status } : {};
  if (status === 401 || code === 'native_session_expired')
    return { kind: 'authentication', retryable: false, ...http };
  if (status === 403 || code === 'library_permission_required' || code === 'sync_identity_mismatch')
    return { kind: 'permission', retryable: false, ...http };
  if (code === 'library_sync_timeout' || status === 408 || status === 504)
    return { kind: 'timeout', retryable: true, ...http };
  if (status === 429 || status >= 500) return { kind: 'server', retryable: true, ...http };
  if (error instanceof LibrarySyncError && code === 'library_sync_unavailable' && status === 0)
    return { kind: 'offline', retryable: true };
  if (
    error instanceof LibrarySyncError ||
    code === 'invalid_sync_response' ||
    /^library_sync_(invalid_data|content_required|parent_missing|position_required)$/.test(code) ||
    /^Invalid (book|bookmark|reading backup|note)/.test(code)
  )
    return { kind: 'protocol', retryable: false, ...http };
  return { kind: 'storage', retryable: false };
}

export function retryBackoff(attempt: number): number {
  return Math.min(300000, 5000 * 2 ** Math.max(0, Math.min(6, attempt - 1)));
}

/** null means a user/authorization/foreground recovery is required, not another timer. */
export function automaticSyncDelay(
  status: LibrarySyncStatus,
  now = Date.now(),
  localMutation = false,
): number | null {
  if (status.state === 'syncing') return null;
  if (!status.error) return 0;
  if (status.error.retryable) return Math.max(0, (status.retryAt || now) - now);
  // A new local mutation may be valid even when another captured mutation was rejected.
  if (localMutation && status.error.kind === 'rejected') return 0;
  return null;
}
