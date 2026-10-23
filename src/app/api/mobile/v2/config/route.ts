import {
  mobileCapabilities,
  mobileLibraryEntities,
  type MobileLibraryCapabilities,
} from '../../../../../../packages/api-client/src';
import { observedRoute } from '@/lib/server/observability';
import { mobileAI, mobileAIContextKey } from '@/lib/server/mobile-ai';
import { nativeAuthConfigured } from '@/lib/server/auth-config';
import { mobileAuthFailure, requireMobileSession } from '@/lib/server/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = observedRoute('api.config', async (request: Request) => {
  try {
    const { config, authenticated } = await mobileAI(request, true);
    const session = authenticated ? await requireMobileSession(request) : null;
    const capabilities: MobileLibraryCapabilities = {
      ...mobileCapabilities,
      version: 2,
      nativeAccount: nativeAuthConfigured(),
      // This advertises the backend protocol, not an enabled client outbox.
      nativeAccountSync: nativeAuthConfigured(),
      librarySync: { version: 1, entities: [...mobileLibraryEntities] },
      permissions: session?.permissions ?? [],
      authenticated: !!session,
      nativeAI: !!config,
      nativeTranslation: !!config,
      ...(config
        ? {
            aiModel: config.model,
            aiContextKey: mobileAIContextKey(config),
          }
        : {}),
    };
    return Response.json(capabilities, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return mobileAuthFailure(error);
  }
});
