import { requireMobileSession, mobileAuthFailure } from '@/lib/server/mobile-auth';
import { accountBody } from '@/lib/server/account-request';
import { deleteAccount, accountDeletionFailure } from '@/lib/server/account-deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request) {
  let session;
  try {
    session = await requireMobileSession(request);
  } catch (error) {
    return mobileAuthFailure(error);
  }
  let body;
  try {
    body = await accountBody(request);
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (body.confirmation !== session.user.id)
    return Response.json({ error: 'confirmation_required' }, { status: 400 });
  try {
    await deleteAccount({ userId: session.user.id, sessionId: session.sessionId, kind: 'mobile' });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return accountDeletionFailure(error);
  }
}
