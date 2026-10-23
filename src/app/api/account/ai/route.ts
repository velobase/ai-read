import { auth } from '@/lib/server/auth';
import { accountBody, unauthorized } from '@/lib/server/account-request';
import { database } from '@/lib/server/database';
import { publicAIConfig } from '@/lib/server/ai-config';
import { MAX_TRANSLATION_PROMPT_LENGTH } from '@/lib/translation-prompt';
export const runtime = 'nodejs';
export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return unauthorized();
  try {
    return Response.json(await publicAIConfig(userId));
  } catch (error) {
    console.error('ai.config.read', { userId }, error);
    return Response.json({ error: 'AI service is temporarily unavailable' }, { status: 503 });
  }
}
export async function PUT(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId || request.headers.get('x-reader-user') !== userId) return unauthorized();
  try {
    const body = await accountBody(request, 32000);
    if (
      typeof body.translationPrompt !== 'string' ||
      body.translationPrompt.length > MAX_TRANSLATION_PROMPT_LENGTH ||
      Object.keys(body).some((key) => key !== 'translationPrompt')
    )
      return Response.json({ error: 'Invalid translation preferences' }, { status: 400 });
    await database.user.update({
      where: { id: userId },
      data: { translationPrompt: body.translationPrompt.trim() },
    });
    return Response.json(await publicAIConfig(userId));
  } catch (error) {
    console.error('ai.config.save', { userId }, error);
    return Response.json({ error: 'Could not save translation preferences' }, { status: 503 });
  }
}
