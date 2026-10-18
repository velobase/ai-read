import { handleAI } from '@/lib/server/ai';
import { auth } from '@/lib/server/auth';
import { authEnabled } from '@/lib/server/auth-config';
import { unauthorized } from '@/lib/server/account-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (authEnabled() && !(await auth())?.user?.id) return unauthorized();
  return handleAI(request);
}
