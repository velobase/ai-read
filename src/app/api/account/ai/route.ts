import { observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { accountBody, unauthorized } from '@/lib/server/account-request';
import { database } from '@/lib/server/database';
import { publicAIConfig } from '@/lib/server/ai-config';
import { encryptAIKey } from '@/lib/server/ai-credentials';
import { normalizeAIUrl } from '@/lib/server/ai-endpoint';
import {
  MAX_TRANSLATION_PROMPT_LENGTH,
  effectiveTranslationPrompt,
} from '@/lib/translation-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class InvalidConfiguration extends Error {}

async function handleGET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return unauthorized();
  try {
    return Response.json(await publicAIConfig(userId));
  } catch {
    return Response.json({ error: '暂时无法读取 AI 配置，请重试。' }, { status: 503 });
  }
}

async function handlePUT(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId || request.headers.get('x-reader-user') !== userId) return unauthorized();
  let baseUrl: string,
    model: string,
    apiKey: string,
    clearKey: boolean,
    translationPrompt: string | undefined;
  try {
    const body = await accountBody(request, 64 * 1024);
    if (
      typeof body.baseUrl !== 'string' ||
      body.baseUrl.length > 2000 ||
      typeof body.model !== 'string' ||
      !body.model.trim() ||
      body.model.length > 200 ||
      (body.apiKey !== undefined &&
        (typeof body.apiKey !== 'string' || body.apiKey.length > 2000)) ||
      (body.clearKey !== undefined && typeof body.clearKey !== 'boolean')
    )
      throw new Error('请填写有效的服务地址、模型名称和 API Key。');
    if (
      body.translationPrompt !== undefined &&
      (typeof body.translationPrompt !== 'string' ||
        body.translationPrompt.length > MAX_TRANSLATION_PROMPT_LENGTH)
    )
      throw new Error('翻译 Prompt 不能超过 6000 个字符。');
    translationPrompt =
      typeof body.translationPrompt === 'string' ? body.translationPrompt.trim() : undefined;
    baseUrl = normalizeAIUrl(body.baseUrl.trim());
    model = body.model.trim();
    apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    clearKey = body.clearKey === true;
    if (clearKey && apiKey) throw new Error('移除密钥时，请留空 API Key。');
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof SyntaxError
            ? '请求格式不正确。'
            : error instanceof Error
              ? error.message
              : '配置格式不正确。',
      },
      { status: 400 },
    );
  }
  try {
    const saved = await database.$transaction(async (tx) => {
      // Also serializes the first insert, when no connection row exists yet.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.aIConnection.findUnique({ where: { userId } });
      if (current?.encryptedKey && current.baseUrl !== baseUrl && !apiKey && !clearKey)
        throw new InvalidConfiguration(
          '更换服务地址时，请填写新的 API Key，或选择移除已保存的密钥。',
        );
      const encryptedKey = apiKey
        ? encryptAIKey(apiKey, userId, baseUrl)
        : clearKey
          ? null
          : current?.encryptedKey || null;
      return tx.aIConnection.upsert({
        where: { userId },
        create: {
          userId,
          baseUrl,
          model,
          encryptedKey,
          translationPrompt: translationPrompt ?? '',
        },
        update: {
          baseUrl,
          model,
          encryptedKey,
          ...(translationPrompt !== undefined ? { translationPrompt } : {}),
        },
      });
    });
    return Response.json({
      baseUrl: saved.baseUrl,
      model: saved.model,
      translationPrompt: effectiveTranslationPrompt(saved.translationPrompt),
      hasKey: Boolean(saved.encryptedKey),
      accountManaged: true,
      updatedAt: saved.updatedAt.toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof InvalidConfiguration
            ? error.message
            : 'AI 配置暂时无法保存，请稍后重试。',
      },
      { status: error instanceof InvalidConfiguration ? 400 : 503 },
    );
  }
}

export const GET = observedRoute('api.account.ai', handleGET);
export const PUT = observedRoute('api.account.ai', handlePUT);
