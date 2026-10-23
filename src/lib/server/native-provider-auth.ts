import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { database } from './database';
import { hashSession } from './auth';
import { nativeAuthConfigured } from './auth-config';
import {
  appleClientSecret,
  appleConfigured,
  encryptAppleToken,
  nativeAppleClientId,
} from './apple-auth';
import { MobileAuthError, mobileAuthOrigin, requireMobileSession } from './mobile-auth';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'), {
  timeoutDuration: 8000,
});
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 8000,
});
const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const opaque = /^[A-Za-z0-9_-]{43}$/;
const month = 30 * 24 * 60 * 60 * 1000;
const userFields = {
  id: true,
  name: true,
  email: true,
  image: true,
  bio: true,
  color: true,
  createdAt: true,
} as const;
const challengeKey = () => new TextEncoder().encode(process.env.AUTH_SECRET!);
function providerInput(value: unknown): 'apple' | 'google' {
  if (value !== 'apple' && value !== 'google') throw new MobileAuthError('invalid_request', 400);
  if (
    !nativeAuthConfigured() ||
    (value === 'apple'
      ? !appleConfigured()
      : !process.env.AUTH_GOOGLE_IOS_ID || !process.env.AUTH_GOOGLE_ID)
  )
    throw new MobileAuthError('auth_unavailable', 503);
  return value;
}

/** Stateless, five-minute challenge. Exchange consumes it exactly once in the database. */
export async function nativeChallenge(request: Request, body: Record<string, unknown>) {
  const origin = mobileAuthOrigin(request);
  const provider = providerInput(body.provider);
  if (typeof body.code_challenge !== 'string' || !opaque.test(body.code_challenge))
    throw new MobileAuthError('invalid_request', 400);
  const nonce = token();
  const challenge = await new SignJWT({ provider, nonce, codeChallenge: body.code_challenge })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(origin)
    .setAudience('leafread-native-signin-v1')
    .setJti(token())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(challengeKey());
  return {
    challenge,
    nonce,
    ...(provider === 'google'
      ? {
          googleClientId: process.env.AUTH_GOOGLE_IOS_ID,
          googleServerClientId: process.env.AUTH_GOOGLE_ID,
        }
      : {}),
  };
}

async function identityToken(value: string, provider: 'apple' | 'google', nonce: string) {
  try {
    const { payload } = await jwtVerify(value, provider === 'apple' ? appleKeys : googleKeys, {
      algorithms: ['RS256'],
      issuer:
        provider === 'apple'
          ? 'https://appleid.apple.com'
          : ['https://accounts.google.com', 'accounts.google.com'],
      audience: provider === 'apple' ? nativeAppleClientId : process.env.AUTH_GOOGLE_ID!,
      requiredClaims: ['sub', 'iat', 'exp', 'nonce'],
      maxTokenAge: '10m',
      clockTolerance: 10,
    });
    if (
      payload.nonce !== nonce ||
      !payload.sub ||
      payload.sub.length > 255 ||
      (provider === 'google' && payload.azp !== process.env.AUTH_GOOGLE_IOS_ID)
    )
      throw new Error('identity_mismatch');
    return payload;
  } catch {
    throw new MobileAuthError('invalid_provider_token');
  }
}

function verifiedEmail(payload: JWTPayload) {
  if (
    String(payload.email_verified) !== 'true' ||
    typeof payload.email !== 'string' ||
    payload.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
  )
    throw new MobileAuthError('provider_email_required');
  return payload.email;
}

export async function nativeProviderSignIn(request: Request, body: Record<string, unknown>) {
  const origin = mobileAuthOrigin(request);
  const provider = providerInput(body.provider);
  if (
    typeof body.challenge !== 'string' ||
    body.challenge.length > 2048 ||
    typeof body.code_verifier !== 'string' ||
    !opaque.test(body.code_verifier) ||
    typeof body.identityToken !== 'string' ||
    body.identityToken.length > 8192
  )
    throw new MobileAuthError('invalid_request', 400);
  let challenge: JWTPayload;
  try {
    ({ payload: challenge } = await jwtVerify(body.challenge, challengeKey(), {
      algorithms: ['HS256'],
      issuer: origin,
      audience: 'leafread-native-signin-v1',
      requiredClaims: ['jti', 'iat', 'exp'],
      maxTokenAge: '5m',
    }));
    if (
      challenge.provider !== provider ||
      challenge.codeChallenge !== digest(body.code_verifier) ||
      typeof challenge.nonce !== 'string' ||
      !opaque.test(challenge.nonce)
    )
      throw new Error('challenge');
  } catch {
    throw new MobileAuthError('invalid_grant');
  }
  const identity = await identityToken(body.identityToken, provider, challenge.nonce as string);
  let appleRefresh: string | undefined;
  if (provider === 'apple') {
    if (
      typeof body.authorizationCode !== 'string' ||
      !body.authorizationCode ||
      body.authorizationCode.length > 2048
    )
      throw new MobileAuthError('invalid_request', 400);
    const response = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: nativeAppleClientId,
        client_secret: appleClientSecret(nativeAppleClientId),
        code: body.authorizationCode,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new MobileAuthError('invalid_provider_code');
    const tokens = await response.json();
    if (
      typeof tokens.id_token !== 'string' ||
      typeof tokens.refresh_token !== 'string' ||
      tokens.refresh_token.length > 8192
    )
      throw new MobileAuthError('auth_unavailable', 503);
    const exchanged = await identityToken(tokens.id_token, provider, challenge.nonce as string);
    if (exchanged.sub !== identity.sub) throw new MobileAuthError('invalid_provider_token');
    appleRefresh = tokens.refresh_token;
  }
  const sessionToken = token();
  const expires = new Date(Date.now() + month);
  const providerAccountId = identity.sub!;
  try {
    const session = await database.$transaction(async (tx) => {
      // Serialize both new and existing native sign-ins for this provider identity.
      const lock = `${provider}:${providerAccountId}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      await tx.nativeAuthUse.deleteMany({ where: { expires: { lte: new Date() } } });
      await tx.nativeAuthUse.create({
        data: {
          id: hashSession(body.challenge as string),
          expires: new Date(challenge.exp! * 1000),
        },
      });
      const account = await tx.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
      });
      let userId = account?.userId;
      if (userId) {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        // Account deletion might have completed while the row lock was acquired.
        if (!(await tx.account.findUnique({ where: { id: account!.id } })))
          throw new MobileAuthError('account_changed', 409);
      } else {
        const email = verifiedEmail(identity);
        // Never attach an unrelated provider solely because its email happens to match.
        if (await tx.user.findUnique({ where: { email } }))
          throw new MobileAuthError('account_link_required', 409);
        const rawName = provider === 'apple' ? body.name : identity.name;
        const name =
          typeof rawName === 'string'
            ? rawName
                .replace(/[\u0000-\u001f\u007f]/g, '')
                .trim()
                .slice(0, 200)
            : 'Reader';
        const image =
          provider === 'google' &&
          typeof identity.picture === 'string' &&
          /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(identity.picture)
            ? identity.picture.slice(0, 2000)
            : null;
        const user = await tx.user.create({
          data: { email, emailVerified: new Date(), name: name || 'Reader', image },
        });
        userId = user.id;
        await tx.account.create({ data: { userId, provider, providerAccountId, type: 'oidc' } });
      }
      if (appleRefresh)
        await tx.account.update({
          where: { provider_providerAccountId: { provider, providerAccountId } },
          data: {
            encryptedNativeAppleRefreshToken: encryptAppleToken(
              appleRefresh,
              userId,
              providerAccountId,
            ),
          },
        });
      return tx.session.create({
        data: {
          userId,
          sessionToken: hashSession(sessionToken),
          expires,
          kind: 'mobile',
          origin,
          permissions: ['account_ai'],
          device: 'LeafRead · iOS',
        },
        include: { user: { select: userFields } },
      });
    });
    return {
      token: sessionToken,
      expires: expires.toISOString(),
      sessionId: session.id,
      user: session.user,
      permissions: session.permissions,
    };
  } catch (error) {
    if (error instanceof MobileAuthError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
      throw new MobileAuthError('signin_retry', 409);
    throw error;
  }
}

/** Renew the same credential; never resurrect a revoked or idle-expired session. */
export async function renewNativeSession(request: Request) {
  const current = await requireMobileSession(request);
  const session = await database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${current.user.id} FOR UPDATE`;
    const record = await tx.session.findFirst({
      where: { id: current.sessionId, kind: 'mobile', expires: { gt: new Date() } },
    });
    if (
      !record ||
      record.sessionToken !== hashSession(request.headers.get('authorization')!.slice(7))
    )
      throw new MobileAuthError('invalid_session');
    // Active sessions renew to 30 days, with a six-month absolute reauthentication bound.
    const expires = new Date(Math.min(Date.now() + month, record.createdAt.getTime() + 6 * month));
    if (expires.getTime() <= Date.now()) throw new MobileAuthError('invalid_session');
    return tx.session.update({
      where: { id: record.id },
      data: { expires },
      include: { user: { select: userFields } },
    });
  });
  return {
    token: request.headers.get('authorization')!.slice(7),
    expires: session.expires.toISOString(),
    sessionId: session.id,
    permissions: session.permissions,
    user: session.user,
  };
}

/** The separate in-app confirmation authorizes only this already authenticated account. */
export async function grantNativeLibrary(request: Request, body: Record<string, unknown>) {
  const current = await requireMobileSession(request);
  if (body.confirmation !== current.user.id || body.permission !== 'library_sync')
    throw new MobileAuthError('invalid_consent', 403);
  // Retain the credential so retrying a lost grant response remains idempotent.
  const sessionToken = request.headers.get('authorization')!.slice(7);
  const session = await database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${current.user.id} FOR UPDATE`;
    const record = await tx.session.findFirst({
      where: {
        id: current.sessionId,
        userId: current.user.id,
        kind: 'mobile',
        expires: { gt: new Date() },
      },
    });
    if (
      !record ||
      record.sessionToken !== hashSession(request.headers.get('authorization')!.slice(7))
    )
      throw new MobileAuthError('invalid_session');
    return tx.session.update({
      where: { id: record.id },
      data: {
        permissions: ['account_ai', 'library_sync'],
      },
      include: { user: { select: userFields } },
    });
  });
  return {
    token: sessionToken,
    expires: session.expires.toISOString(),
    sessionId: session.id,
    permissions: session.permissions,
    user: session.user,
  };
}
