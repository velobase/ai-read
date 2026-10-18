import { authEnabled } from '@/lib/server/auth-config';
import { auth } from '@/lib/server/auth';
import { serverAIConfig } from '@/lib/server/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const enabled = authEnabled();
  const userId = enabled ? (await auth())?.user?.id : undefined;
  const requiresLogin = enabled && !userId;
  const server = serverAIConfig(userId);
  return Response.json(
    {
      baseUrl: server.baseUrl,
      model: server.model,
      hasKey: Boolean(server.apiKey),
      requiresLogin,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
