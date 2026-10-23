import { logException, observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { authEnabled } from '@/lib/server/auth-config';
import {
  readTranslationChapter,
  ensureTranslation,
  translationManifest,
  TranslationRequestError,
} from '@/lib/server/translation-jobs';
import { requireMobileSession, MobileAuthError, mobileAuthFailure } from '@/lib/server/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function identity(request: Request) {
  if (request.headers.has('authorization')) return (await requireMobileSession(request)).user.id;
  const userId = authEnabled() ? (await auth())?.user?.id : undefined;
  return userId && request.headers.get('x-reader-user') === userId ? userId : null;
}

// Readers observe durable server work; disconnecting never cancels translation.
export const GET = observedRoute('api.translations.read', async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const bookId = params.get('bookId') || '';
  const language = params.get('language') || '';
  try {
    const userId = await identity(request);
    if (!userId) return Response.json({ error: 'native_session_required' }, { status: 401 });
    const editionId = params.get('editionId');
    if (editionId && params.has('chapter')) {
      const index = Number(params.get('chapter'));
      if (!Number.isInteger(index) || index < 0)
        return Response.json({ error: 'translation_request_invalid' }, { status: 400 });
      return Response.json(
        await readTranslationChapter(userId, bookId, language, editionId, index),
      );
    }
    return Response.json(await translationManifest(userId, bookId, language));
  } catch (error) {
    if (error instanceof MobileAuthError) return mobileAuthFailure(error);
    logException('translation.read', error, {
      bookId,
      language,
      editionId: params.get('editionId'),
      chapter: params.get('chapter'),
    });
    return Response.json(
      { error: error instanceof TranslationRequestError ? error.code : 'translation_load_failed' },
      { status: error instanceof TranslationRequestError ? error.status : 503 },
    );
  }
});

export const POST = observedRoute('api.translations.write', async (request: Request) => {
  try {
    const userId = await identity(request);
    if (!userId) return Response.json({ error: 'native_session_required' }, { status: 401 });
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return Response.json({ error: 'translation_request_invalid' }, { status: 415 });
    if (!request.body)
      throw new TranslationRequestError('translation_request_invalid', '缺少书籍。');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new TranslationRequestError('translation_book_too_large', '书籍正文过大。', 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || !input.book)
      throw new TranslationRequestError('translation_request_invalid', '缺少书籍。');
    return Response.json(await ensureTranslation(userId, input));
  } catch (error) {
    if (error instanceof MobileAuthError) return mobileAuthFailure(error);
    logException('translation.ensure', error);
    return Response.json(
      { error: error instanceof TranslationRequestError ? error.code : 'translation_start_failed' },
      {
        status:
          error instanceof TranslationRequestError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 503,
      },
    );
  }
});
