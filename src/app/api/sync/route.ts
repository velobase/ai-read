import { observedRoute } from '@/lib/server/observability';
import { auth } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import {
  entityFrom,
  listRecords,
  readRecord,
  syncBody,
  validId,
  writeRecord,
} from '@/lib/server/sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function identity(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return null;
  return request.headers.get('x-reader-user') === session.user.id ? session.user.id : null;
}
async function handleGET(request: Request) {
  try {
    const userId = await identity(request);
    if (!userId) return response({ error: 'sync-auth' }, 401);
    const params = new URL(request.url).searchParams;
    const entity = entityFrom(params.get('entity') || 'book');
    const bookId = params.get('bookId') || '';
    const id = params.get('id');
    if ((bookId && !validId(bookId)) || (id && !validId(id)))
      return response({ error: 'sync-invalid' }, 400);
    if (entity === 'preferences' || id) {
      const record = await readRecord(
        database,
        userId,
        entity,
        bookId,
        id || 'preferences',
        params.get('content') !== '0',
      );
      return record ? response({ userId, record }) : response({ error: 'sync-missing' }, 404);
    }
    return response({
      userId,
      ...(await listRecords(userId, entity, bookId, params.get('after') || '')),
    });
  } catch {
    return response({ error: 'sync-unavailable' }, 503);
  }
}
async function handlePOST(request: Request) {
  try {
    const userId = await identity(request);
    if (!userId) return response({ error: 'sync-auth' }, 401);
    const result = await writeRecord(userId, await syncBody(request));
    return response({ userId, ...result }, result.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const tooLarge = message === 'sync-body-too-large';
    const invalid =
      tooLarge ||
      [
        'invalid-sync-data',
        '备份格式不正确，未修改本地数据。',
        '书籍正文过长，请选择较小的文件。',
        'Invalid book images',
        'Invalid book references',
        'Invalid bookmark',
      ].includes(message);
    return response(
      { error: invalid ? 'sync-invalid' : 'sync-unavailable' },
      tooLarge ? 413 : invalid ? 400 : 503,
    );
  }
}

export const GET = observedRoute('api.sync.read', handleGET);
export const POST = observedRoute('api.sync.write', handlePOST);
