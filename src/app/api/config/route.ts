import { authEnabled } from '@/lib/server/auth-config';
import { auth } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const requiresLogin = authEnabled() && !(await auth())?.user?.id;
  return Response.json(
    {
      baseUrl: process.env.AI_BASE_URL || '',
      model: process.env.AI_MODEL || '',
      hasKey: !requiresLogin && Boolean(process.env.AI_API_KEY),
      requiresLogin,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
