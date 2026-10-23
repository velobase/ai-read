import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, sign } from 'node:crypto';

export function appleConfigured() {
  return Boolean(
    process.env.AUTH_APPLE_ID &&
    process.env.AUTH_APPLE_TEAM_ID &&
    process.env.AUTH_APPLE_KEY_ID &&
    process.env.AUTH_APPLE_PRIVATE_KEY &&
    process.env.AI_ENCRYPTION_KEY,
  );
}

// Short-lived client secrets are generated for each OAuth request, never shipped to clients.
export function appleClientSecret() {
  if (!appleConfigured()) throw new Error('apple_auth_unavailable');
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'ES256', kid: process.env.AUTH_APPLE_KEY_ID })}.${encode({
    iss: process.env.AUTH_APPLE_TEAM_ID,
    iat: now,
    exp: now + 3600,
    aud: 'https://appleid.apple.com',
    sub: process.env.AUTH_APPLE_ID,
  })}`;
  const signature = sign('sha256', Buffer.from(body), {
    key: process.env.AUTH_APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    dsaEncoding: 'ieee-p1363',
  });
  return `${body}.${signature.toString('base64url')}`;
}
function key() {
  const value = process.env.AI_ENCRYPTION_KEY || '';
  const result = Buffer.from(value, 'base64');
  if (result.length !== 32 || result.toString('base64') !== value)
    throw new Error('apple_auth_unavailable');
  return result;
}
const context = (userId: string, subject: string) =>
  Buffer.from(JSON.stringify(['leafread-apple-revocation-v1', userId, subject]));
export function encryptAppleToken(token: string, userId: string, subject: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(context(userId, subject));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export async function revokeAppleToken(envelope: string, userId: string, subject: string) {
  const [version, iv, tag, data, extra] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra !== undefined)
    throw new Error('apple_revocation_unavailable');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAAD(context(userId, subject));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const token = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const response = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AUTH_APPLE_ID!,
      client_secret: appleClientSecret(),
      token,
      token_type_hint: 'refresh_token',
    }),
  });
  if (!response.ok) throw new Error('apple_revocation_unavailable');
}
