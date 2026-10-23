import 'server-only';
import { safeClientEvent, type ClientEvent } from '../observability/schema';
import { beginOperation } from './observability';

export function analyticsConfig() {
  if (!process.env.POSTHOG_PROJECT_TOKEN || !process.env.POSTHOG_HOST) return null;
  try {
    const host = new URL(process.env.POSTHOG_HOST);
    if (
      host.protocol !== 'https:' ||
      host.username ||
      host.password ||
      host.search ||
      host.hash ||
      host.pathname !== '/'
    )
      return null;
    return { host: host.origin, token: process.env.POSTHOG_PROJECT_TOKEN };
  } catch {
    return null;
  }
}

export function analyticsBatch(input: Record<string, unknown>) {
  // Anonymous per-page UUID; no account ID or stable cross-page identity is accepted.
  if (
    typeof input.sessionId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.sessionId,
    ) ||
    !Array.isArray(input.events) ||
    !input.events.length ||
    input.events.length > 20
  )
    return null;
  const events = input.events
    .map((event) => safeClientEvent(event))
    .filter((event): event is ClientEvent => !!event);
  if (!events.length) return null;
  return { sessionId: input.sessionId, events };
}

// Bound cost and memory per process without storing IPs, user IDs or cookies.
let windowStart = 0;
let batches = 0;
let active = 0;
export async function exportAnalytics(batch: NonNullable<ReturnType<typeof analyticsBatch>>) {
  const config = analyticsConfig();
  if (!config) return 204;
  if (Date.now() - windowStart > 60000) {
    windowStart = Date.now();
    batches = 0;
  }
  if (batches >= 120 || active >= 4) return 429;
  batches++;
  active++;
  const measurement = beginOperation('analytics.export');
  try {
    const response = await fetch(`${config.host}/batch/`, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.token,
        batch: batch.events.map((event) => ({
          event: `bypage_${event.name}`,
          distinct_id: batch.sessionId,
          timestamp: new Date(event.at).toISOString(),
          properties: { ...event.properties, $process_person_profile: false, $geoip_disable: true },
        })),
      }),
    });
    await response.body?.cancel();
    measurement.finish(response.ok ? 'ok' : 'error', response.status);
    return response.ok ? 204 : 502;
  } catch (error) {
    measurement.finish('error', 502, error);
    return 502;
  } finally {
    active--;
  }
}
