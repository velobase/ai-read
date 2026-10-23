import { logException, observedRoute } from '@/lib/server/observability';
import { authConfigured } from '@/lib/server/auth-config';
import { database } from '@/lib/server/database';
import { assertAIEncryptionConfigured } from '@/lib/server/ai-credentials';

export const dynamic = 'force-dynamic';

async function handleGET() {
  try {
    if (!authConfigured()) throw new Error('Authentication is not configured.');
    // Verify both the identity and account AI migrations before accepting traffic.
    assertAIEncryptionConfigured();
    await database.user.findFirst({ select: { id: true } });
    await database.aIConnection.findFirst({ select: { userId: true, translationPrompt: true } });
    await database.translationEdition.findFirst({ select: { id: true, leaseUntil: true } });
    await database.translationChapter.findFirst({ select: { editionId: true, checkpoint: true } });
    await database.translationSelection.findFirst({ select: { editionId: true } });
    return Response.json({ status: 'ready' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logException('readiness', error);
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const GET = observedRoute('api.ready', handleGET);
