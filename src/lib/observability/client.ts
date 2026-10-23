import {
  safeClientProperties,
  surfaceForPath,
  type ClientEvent,
  type ClientEventName,
  type ClientProperties,
} from './schema';

const preferenceKey = 'ai-read-analytics-consent';
const maxEvents = 160;
const listeners = new Set<() => void>();
let events: ClientEvent[] = [];
let vitals: Partial<Record<NonNullable<ClientProperties['metric']>, ClientEvent>> = {};
let pending: ClientEvent[] = [];
let enabled = false;
let configured = false;
let initialized = false;
let sessionId = '';
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let notificationTimer: ReturnType<typeof setTimeout> | undefined;
let lastDelivery: 'none' | 'sent' | 'failed' = 'none';
let revision = 0;
let deliveryController: AbortController | undefined;
let deliveryGeneration = 0;

function changed() {
  revision++;
  if (notificationTimer) return;
  notificationTimer = setTimeout(() => {
    notificationTimer = undefined;
    listeners.forEach((listener) => listener());
  }, 100);
}

export function privacySignal() {
  return (
    typeof navigator !== 'undefined' &&
    (navigator.doNotTrack === '1' ||
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true)
  );
}

export function analyticsStatus() {
  return { enabled, configured, blocked: privacySignal(), lastDelivery };
}

function discardQueuedAnalytics() {
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  // A consent change can race an outstanding response. Abort where possible and
  // prevent the old request from changing the status of the new consent session.
  deliveryGeneration++;
  deliveryController?.abort();
  deliveryController = undefined;
  lastDelivery = 'none';
}

export function setAnalyticsConsent(value: boolean) {
  enabled = value && !privacySignal();
  discardQueuedAnalytics();
  sessionId = enabled ? crypto.randomUUID() : '';
  try {
    localStorage.setItem(preferenceKey, enabled ? 'yes' : 'no');
  } catch {
    /* memory only */
  }
  changed();
}

export function recordClientEvent(name: ClientEventName, properties: ClientProperties = {}) {
  if (typeof window === 'undefined') return;
  const event: ClientEvent = {
    name,
    at: Date.now(),
    properties: safeClientProperties({ surface: surfaceForPath(location.pathname), ...properties }),
  };
  events = [...events.slice(-(maxEvents - 1)), event];
  if (name === 'web_vital' && event.properties.metric)
    vitals = { ...vitals, [event.properties.metric]: event };
  changed();
  if (!enabled || !configured || privacySignal()) return;
  pending.push(event);
  if (pending.length > 40) pending.shift();
  if (!flushTimer) flushTimer = setTimeout(() => void flushTelemetry(), 5000);
}

export function measureClient(name: ClientEventName, properties: ClientProperties = {}) {
  const started = performance.now();
  return (outcome: 'ok' | 'error' | 'cancelled' = 'ok', extra: ClientProperties = {}) =>
    recordClientEvent(name, {
      ...properties,
      ...extra,
      outcome,
      durationMs: performance.now() - started,
    });
}

async function flushTelemetry() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!enabled || !configured || privacySignal() || !pending.length || deliveryController) return;
  const batch = pending.splice(0, 20);
  const body = JSON.stringify({ sessionId, events: batch });
  const generation = deliveryGeneration;
  const controller = new AbortController();
  deliveryController = controller;
  const timeout = setTimeout(() => controller.abort(), 6000);
  let delivered = false;
  try {
    // Keepalive also covers visibility changes, without beacon's implicit cookies
    // and referrer. An active document can still abort after consent is revoked.
    const response = await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
      signal: controller.signal,
    });
    delivered = response.ok;
  } catch {
    /* best effort */
  } finally {
    clearTimeout(timeout);
    if (generation === deliveryGeneration && deliveryController === controller) {
      deliveryController = undefined;
      lastDelivery = delivered ? 'sent' : 'failed';
      changed();
      // Never retry failed analytics or overlap exports with a queued batch.
      if (pending.length && enabled && configured && !privacySignal() && !flushTimer)
        flushTimer = setTimeout(() => void flushTelemetry(), 5000);
    }
  }
}

export function initializeClientObservability() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    enabled = localStorage.getItem(preferenceKey) === 'yes' && !privacySignal();
  } catch {
    /* off */
  }
  if (enabled) sessionId = crypto.randomUUID();
  void fetch('/api/telemetry', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      configured = data?.enabled === true;
      changed();
    })
    .catch(() => {});
  window.addEventListener('error', () =>
    recordClientEvent('client_error', { outcome: 'error', errorKind: 'runtime' }),
  );
  window.addEventListener('unhandledrejection', () =>
    recordClientEvent('client_error', { outcome: 'error', errorKind: 'runtime' }),
  );
  window.addEventListener('storage', (event) => {
    if (event.key === preferenceKey || event.key === null) {
      // Read the persisted preference; a cleared storage area revokes consent as well.
      try {
        enabled = localStorage.getItem(preferenceKey) === 'yes' && !privacySignal();
      } catch {
        enabled = false;
      }
      discardQueuedAnalytics();
      sessionId = enabled ? crypto.randomUUID() : '';
      changed();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushTelemetry();
  });
}

export function subscribeDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const diagnosticsRevision = () => revision;
export const diagnosticsEvents = () => events;
// Five fixed slots survive ring-buffer rollover but remain page-memory only.
export const diagnosticsVitals = () => vitals;
export function clearDiagnostics() {
  events = [];
  vitals = {};
  discardQueuedAnalytics();
  changed();
}
