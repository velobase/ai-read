import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { auth, hashSession } from './auth';
import { nativeAuthConfigured, nativeAuthOrigin, sessionCookieName } from './auth-config';
import { database } from './database';
import { accountBody } from './account-request';
import {
  mobileAIPermissions,
  mobileLibraryPermissions,
  readMobilePermissions,
  type MobilePermission,
} from '../../../packages/api-client/src/library';

export const mobileCallback = 'com.velobase.bypage://auth/callback';
export type { MobilePermission } from '../../../packages/api-client/src/library';
export type MobileAuthorizationProfile = 'ai' | 'library';
function profilePermissions(profile: MobileAuthorizationProfile): MobilePermission[] {
  if (profile === 'ai') return [...mobileAIPermissions];
  if (profile === 'library') return [...mobileLibraryPermissions];
  throw new MobileAuthError('invalid_request', 400);
}
function grantedPermissions(value: unknown): MobilePermission[] {
  // Only persisted grants determine access. Never accept permissions from the
  // token exchange body, a caller's user ID, or the current client version.
  const permissions = readMobilePermissions(value);
  if (permissions?.includes('account_ai')) return permissions;
  throw new MobileAuthError('invalid_session');
}
const lifetime = 5 * 60 * 1000;
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const randomToken = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const opaque = /^[A-Za-z0-9_-]{43}$/;
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export class MobileAuthError extends Error {
  constructor(
    public code: string,
    public status = 401,
  ) {
    super(code);
  }
}
export function mobileAuthFailure(error: unknown) {
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
  } catch {
    throw new MobileAuthError('invalid_request', 400);
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
export function mobileAuthorizationInput(value: Record<string, unknown>) {
  const challenge = value.code_challenge,
    state = value.state;
  if (
    typeof challenge !== 'string' ||
    !opaque.test(challenge) ||
    typeof state !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(state)
  )
    throw new MobileAuthError('invalid_request', 400);
  if (value.code_challenge_method !== undefined && value.code_challenge_method !== 'S256')
    throw new MobileAuthError('invalid_request', 400);
  return { challenge, state };
}
type AuthorizationInput = ReturnType<typeof mobileAuthorizationInput>;
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
async function webSession() {
  configured();
  const userId = (await auth())?.user?.id;
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!userId || !token) throw new MobileAuthError('invalid_session');
  const session = await database.session.findFirst({
    where: { sessionToken: hashSession(token), userId, kind: 'web', expires: { gt: new Date() } },
    include: { user: { select: userFields } },
  });
  if (!session) throw new MobileAuthError('invalid_session');
  return session;
}
function nonceSignature(
  value: string,
  sessionHash: string,
  origin: string,
  input: AuthorizationInput,
  profile: MobileAuthorizationProfile,
) {
  return createHmac('sha256', process.env.AUTH_SECRET!)
    .update(
      [
        profile === 'ai' ? 'bypage-mobile-consent-v1' : 'bypage-mobile-consent-v2',
        value,
        sessionHash,
        origin,
        input.challenge,
        input.state,
        mobileCallback,
        // Preserve the existing v1 nonce exactly. The separate v2 signature
        // binds the fixed profile and its complete permission set.
        ...(profile === 'library' ? [profile, profilePermissions(profile).join(',')] : []),
      ].join('\n'),
    )
    .digest('base64url');
}

/** GET creates no authorization grant; this nonce can only be used with this browser session. */
export async function mobileConsent(
  request: Request,
  input: AuthorizationInput,
  profile: MobileAuthorizationProfile = 'ai',
) {
  const permissions = profilePermissions(profile);
  const origin = mobileAuthOrigin(request);
  const session = await webSession();
  const value = `${Date.now().toString(36)}.${randomToken()}`;
  return {
    nonce: `${value}.${nonceSignature(value, session.sessionToken, origin, input, profile)}`,
    user: publicUser(session.user),
    issuer: origin,
    permissions,
  };
}

export async function authorizeMobile(
  request: Request,
  body: Record<string, unknown>,
  profile: MobileAuthorizationProfile = 'ai',
) {
  const permissions = profilePermissions(profile);
  const origin = mobileAuthOrigin(request);
  const input = mobileAuthorizationInput(body);
  const session = await webSession();
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const parts = nonce.split('.');
  const issued = parseInt(parts[0] || '', 36);
  if (
    nonce.length > 120 ||
    parts.length !== 3 ||
    !opaque.test(parts[1]) ||
    !opaque.test(parts[2]) ||
    !Number.isSafeInteger(issued) ||
    issued > Date.now() + 5000 ||
    Date.now() - issued > lifetime ||
    body.userId !== session.userId ||
    !equal(
      parts[2],
      nonceSignature(`${parts[0]}.${parts[1]}`, session.sessionToken, origin, input, profile),
    )
  )
    throw new MobileAuthError('invalid_consent', 403);
  const code = randomToken();
  await database.$transaction(async (tx) => {
    // Bound pending handoffs per account and serialize issuance with exchange.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
    await tx.mobileAuthorization.deleteMany({
      where: { userId: session.userId, expires: { lte: new Date() } },
    });
    if ((await tx.mobileAuthorization.count({ where: { userId: session.userId } })) >= 10)
      throw new MobileAuthError('too_many_authorizations', 429);
    const parent = await tx.session.findFirst({
      where: { id: session.id, kind: 'web', expires: { gt: new Date() } },
    });
    if (!parent) throw new MobileAuthError('invalid_session');
    await tx.mobileAuthorization.create({
      data: {
        codeHash: hashSession(code),
        codeChallenge: input.challenge,
        stateHash: hashSession(input.state),
        origin,
        permissions,
        userId: session.userId,
        webSessionId: session.id,
        expires: new Date(Date.now() + lifetime),
      },
    });
  });
  const redirect = new URL(mobileCallback);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', input.state);
  redirect.searchParams.set('issuer', origin);
  return { redirect: redirect.href };
}

export async function exchangeMobileCode(request: Request, body: Record<string, unknown>) {
  configured();
  const origin = mobileAuthOrigin(request);
  const code = body.code,
    verifier = body.code_verifier,
    state = body.state;
  if (
    typeof code !== 'string' ||
    !opaque.test(code) ||
    typeof verifier !== 'string' ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
    typeof state !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(state)
  )
    throw new MobileAuthError('invalid_request', 400);
  const codeHash = hashSession(code);
  const token = randomToken();
  const expires = new Date(Date.now() + sessionLifetime);
  const session = await database.$transaction(async (tx) => {
    const grant = await tx.mobileAuthorization.findUnique({ where: { codeHash } });
    if (
      !grant ||
      grant.origin !== origin ||
      grant.expires.getTime() <= Date.now() ||
      !equal(grant.codeChallenge, digest(verifier)) ||
      !equal(grant.stateHash, hashSession(state))
    )
      throw new MobileAuthError('invalid_grant');
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${grant.userId} FOR UPDATE`;
    const parent = await tx.session.findFirst({
      where: {
        id: grant.webSessionId,
        userId: grant.userId,
        kind: 'web',
        expires: { gt: new Date() },
      },
    });
    if (!parent) throw new MobileAuthError('invalid_grant');
    const permissions = grantedPermissions(grant.permissions);
    // Exactly one concurrent exchange may delete the grant and create a session.
    const consumed = await tx.mobileAuthorization.deleteMany({
      where: { codeHash, expires: { gt: new Date() } },
    });
    if (consumed.count !== 1) throw new MobileAuthError('invalid_grant');
    return tx.session.create({
      data: {
        sessionToken: hashSession(token),
        userId: grant.userId,
        expires,
        kind: 'mobile',
        origin,
        permissions,
        device: 'ByPage · iOS',
      },
      include: { user: { select: userFields } },
    });
  });
  return {
    token,
    expires: expires.toISOString(),
    sessionId: session.id,
    user: publicUser(session.user),
    permissions: grantedPermissions(session.permissions),
  };
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
