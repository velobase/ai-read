import { accountBody } from '@/lib/server/account-request';
import { handleAI } from '@/lib/server/ai';
import { mobileAI, mobileTranslationContextKey } from '@/lib/server/mobile-ai';
import { mobileAuthFailure } from '@/lib/server/mobile-auth';
import { logException, observedRoute } from '@/lib/server/observability';
import { effectiveTranslationPrompt, translationFingerprint } from '@/lib/translation-prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = observedRoute('api.ai', async (request: Request) => {
  let config;
  try {
    ({ config } = await mobileAI(request));
  } catch (error) {
    return mobileAuthFailure(error);
  }
  if (!config) return Response.json({ error: 'native_ai_unavailable' }, { status: 403 });
  try {
    const body = await accountBody(request, 96 * 1024);
    if (
      typeof body.target !== 'string' ||
      !body.target.trim() ||
      body.target.length > 8000 ||
      typeof body.language !== 'string' ||
      !/^[a-zA-Z-]{2,20}$/.test(body.language) ||
      !Array.isArray(body.sources) ||
      body.sources.length > 3 ||
      body.sources.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          typeof item.id !== 'string' ||
          !/^[\w.:-]{1,200}$/.test(item.id) ||
          typeof item.chapter !== 'string' ||
          typeof item.text !== 'string' ||
          item.text.length > 4000,
      )
    ) {
      return Response.json({ error: 'invalid_reading_translation' }, { status: 400 });
    }
    if (
      body.translationContextKey !== undefined &&
      (typeof body.translationContextKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.translationContextKey))
    )
      return Response.json({ error: 'invalid_reading_configuration' }, { status: 400 });
    if (
      body.translationContextKey !== undefined &&
      body.translationContextKey !== mobileTranslationContextKey(config)
    )
      return Response.json({ error: 'native_translation_configuration_changed' }, { status: 409 });
    const input = {
      action: 'translate',
      target: body.target,
      title: body.title,
      language: body.language,
      bookLanguage: body.bookLanguage,
      sources: body.sources,
      translationFingerprint: translationFingerprint({
        baseUrl: config.baseUrl,
        model: config.model,
        translationPrompt: effectiveTranslationPrompt(config.translationPrompt),
      }),
    };
    return handleAI(
      new Request(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: request.signal,
      }),
      { ...config, accountManaged: true },
    );
  } catch (error) {
    logException('mobile.translation', error);
    return Response.json({ error: 'invalid_reading_translation' }, { status: 400 });
  }
});
