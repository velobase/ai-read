import 'server-only';
import { hashSession } from './auth';
import { nativeAuthConfigured, nativeAuthOrigin } from './auth-config';
import { database } from './database';
import { accountBody } from './account-request';
import { logEvent } from './observability';
import {
  readMobilePermissions,
  type MobilePermission,
} from '../../../packages/api-client/src/library';

export type { MobilePermission } from '../../../packages/api-client/src/library';
function grantedPermissions(value: unknown): MobilePermission[] {
  const permissions = readMobilePermissions(value);
  if (permissions?.includes('account_ai')) return permissions;
  throw new MobileAuthError('invalid_session');
}

export class MobileAuthError extends Error {
  constructor(
    public code: string,
    public status = 401,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'MobileAuthError';
  }
}
export function mobileAuthFailure(error: unknown) {
  logEvent('api.account', {
    outcome: 'error',
    status: error instanceof MobileAuthError ? error.status : 503,
    error,
  });
  return Response.json(
    { error: error instanceof MobileAuthError ? error.code : 'auth_unavailable' },
    {
      status: error instanceof MobileAuthError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
export async function mobileAuthBody(request: Request) {
  try {
    return await accountBody(request);
  } catch (cause) {
    throw new MobileAuthError('invalid_request', 400, { cause });
  }
}
function configured() {
  if (!nativeAuthConfigured()) throw new MobileAuthError('auth_unavailable', 503);
}

/** The issuer comes from deployment configuration, never from forwarded headers or callback input. */
export function mobileAuthOrigin(request: Request) {
  const canonical = nativeAuthOrigin();
  if (!canonical) throw new MobileAuthError('auth_unavailable', 503);
  const url = new URL(canonical);
  if (request.headers.get('host') !== url.host) throw new MobileAuthError('invalid_origin', 403);
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== url.origin) ||
    (!['GET', 'HEAD'].includes(request.method) && origin !== url.origin)
  )
    throw new MobileAuthError('invalid_origin', 403);
  return url.origin;
}
const userFields = {
  id: true,
  name: true,
  email: true,
  image: true,
  bio: true,
  color: true,
  createdAt: true,
} as const;
function publicUser(user: {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  bio: string;
  color: string;
  createdAt: Date;
}) {
  return { ...user, name: user.name || 'Reader', createdAt: user.createdAt.toISOString() };
}
export async function requireMobileSession(request: Request) {
  configured();
  const origin = mobileAuthOrigin(request);
  const authorization = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match) throw new MobileAuthError('invalid_session');
  const session = await database.session.findFirst({
    where: {
      sessionToken: hashSession(match[1]),
      kind: 'mobile',
      origin,
      expires: { gt: new Date() },
    },
    include: { user: { select: userFields } },
  });
  if (!session) throw new MobileAuthError('invalid_session');
  return {
    user: publicUser(session.user),
    expires: session.expires.toISOString(),
    sessionId: session.id,
    permissions: grantedPermissions(session.permissions),
  };
}
export async function requireMobileLibrarySession(request: Request) {
  const session = await requireMobileSession(request);
  if (!session.permissions.includes('library_sync'))
    throw new MobileAuthError('library_permission_required', 403);
  return session;
}
export async function revokeMobileSession(request: Request) {
  const session = await requireMobileSession(request);
  await database.session.deleteMany({
    where: { id: session.sessionId, userId: session.user.id, kind: 'mobile' },
  });
}
