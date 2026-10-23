import { metricsAuthorized, prometheusMetrics } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (!metricsAuthorized(request.headers.get('authorization')))
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(prometheusMetrics(), {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
