import { observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { authEnabled } from '@/lib/server/auth-config';
import { unauthorized } from '@/lib/server/account-request';
import { inspect } from 'node:util';
import {
  readTranslationChapter,
  translationManifest,
  TranslationRequestError,
} from '@/lib/server/translation-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function identity(request: Request) {
  const userId = authEnabled() ? (await auth())?.user?.id : undefined;
  return userId && request.headers.get('x-reader-user') === userId ? userId : null;
}
async function handleGET(request: Request) {
  const userId = await identity(request);
  if (!userId) return unauthorized();
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const params = new URL(request.url).searchParams;
  const bookId = params.get('bookId') || '',
    language = params.get('language') || '';
  try {
    const editionId = params.get('editionId');
    if (editionId && params.has('chapter')) {
      const index = Number(params.get('chapter'));
      if (!Number.isInteger(index) || index < 0)
        return Response.json({ error: '章节编号无效。' }, { status: 400 });
      return Response.json(
        await readTranslationChapter(userId, bookId, language, editionId, index),
      );
    }
    return Response.json(await translationManifest(userId, bookId, language));
  } catch (error) {
    console.error(
      'Saved translation read failed',
      {
        requestId,
        userId,
        bookId,
        language,
        editionId: params.get('editionId'),
        chapter: params.get('chapter'),
      },
      inspect(error, { depth: null, maxArrayLength: null, maxStringLength: null }),
    );
    return Response.json(
      {
        error:
          error instanceof TranslationRequestError
            ? error.message
            : '译本暂时无法读取，请稍后重试。',
      },
      {
        status: error instanceof TranslationRequestError ? error.status : 503,
        headers: { 'x-request-id': requestId },
      },
    );
  }
}
export const GET = observedRoute('api.translations.read', handleGET);
