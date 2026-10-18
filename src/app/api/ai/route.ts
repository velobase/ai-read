import { handleAI } from '@/lib/server/ai';
import { auth } from '@/lib/server/auth';
import { authEnabled } from '@/lib/server/auth-config';
import { unauthorized } from '@/lib/server/account-request';
import { serverAIConfig } from '@/lib/server/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const enabled = authEnabled();
  const userId = enabled ? (await auth())?.user?.id : undefined;
  if (enabled && !userId) return unauthorized();
  try {
    return await handleAI(request, await serverAIConfig(userId));
  } catch {
    return Response.json({ error: 'AI 配置暂时不可用，请稍后重试。' }, { status: 503 });
  }
}
