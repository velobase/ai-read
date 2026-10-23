import { requireOptionalNativeModule } from 'expo-modules-core';
import { readMobilePermissions, type MobilePermission } from '@bypage/api-client';
import { validSyncId } from '@bypage/reading-core';

export type AuthSession = {
  origin: string;
  sessionId: string;
  expiresAt: string;
  permissions: MobilePermission[];
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    bio?: string;
    color?: string;
    createdAt?: string;
  };
};

type NativeSession = Omit<AuthSession, 'permissions'> & { permissions?: unknown };
type NativeAuth = {
  version: number;
  libraryVersion?: number;
  providerVersion?: number;
  signInWithProvider?(origin: string, provider: 'google' | 'apple'): Promise<NativeSession>;
  signIn(origin: string): Promise<NativeSession>;
  signInLibrary?(origin: string): Promise<NativeSession>;
  readSession(origin: string): Promise<NativeSession | null>;
  authorization(origin: string, expectedSessionId: string): Promise<string | null>;
  cancelSignIn(): Promise<void>;
  clearSession(origin: string, expectedSessionId: string | null): Promise<void>;
  logout(origin: string): Promise<{ revoked: boolean }>;
};

const native = requireOptionalNativeModule<NativeAuth>('ByPageAuth');
export const available = !!native && native.version >= 1;
export const libraryAvailable =
  available && (native?.libraryVersion || 0) >= 1 && typeof native?.signInLibrary === 'function';

function module(): NativeAuth {
  if (!available) throw new Error('native_auth_unavailable');
  return native!;
}

function publicSession(value: NativeSession, origin: string): AuthSession {
  const permissions = readMobilePermissions(
    value.permissions === undefined ? ['account_ai'] : value.permissions,
  );
  if (
    value.origin !== origin ||
    !validSyncId(value.user?.id) ||
    !validSyncId(value.sessionId) ||
    !permissions?.includes('account_ai') ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    throw new Error('invalid_auth_response');
  return { ...value, permissions };
}
export const signIn = async (origin: string, provider: 'google' | 'apple' = 'google') => {
  const auth = module();
  if (auth.signInWithProvider && (auth.providerVersion || 0) >= 1)
    return publicSession(await auth.signInWithProvider(origin, provider), origin);
  if (provider === 'apple') throw new Error('native_auth_unavailable');
  return publicSession(await auth.signIn(origin), origin);
};
export async function signInLibrary(origin: string): Promise<AuthSession> {
  if (!libraryAvailable) throw new Error('native_library_auth_unavailable');
  const session = publicSession(await native!.signInLibrary!(origin), origin);
  if (!session.permissions.includes('library_sync')) throw new Error('invalid_auth_permissions');
  return session;
}
/** Cached public identity only; a server 401 must clear it, while an outage must not. */
export const readSession = async (origin: string): Promise<AuthSession | null> => {
  const session = await module().readSession(origin);
  return session ? publicSession(session, origin) : null;
};
/** Use only as a transient, same-origin request header; never persist, log or put in UI state. */
export const authorization = (origin: string, expectedSessionId: string) =>
  module().authorization(origin, expectedSessionId);
export const cancelSignIn = () => (available ? native!.cancelSignIn() : Promise.resolve());
/** An expected session fences a late 401 from clearing a newer successful sign-in. */
export const clearSession = (origin: string, expectedSessionId?: string) =>
  available ? native!.clearSession(origin, expectedSessionId ?? null) : Promise.resolve();
export const logout = (origin: string) => module().logout(origin);
