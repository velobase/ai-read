import { observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { authEnabled, authProviders } from '@/lib/server/auth-config';
import { database } from '@/lib/server/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET() {
  const enabled = authEnabled();
  const session = await auth();
  const user = session?.user?.id
    ? await database.user.findUnique({
        where: { id: session.user.id },
        select: {
          id: true,
          isAdmin: true,
          name: true,
          email: true,
          image: true,
          bio: true,
          color: true,
          createdAt: true,
        },
      })
    : null;
  return Response.json(
    {
      enabled,
      providers: authProviders(),
      user: user ? { ...user, name: user.name || '读书的人' } : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = observedRoute('api.identity', handleGET);
