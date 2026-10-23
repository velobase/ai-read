import { observedRoute } from '@/lib/server/observability';
import { auth, hashSession } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { accountBody, unauthorized } from '@/lib/server/account-request';
import { sessionCookieName } from '@/lib/server/auth-config';
import { profileColors } from '@/lib/library-state';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  const token = (await cookies()).get(sessionCookieName)?.value;
  const [accounts, sessions] = await Promise.all([
    database.account.findMany({ where: { userId: session.user.id }, select: { provider: true } }),
    database.session.findMany({
      where: { userId: session.user.id, expires: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return Response.json({
    accounts,
    sessions: sessions.map(({ id, device, createdAt, expires, sessionToken }) => ({
      id,
      device,
      createdAt,
      expires,
      current: Boolean(token && hashSession(token) === sessionToken),
    })),
  });
}

async function handlePATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await accountBody(request);
  } catch {
    return Response.json({ error: '无法读取资料，请重试。' }, { status: 400 });
  }
  const { name, bio, color } = body;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 40 ||
    typeof bio !== 'string' ||
    bio.length > 120 ||
    typeof color !== 'string' ||
    !profileColors.includes(color)
  ) {
    return Response.json(
      { error: '请填写 1–40 字的昵称、120 字以内的简介，并选择头像颜色。' },
      { status: 400 },
    );
  }
  await database.user.update({
    where: { id: session.user.id },
    data: { name: name.trim(), bio: bio.trim(), color },
  });
  return Response.json({ ok: true });
}

export const GET = observedRoute('api.account', handleGET);
export const PATCH = observedRoute('api.account', handlePATCH);
