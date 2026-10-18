import { authConfigured } from '@/lib/server/auth-config';
import { database } from '@/lib/server/database';
import { assertAIEncryptionConfigured } from '@/lib/server/ai-credentials';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!authConfigured()) throw new Error('Authentication is not configured.');
    // Verify both the identity and account AI migrations before accepting traffic.
    assertAIEncryptionConfigured();
    await database.user.findFirst({ select: { id: true } });
    await database.aIConnection.findFirst({ select: { userId: true } });
    return Response.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
