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
    const params = new URL(request.url).searchParams;
    const allowed = new Set(['code_challenge', 'code_challenge_method', 'state']);
    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1)
        return Response.json(
          { error: 'invalid_request' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
    }
    return Response.json(
      await mobileConsent(request, mobileAuthorizationInput(Object.fromEntries(params)), 'library'),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
export const POST = observedRoute('api.account', async (request: Request) => {
  try {
    return Response.json(await authorizeMobile(request, await mobileAuthBody(request), 'library'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
