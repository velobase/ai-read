import 'server-only';
import { randomUUID } from 'node:crypto';
import { logException } from './observability';
import { auth } from './auth';
import { database } from './database';

export async function catalogAdministrator() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await database.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isAdmin: true },
  });
  return user?.isAdmin ? user : null;
}
export async function adminCatalogApi(action: () => Promise<Response>) {
  if (!(await catalogAdministrator()))
    return Response.json({ error: 'Administrator access required' }, { status: 403 });
  const requestId = randomUUID();
  try {
    const response = await action();
    response.headers.set('X-Request-Id', requestId);
    return response;
  } catch (error) {
    logException('catalog.admin', error, { requestId });
    const code = (error as { code?: string })?.code;
    if (code === 'P2002')
      return Response.json({ error: 'This URL or edition already exists' }, { status: 409 });
    if (code === 'P2025')
      return Response.json({ error: 'Book or edition not found' }, { status: 404 });
    return Response.json(
      {
        error:
          error instanceof Error && error.name === 'Error'
            ? error.message
            : 'Unable to save. Please retry.',
      },
      { status: 400 },
    );
  }
}
