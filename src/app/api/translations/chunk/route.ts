import { authEnabled } from '@/lib/server/auth-config';
import { accountBody } from '@/lib/server/account-request';
import { serverAIConfig } from '@/lib/server/ai-config';
import { normalizeAIUrl } from '@/lib/server/ai-endpoint';
import { translateChunk, TranslationError } from '@/lib/server/translate-chunk';
import { translationProfile, type TranslationInput } from '@/lib/translation-edition';

export const runtime = 'nodejs';
let active = 0;
export async function POST(request: Request) {
  // Account jobs obtain their original text and frozen profile from the database.
  if (authEnabled()) return Response.json({ error: '请使用账号译文任务。' }, { status: 403 });
  if (active >= 2)
    return Response.json({ error: '正在准备其他章节，请稍后重试。' }, { status: 429 });
  active++;
  try {
    const body = await accountBody(request, 256 * 1024);
    const input = body.input as TranslationInput;
    const raw = body.profile as { baseUrl?: string; model?: string; translationPrompt?: string };
    if (
      !input ||
      typeof input.title !== 'string' ||
      typeof input.chapter !== 'string' ||
      typeof input.language !== 'string' ||
      typeof input.bookLanguage !== 'string' ||
      typeof input.outline !== 'string' ||
      typeof input.previous !== 'string' ||
      typeof input.chunk?.context !== 'string' ||
      !Array.isArray(input.chunk.segments) ||
      !input.chunk.segments.length ||
      input.chunk.segments.length > 80 ||
      !input.chunk.segments.every(
        (p) =>
          p && typeof p.id === 'string' && typeof p.text === 'string' && typeof p.kind === 'string',
      ) ||
      new Set(input.chunk.segments.map((p) => p.id)).size !== input.chunk.segments.length ||
      input.chunk.segments.reduce((sum, p) => sum + p.text.length, 0) > 12000 ||
      !Array.isArray(input.terms) ||
      input.terms.length > 120 ||
      !raw ||
      typeof raw.model !== 'string' ||
      !raw.model ||
      raw.model.length > 200 ||
      typeof raw.baseUrl !== 'string' ||
      typeof raw.translationPrompt !== 'string' ||
      raw.translationPrompt.length > 6000
    )
      return Response.json({ error: '翻译内容格式无效。' }, { status: 400 });
    const config = await serverAIConfig();
    const baseUrl = normalizeAIUrl(raw.baseUrl);
    const key = typeof body.apiKey === 'string' && body.apiKey.length <= 2000 ? body.apiKey : '';
    const apiKey =
      key || (config.baseUrl && normalizeAIUrl(config.baseUrl) === baseUrl ? config.apiKey : '');
    const result = await translateChunk(
      input,
      translationProfile({ baseUrl, model: raw.model, translationPrompt: raw.translationPrompt }),
      apiKey,
      AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
    );
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : '翻译暂时不可用。',
        retryable: !(error instanceof TranslationError) || error.retryable,
      },
      { status: error instanceof TranslationError && !error.retryable ? 400 : 502 },
    );
  } finally {
    active--;
  }
}
