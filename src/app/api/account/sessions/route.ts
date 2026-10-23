import { observedRoute } from '@/lib/server/observability';
import { auth, hashSession } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { accountBody, unauthorized } from '@/lib/server/account-request';
import { sessionCookieName } from '@/lib/server/auth-config';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleDELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await accountBody(request);
  } catch {
    return Response.json({ error: '请求格式不正确。' }, { status: 400 });
  }
  const cookie = (await cookies()).get(sessionCookieName)?.value;
  if (!cookie) return unauthorized();
  const current = hashSession(cookie);
  const id = typeof body.id === 'string' && body.id.length <= 50 ? body.id : undefined;
  if (body.scope !== 'others' && id === undefined)
    return Response.json({ error: '请选择要退出的设备。' }, { status: 400 });
  const userId = session.user.id;
  const revoked = await database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const acting = await tx.session.findFirst({
      where: { sessionToken: current, userId, kind: 'web', expires: { gt: new Date() } },
      select: { id: true },
    });
    if (!acting) return false;
    if (body.scope === 'others') {
      await tx.session.deleteMany({ where: { userId, sessionToken: { not: current } } });
    } else {
      await tx.session.deleteMany({ where: { id, userId, sessionToken: { not: current } } });
    }
    return true;
  });
  if (!revoked) return unauthorized();
  return Response.json({ ok: true });
}

export const DELETE = observedRoute('api.account.sessions', handleDELETE);
