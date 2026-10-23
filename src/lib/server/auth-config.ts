import 'server-only';
import { appleConfigured } from './apple-auth';

export function authProviders(): ('google' | 'apple')[] {
  return [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? ['google' as const] : []),
    ...(appleConfigured() ? ['apple' as const] : []),
  ];
}

export function authEnabled() {
  const origin = process.env.APP_ORIGIN;
  const hosted = Boolean(origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(origin));
  return (
    process.env.AUTH_ENABLED === 'true' ||
    hosted ||
    Boolean(process.env.AUTH_GOOGLE_ID || process.env.AUTH_GOOGLE_SECRET)
  );
}

export function authConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET && authProviders().length > 0);
}

/** Native credentials are always issued for one explicitly configured origin. */
export function nativeAuthOrigin(): string | null {
  try {
    if (!process.env.APP_ORIGIN) return null;
    const url = new URL(process.env.APP_ORIGIN);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function nativeAuthConfigured() {
  return authEnabled() && authConfigured() && nativeAuthOrigin() !== null;
}

export const secureCookies = process.env.APP_ORIGIN?.startsWith('https://') === true;
export const sessionCookieName = `${secureCookies ? '__Secure-' : ''}ai-read.session-token`;
