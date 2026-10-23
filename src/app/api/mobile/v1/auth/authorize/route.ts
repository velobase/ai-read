import {
  authorizeMobile,
  mobileAuthorizationInput,
  mobileAuthFailure,
  mobileConsent,
  mobileAuthBody,
} from '@/lib/server/mobile-auth';
import { observedRoute } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = observedRoute('api.account', async (request: Request) => {
  try {
    const values = Object.fromEntries(new URL(request.url).searchParams);
    return Response.json(await mobileConsent(request, mobileAuthorizationInput(values)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
export const POST = observedRoute('api.account', async (request: Request) => {
  try {
    return Response.json(await authorizeMobile(request, await mobileAuthBody(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
