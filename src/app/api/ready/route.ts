import { authConfigured } from '@/lib/server/auth-config';
import { database } from '@/lib/server/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!authConfigured()) throw new Error('Authentication is not configured.');
    // This also checks that the identity migration has been applied.
    await database.user.findFirst({ select: { id: true } });
    return Response.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
