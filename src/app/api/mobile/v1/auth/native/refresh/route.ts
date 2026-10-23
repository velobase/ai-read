import { renewNativeSession } from '@/lib/server/native-provider-auth';
import { mobileAuthFailure } from '@/lib/server/mobile-auth';
import { observedRoute } from '@/lib/server/observability';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = observedRoute('api.account', async (request: Request) => {
  try {
    return Response.json(await renewNativeSession(request), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
