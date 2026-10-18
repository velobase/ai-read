import { auth, hashSession } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { accountBody, unauthorized } from '@/lib/server/account-request';
import { sessionCookieName } from '@/lib/server/auth-config';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
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
  if (body.scope === 'others') {
    await database.session.deleteMany({
      where: { userId: session.user.id, sessionToken: { not: current } },
    });
  } else if (typeof body.id === 'string' && body.id.length <= 50) {
    await database.session.deleteMany({
      where: { id: body.id, userId: session.user.id, sessionToken: { not: current } },
    });
  } else return Response.json({ error: '请选择要退出的设备。' }, { status: 400 });
  return Response.json({ ok: true });
}
