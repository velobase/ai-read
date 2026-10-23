import {
  mobileAuthFailure,
  requireMobileSession,
  revokeMobileSession,
} from '@/lib/server/mobile-auth';
import { observedRoute } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = observedRoute('api.identity', async (request: Request) => {
  try {
    return Response.json(await requireMobileSession(request), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
export const DELETE = observedRoute('api.account.sessions', async (request: Request) => {
  try {
    await revokeMobileSession(request);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
