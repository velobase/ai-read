import { logException, observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { authEnabled } from '@/lib/server/auth-config';
import { accountBody, unauthorized } from '@/lib/server/account-request';
import { database } from '@/lib/server/database';
import {
  changeTranslation,
  translationManifest,
  TranslationRequestError,
} from '@/lib/server/translation-jobs';
import { startTranslationWorker } from '@/lib/server/translation-worker';

import { requireMobileSession, MobileAuthError, mobileAuthFailure } from '@/lib/server/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function identity(request: Request) {
  if (request.headers.has('authorization')) return (await requireMobileSession(request)).user.id;
  const userId = authEnabled() ? (await auth())?.user?.id : undefined;
  return userId && request.headers.get('x-reader-user') === userId ? userId : null;
}
export const GET = observedRoute('api.translations.read', async (request: Request) => {
  try {
    const userId = await identity(request);
    if (!userId) return unauthorized();
    const params = new URL(request.url).searchParams;
    const bookId = params.get('bookId') || '',
      language = params.get('language') || '';
    const editionId = params.get('editionId');
    if (editionId && params.has('chapter')) {
      const index = Number(params.get('chapter'));
      if (!Number.isInteger(index) || index < 0)
        return Response.json({ error: '章节编号无效。' }, { status: 400 });
      const chapter = await database.translationChapter.findFirst({
        where: {
          editionId,
          chapterIndex: index,
          state: 'ready',
          edition: { userId, bookId, targetLanguage: language },
        },
      });
      if (!chapter) return Response.json({ error: '章节尚未准备完成。' }, { status: 404 });
      return Response.json({
        editionId,
        bookId,
        index,
        sourceHash: chapter.sourceHash,
        paragraphs: chapter.paragraphs,
      });
    }
    return Response.json(await translationManifest(userId, bookId, language));
  } catch (error) {
    if (error instanceof MobileAuthError) return mobileAuthFailure(error);
    logException('translation.request', error);
    return Response.json({ error: '译本暂时无法读取，请稍后重试。' }, { status: 503 });
  }
});
export const POST = observedRoute('api.translations.write', async (request: Request) => {
  try {
    const userId = await identity(request);
    if (!userId) return unauthorized();
    const body = await accountBody(request, 32 * 1024 * 1024);
    const manifest = await changeTranslation(userId, body);
    startTranslationWorker();
    return Response.json(manifest);
  } catch (error) {
    if (error instanceof MobileAuthError) return mobileAuthFailure(error);
    logException('translation.request', error);
    return Response.json(
      {
        error:
          error instanceof TranslationRequestError
            ? error.message
            : '译文任务暂时无法保存，请稍后重试。',
      },
      { status: error instanceof TranslationRequestError ? error.status : 503 },
    );
  }
});
