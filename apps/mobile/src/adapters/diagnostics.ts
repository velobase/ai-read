type Operation =
  | 'library.load'
  | 'book.import'
  | 'document.preview'
  | 'book.open'
  | 'note.save'
  | 'notes.page'
  | 'backup.export'
  | 'server.check'
  | 'pdf.parse'
  | 'pdf.original.cleanup'
  | 'ai.ask'
  | 'ai.translate'
  | 'ai.history.load'
  | 'ai.history.save'
  | 'account.signin'
  | 'account.signout';
type Event = {
  operation: Operation;
  result: 'ok' | 'error' | 'cancelled';
  durationMs: number;
  at: string;
};
const events: Event[] = [];

type ScrollMetrics = {
  offset: number;
  contentHeight: number;
  viewportHeight: number;
  restoring: boolean;
  pending: boolean;
};
type ScrollEvent =
  | 'mount'
  | 'unmount'
  | 'touchStart'
  | 'touchEnd'
  | 'touchCancel'
  | 'beginDrag'
  | 'endDrag'
  | 'momentumBegin'
  | 'momentumEnd'
  | 'restoreEnd'
  | 'restoreCancelled'
  | 'prependStart'
  | 'prependEnd';
type ScrollSample = 'scroll' | 'layout' | 'contentSize' | 'restoreCommand' | 'touchMove';
type ScrollState = ScrollMetrics & {
  instance: number;
  active: boolean;
  maxTouchMoveDelta: number;
  touchEndDelta: number;
  touchDurationMs: number;
  touchMoves: number;
  restoreTargetOffset: number | null;
};
const scrollCounts: Partial<Record<ScrollEvent | ScrollSample, number>> = {};
const scrollRecent: (ScrollState & { event: ScrollEvent; at: string })[] = [];
let scrollLatest: ScrollState | null = null;
let scrollInstance = 0;
const rounded = (value: number) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : 0);
/** Local, numeric-only telemetry. No book/paragraph identifiers or text enter this API. */
export function createScrollDiagnostics() {
  const state: ScrollState = {
    instance: ++scrollInstance,
    active: true,
    offset: 0,
    contentHeight: 0,
    viewportHeight: 0,
    restoring: true,
    pending: false,
    maxTouchMoveDelta: 0,
    touchEndDelta: 0,
    touchDurationMs: 0,
    touchMoves: 0,
    restoreTargetOffset: null,
  };
  let touch: { x: number; y: number; at: number } | null = null;
  const count = (name: ScrollEvent | ScrollSample) => {
    scrollCounts[name] = (scrollCounts[name] || 0) + 1;
  };
  const update = (metrics: ScrollMetrics) => {
    state.offset = rounded(metrics.offset);
    state.contentHeight = rounded(metrics.contentHeight);
    state.viewportHeight = rounded(metrics.viewportHeight);
    state.restoring = metrics.restoring;
    state.pending = metrics.pending;
    if (!scrollLatest || state.instance >= scrollLatest.instance) scrollLatest = state;
  };
  const record = (event: ScrollEvent, metrics: ScrollMetrics) => {
    if (event === 'mount') state.active = true;
    if (!state.active) return;
    if (event === 'unmount') state.active = false;
    count(event);
    update(metrics);
    scrollRecent.push({ ...state, event, at: new Date().toISOString() });
    if (scrollRecent.length > 40) scrollRecent.shift();
  };
  return {
    record,
    sample: (
      name: Exclude<ScrollSample, 'touchMove'>,
      metrics: ScrollMetrics,
      targetOffset?: number,
    ) => {
      if (!state.active) return;
      count(name);
      if (name === 'restoreCommand' && targetOffset !== undefined)
        state.restoreTargetOffset = rounded(targetOffset);
      update(metrics);
    },
    touchStart: (x: number, y: number, metrics: ScrollMetrics) => {
      if (!state.active) return;
      touch = { x, y, at: Date.now() };
      state.maxTouchMoveDelta = 0;
      state.touchEndDelta = 0;
      state.touchMoves = 0;
      state.touchDurationMs = 0;
      record('touchStart', metrics);
    },
    touchMove: (x: number, y: number, metrics: ScrollMetrics) => {
      if (!state.active) return;
      count('touchMove');
      state.touchMoves++;
      if (touch) {
        state.maxTouchMoveDelta = rounded(
          Math.max(state.maxTouchMoveDelta, Math.hypot(x - touch.x, y - touch.y)),
        );
        state.touchDurationMs = Date.now() - touch.at;
      }
      update(metrics);
    },
    touchEnd: (cancelled: boolean, x: number, y: number, metrics: ScrollMetrics) => {
      if (!state.active) return;
      if (touch) {
        state.touchEndDelta = rounded(Math.hypot(x - touch.x, y - touch.y));
        state.touchDurationMs = Date.now() - touch.at;
      }
      record(cancelled ? 'touchCancel' : 'touchEnd', metrics);
      touch = null;
    },
  };
}

export type SpeechMetrics = {
  session: number;
  paragraphIndex: number;
  paragraphCount: number;
  chunkIndex: number;
  chunkLength: number;
  /** Absolute UTF-16 offset in the current paragraph's spoken source. */
  offset: number;
  charLength: number;
  rate: number;
  elapsedMs: number;
};
export type SpeechDiagnosticEvent =
  | 'mount'
  | 'unmount'
  | 'startCommand'
  | 'nativeStart'
  | 'pause'
  | 'resume'
  | 'stopCommand'
  | 'paragraph'
  | 'done'
  | 'stopped'
  | 'error'
  | 'background'
  | 'startTimeout';
type SpeechDiagnosticState = SpeechMetrics & {
  instance: number;
  active: boolean;
  lastEvent: SpeechDiagnosticEvent | null;
};
const speechEventNames = new Set<SpeechDiagnosticEvent>([
  'mount',
  'unmount',
  'startCommand',
  'nativeStart',
  'pause',
  'resume',
  'stopCommand',
  'paragraph',
  'done',
  'stopped',
  'error',
  'background',
  'startTimeout',
]);
const speechMetricNames: (keyof SpeechMetrics)[] = [
  'session',
  'paragraphIndex',
  'paragraphCount',
  'chunkIndex',
  'chunkLength',
  'offset',
  'charLength',
  'rate',
  'elapsedMs',
];
const emptySpeechMetrics = (): SpeechMetrics => ({
  session: 0,
  paragraphIndex: 0,
  paragraphCount: 0,
  chunkIndex: 0,
  chunkLength: 0,
  offset: 0,
  charLength: 0,
  rate: 0,
  elapsedMs: 0,
});
const speechCounts: Partial<Record<SpeechDiagnosticEvent | 'boundary', number>> = {};
const speechRecent: (SpeechDiagnosticState & { event: SpeechDiagnosticEvent; at: string })[] = [];
let speechLatest: SpeechDiagnosticState | null = null;
let speechInstance = 0;

/**
 * Local numeric-only speech diagnostics. This API accepts no book, paragraph,
 * voice, language, URL, source text or error details. Native callbacks describe
 * synthesizer activity; they do not establish that audio was audible.
 */
export function createSpeechDiagnostics() {
  const state: SpeechDiagnosticState = {
    ...emptySpeechMetrics(),
    instance: ++speechInstance,
    active: true,
    lastEvent: null,
  };
  const count = (name: SpeechDiagnosticEvent | 'boundary') => {
    speechCounts[name] = Math.min(Number.MAX_SAFE_INTEGER, (speechCounts[name] || 0) + 1);
  };
  const update = (metrics: Partial<SpeechMetrics>) => {
    // Pick numeric fields explicitly instead of spreading callers' objects into
    // a diagnostic snapshot. This also bounds malformed native callback values.
    for (const key of speechMetricNames) {
      const value = metrics[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      const bounded = Math.min(Number.MAX_SAFE_INTEGER, value);
      state[key] = key === 'rate' ? Math.round(bounded * 100) / 100 : Math.floor(bounded);
    }
    if (!speechLatest || state.instance >= speechLatest.instance) speechLatest = state;
  };
  const record = (event: SpeechDiagnosticEvent, metrics: Partial<SpeechMetrics> = {}) => {
    if (!speechEventNames.has(event)) return;
    if (event === 'mount') state.active = true;
    if (!state.active) return;
    if (event === 'startCommand') Object.assign(state, emptySpeechMetrics());
    if (event === 'unmount') state.active = false;
    state.lastEvent = event;
    count(event);
    update(metrics);
    speechRecent.push({ ...state, event, at: new Date().toISOString() });
    if (speechRecent.length > 40) speechRecent.shift();
  };
  return {
    record,
    boundary: (metrics: Partial<SpeechMetrics>) => {
      if (!state.active) return;
      count('boundary');
      update(metrics);
    },
    dispose: () => record('unmount'),
  };
}

export async function measured<T>(operation: Operation, action: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let result: Event['result'] = 'ok';
  try {
    return await action();
  } catch (error) {
    result =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        /^(auth_)?cancelled$/.test(error.message) ||
        (operation === 'pdf.parse' &&
          (error.message === 'PDF_PAUSED' || error.message === 'PDF_CANCELLED')))
        ? 'cancelled'
        : 'error';
    throw error;
  } finally {
    events.push({
      operation,
      result,
      durationMs: Date.now() - start,
      at: new Date().toISOString(),
    });
    if (events.length > 100) events.shift();
  }
}
export function diagnosticSnapshot() {
  return {
    format: 'bypage-native-diagnostics',
    version: 1,
    events: [...events],
    scroll: {
      counters: { ...scrollCounts },
      latest: scrollLatest ? { ...scrollLatest } : null,
      recent: scrollRecent.map((event) => ({ ...event })),
    },
    speech: {
      counters: { ...speechCounts },
      latest: speechLatest ? { ...speechLatest } : null,
      recent: speechRecent.map((event) => ({ ...event })),
    },
  };
}
