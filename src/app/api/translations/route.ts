import { logException, observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { authEnabled } from '@/lib/server/auth-config';
import {
  readTranslationChapter,
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

// Saved editions remain readable; new translations follow the active reading position.
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
