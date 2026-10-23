import { mobileAuthFailure, revokeMobileSession } from '@/lib/server/mobile-auth';
import { observedRoute } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const DELETE = observedRoute('api.account.sessions', async (request: Request) => {
  try {
    await revokeMobileSession(request);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
