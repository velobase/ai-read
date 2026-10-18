import 'server-only';

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
  return Boolean(
    process.env.DATABASE_URL &&
    process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET,
  );
}

export const secureCookies = process.env.APP_ORIGIN?.startsWith('https://') === true;
export const sessionCookieName = `${secureCookies ? '__Secure-' : ''}ai-read.session-token`;
