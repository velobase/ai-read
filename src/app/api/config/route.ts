import { observedRoute } from '@/lib/server/observability';
import { authEnabled } from '@/lib/server/auth-config';
import { auth } from '@/lib/server/auth';
import { publicAIConfig } from '@/lib/server/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET() {
  const enabled = authEnabled();
  const userId = enabled ? (await auth())?.user?.id : undefined;
  const requiresLogin = enabled && !userId;
  try {
    const server = await publicAIConfig(userId);
    return Response.json(
      {
        ...server,
        requiresLogin,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('ai.config', { userId }, error);
    return Response.json({ error: '暂时无法读取 AI 配置，请重试。' }, { status: 503 });
  }
}

export const GET = observedRoute('api.config', handleGET);
