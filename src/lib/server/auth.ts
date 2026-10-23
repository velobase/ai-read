import 'server-only';
import { createHash } from 'node:crypto';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter } from 'next-auth/adapters';
import { headers } from 'next/headers';
import { database } from './database';
import { authEnabled, authConfigured, secureCookies, sessionCookieName } from './auth-config';

export const hashSession = (token: string) => createHash('sha256').update(token).digest('hex');

const adapter: Adapter = {
  ...PrismaAdapter(database),
  // Identity is all we need. Never persist Google's access, refresh or ID tokens.
  async linkAccount({ userId, provider, providerAccountId, type }) {
    await database.account.create({ data: { userId, provider, providerAccountId, type } });
  },
  async createSession(data) {
    const agent = (await headers()).get('user-agent') || '';
    const browser = /Edg\//.test(agent)
      ? 'Edge'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : '浏览器';
    const platform = /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Android/.test(agent)
        ? 'Android'
        : /Macintosh/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'Windows'
            : '其他设备';
    const session = await database.session.create({
      data: {
        ...data,
        sessionToken: hashSession(data.sessionToken),
        device: `${browser} · ${platform}`,
        kind: 'web',
      },
    });
    return { ...session, sessionToken: data.sessionToken };
  },
  async getSessionAndUser(token) {
    const record = await database.session.findUnique({
      where: { sessionToken: hashSession(token) },
      include: { user: true },
    });
    if (!record || record.kind !== 'web') return null;
    const { user, ...session } = record;
    return { user, session: { ...session, sessionToken: token } };
  },
  async updateSession({ sessionToken, expires }) {
    const record = await database.session.updateMany({
      where: { sessionToken: hashSession(sessionToken), kind: 'web' },
      data: { expires },
    });
    if (!record.count) return null;
    const session = await database.session.findUnique({
      where: { sessionToken: hashSession(sessionToken) },
    });
    return session ? { ...session, sessionToken } : null;
  },
  async deleteSession(token) {
    const sessionToken = hashSession(token);
    const record = await database.session.findFirst({
      where: { sessionToken, kind: 'web' },
      select: { userId: true },
    });
    if (!record) return;
    await database.$transaction(async (tx) => {
      // Use the same account lock as mobile authorization/exchange. Deleting the
      // browser session also cascades every unexchanged grant issued by it.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${record.userId} FOR UPDATE`;
      await tx.session.deleteMany({ where: { sessionToken, userId: record.userId, kind: 'web' } });
    });
  },
};

const nextAuth = NextAuth({
  adapter,
  trustHost: true, // src/proxy.ts validates Host and strips forwarded host headers.
  secret: process.env.AUTH_SECRET,
  logger: {
    error(error) {
      console.error(`[auth] ${error.name}`);
    },
  },
  useSecureCookies: secureCookies,
  cookies: {
    sessionToken: {
      name: sessionCookieName,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: secureCookies },
    },
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } },
      checks: ['pkce', 'state', 'nonce'],
    }),
  ],
  session: { strategy: 'database', maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    signIn({ account, profile }) {
      return account?.provider === 'google' && profile?.email_verified === true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
    redirect({ url, baseUrl }) {
      try {
        const target = new URL(url, baseUrl);
        return target.origin === baseUrl ? target.href : baseUrl;
      } catch {
        return baseUrl;
      }
    },
  },
});

export const handlers = nextAuth.handlers;
export async function auth() {
  if (!authEnabled()) return null;
  if (!authConfigured()) throw new Error('Authentication is enabled but not fully configured.');
  return nextAuth.auth();
}
