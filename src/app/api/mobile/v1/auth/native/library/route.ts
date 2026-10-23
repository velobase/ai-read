import { grantNativeLibrary } from '@/lib/server/native-provider-auth';
import { mobileAuthFailure, mobileAuthBody } from '@/lib/server/mobile-auth';
import { observedRoute } from '@/lib/server/observability';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = observedRoute('api.account', async (request: Request) => {
  try {
    return Response.json(await grantNativeLibrary(request, await mobileAuthBody(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
