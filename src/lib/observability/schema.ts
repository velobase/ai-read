// Deliberately finite labels: never put book IDs, URLs, queries or user data in telemetry.
export const operations = [
  'api.ai',
  'api.sync.read',
  'api.sync.write',
  'api.translations.read',
  'api.translations.write',
  'api.translation.chunk',
  'api.account',
  'api.account.ai',
  'api.account.sessions',
  'api.identity',
  'api.config',
  'api.ready',
  'ai.completion',
  'ai.translation',
  'translation.worker',
  'server.request',
  'analytics.export',
] as const;
export type Operation = (typeof operations)[number];
export type Outcome = 'ok' | 'error' | 'cancelled';

export const clientEvents = [
  'page_view',
  'web_vital',
  'library_load',
  'book_import',
  'pdf_parse',
  'book_open',
  'reader_ready',
  'reader_mode',
  'search',
  'note_save',
  'ai_request',
  'sync',
  'client_error',
] as const;
export type ClientEventName = (typeof clientEvents)[number];
export const surfaces = [
  'home',
  'library',
  'reader',
  'book',
  'notes',
  'search',
  'discover',
  'categories',
  'collections',
  'settings',
  'profile',
  'login',
  'legal',
  'other',
] as const;
export type Surface = (typeof surfaces)[number];
export type ClientProperties = {
  surface?: Surface;
  outcome?: Outcome;
  durationMs?: number;
  count?: number;
  format?: 'epub' | 'txt' | 'pdf';
  mode?: 'original' | 'bilingual' | 'translation';
  metric?: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';
  value?: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  errorKind?: 'storage' | 'network' | 'runtime' | 'render' | 'unknown';
};
export type ClientEvent = { name: ClientEventName; at: number; properties: ClientProperties };

export function surfaceForPath(path: string): Surface {
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/read/')) return 'reader';
  if (pathname.startsWith('/books/')) return 'book';
  if (pathname === '/me') return 'profile';
  if (pathname.startsWith('/me/')) return 'settings';
  if (pathname === '/privacy' || pathname === '/terms') return 'legal';
  const first = pathname.split('/')[1];
  return (surfaces as readonly string[]).includes(first) ? (first as Surface) : 'other';
}

// Reconstruct instead of deleting sensitive keys. Used on BOTH sides of the boundary.
export function safeClientProperties(input: unknown): ClientProperties {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: Record<string, string | number> = {};
  const enums: Record<string, readonly string[]> = {
    surface: surfaces,
    outcome: ['ok', 'error', 'cancelled'],
    format: ['epub', 'txt', 'pdf'],
    mode: ['original', 'bilingual', 'translation'],
    metric: ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'],
    rating: ['good', 'needs-improvement', 'poor'],
    errorKind: ['storage', 'network', 'runtime', 'render', 'unknown'],
  };
  for (const [key, values] of Object.entries(enums)) {
    const value = source[key];
    if (typeof value === 'string' && values.includes(value)) result[key] = value;
  }
  for (const key of ['durationMs', 'count', 'value']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
      result[key] = Math.round(Math.min(value, 86_400_000) * 1000) / 1000;
  }
  return result as ClientProperties;
}

export function safeClientEvent(input: unknown, now = Date.now()): ClientEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!(clientEvents as readonly unknown[]).includes(value.name)) return null;
  return {
    name: value.name as ClientEventName,
    // Do not accept arbitrary timestamp strings or unbounded history.
    at:
      typeof value.at === 'number' && Number.isFinite(value.at)
        ? Math.max(now - 3_600_000, Math.min(now, value.at))
        : now,
    properties: safeClientProperties(value.properties),
  };
}
