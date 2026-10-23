import { mobileCapabilities } from '../../../../../../packages/api-client/src';
import { observedRoute } from '@/lib/server/observability';
import { mobileAI, mobileAIContextKey, mobileTranslationContextKey } from '@/lib/server/mobile-ai';
import { nativeAuthConfigured } from '@/lib/server/auth-config';
import { mobileAuthFailure } from '@/lib/server/mobile-auth';

export const dynamic = 'force-dynamic';
export const GET = observedRoute('api.config', async (request: Request) => {
  try {
    const { config, authenticated } = await mobileAI(request, true);
    return Response.json(
      {
        ...mobileCapabilities,
        nativeAccount: nativeAuthConfigured(),
        authenticated,
        nativeAI: !!config,
        nativeTranslation: !!config,
        ...(config
          ? {
              aiModel: config.model,
              aiContextKey: mobileAIContextKey(config),
              translationContextKey: mobileTranslationContextKey(config),
            }
          : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
