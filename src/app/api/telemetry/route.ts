import { accountBody } from '@/lib/server/account-request';
import { analyticsBatch, analyticsConfig, exportAnalytics } from '@/lib/server/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { enabled: Boolean(analyticsConfig()) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!analyticsConfig()) return new Response(null, { status: 204, headers });
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1')
    return new Response(null, { status: 204, headers });
  try {
    const body = await accountBody(request, 24 * 1024);
    const batch = analyticsBatch(body);
    if (!batch) return new Response(null, { status: 400, headers });
    return new Response(null, { status: await exportAnalytics(batch), headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
}
