import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ROOT_CONTEXT, SpanStatusCode, trace, type Span, type Tracer } from '@opentelemetry/api';
import { operations, type Operation, type Outcome } from '../observability/schema';

type Context = { traceId: string; spanId: string; span?: Span };
type Metric = { count: number; sum: number; buckets: number[] };
const bounds = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
const globalState = globalThis as typeof globalThis & { bypageTelemetry?: State };
type State = {
  context: AsyncLocalStorage<Context>;
  metrics: Map<string, Metric>;
  active: Map<Operation, number>;
  tracer?: Tracer;
  started: number;
};
const state: State = (globalState.bypageTelemetry ??= {
  context: new AsyncLocalStorage<Context>(),
  metrics: new Map(),
  active: new Map(),
  started: Date.now(),
});

export function setTelemetryTracer(tracer: Tracer) {
  state.tracer = tracer;
}

export function errorKind(error: unknown) {
  // Classifications supplement the complete exception retained in server logs.
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof TypeError) return 'network_or_type';
  if (error instanceof SyntaxError) return 'invalid_json';
  return 'internal';
}

type LogFields = {
  outcome?: Outcome;
  durationMs?: number;
  status?: number;
  errorKind?: string;
  error?: unknown;
};

function errorDetails(value: unknown, ancestors = new Set<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.has(value)) return '[Circular reference]';
  const parents = new Set(ancestors).add(value);
  if (Array.isArray(value)) return value.map((item) => errorDetails(item, parents));
  if (value instanceof Date) return value.toISOString();
  const details: Record<string, unknown> = {};
  if (value instanceof Error) {
    details.name = value.name;
    details.message = value.message;
    details.stack = value.stack;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    details[key] = errorDetails((value as Record<string, unknown>)[key], parents);
  }
  return details;
}

export function logEvent(
  operation: Operation,
  fields: LogFields = {},
  context = state.context.getStore(),
) {
  if (process.env.OBSERVABILITY_LOGS === '0') return;
  const failed = fields.outcome === 'error' || (fields.status ?? 0) >= 500;
  const { error, ...details } = fields;
  const record = {
    timestamp: new Date().toISOString(),
    service: 'bypage',
    level: failed ? 'error' : 'info',
    event: operation,
    ...(context ? { trace_id: context.traceId, span_id: context.spanId } : {}),
    ...details,
    ...(Object.hasOwn(fields, 'error') ? { error: errorDetails(error) } : {}),
  };
  // Preserve non-enumerable Error fields and every cause's full stack without truncation.
  try {
    (failed ? console.error : console.info)(JSON.stringify(record));
  } catch (loggingError) {
    console.error('Server log serialization failed', loggingError, record);
  }
}

export function beginOperation(operation: Operation) {
  const parent = state.context.getStore();
  const span = state.tracer?.startSpan(
    operation,
    {},
    parent?.span ? trace.setSpan(ROOT_CONTEXT, parent.span) : ROOT_CONTEXT,
  );
  const spanContext = span?.spanContext();
  const context: Context = {
    traceId: spanContext?.traceId || parent?.traceId || randomBytes(16).toString('hex'),
    spanId: spanContext?.spanId || randomBytes(8).toString('hex'),
    span,
  };
  const start = performance.now();
  let finished = false;
  state.active.set(operation, (state.active.get(operation) || 0) + 1);
  return {
    traceId: context.traceId,
    run<T>(callback: () => T): T {
      return state.context.run(context, callback);
    },
    finish(outcome: Outcome = 'ok', status?: number, error?: unknown) {
      if (finished) return;
      finished = true;
      const durationMs = Math.max(0, performance.now() - start);
      state.active.set(operation, Math.max(0, (state.active.get(operation) || 1) - 1));
      const key = `${operation}:${outcome}`;
      const metric = state.metrics.get(key) || { count: 0, sum: 0, buckets: bounds.map(() => 0) };
      metric.count++;
      metric.sum += durationMs / 1000;
      bounds.forEach((bound, index) => {
        if (durationMs / 1000 <= bound) metric.buckets[index]++;
      });
      state.metrics.set(key, metric);
      span?.setAttribute('app.operation', operation);
      span?.setAttribute('app.outcome', outcome);
      if (status !== undefined) span?.setAttribute('http.response.status_code', status);
      if (outcome === 'error') span?.setStatus({ code: SpanStatusCode.ERROR });
      span?.end();
      logEvent(
        operation,
        {
          outcome,
          durationMs: Math.round(durationMs),
          ...(status !== undefined ? { status } : {}),
          ...(error !== undefined ? { errorKind: errorKind(error), error } : {}),
        },
        context,
      );
    },
  };
}

export async function observe<T>(operation: Operation, callback: () => Promise<T>): Promise<T> {
  const measurement = beginOperation(operation);
  return measurement.run(async () => {
    try {
      const result = await callback();
      measurement.finish();
      return result;
    } catch (error) {
      measurement.finish(
        error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'error',
        undefined,
        error,
      );
      throw error;
    }
  });
}

export function observedRoute(
  operation: Operation,
  handler: (request: Request) => Promise<Response>,
) {
  return (request: Request) => {
    const measurement = beginOperation(operation);
    return measurement.run(async () => {
      try {
        const response = await handler(request);
        measurement.finish(response.status >= 400 ? 'error' : 'ok', response.status);
        // Route duration is time to response headers; ai.completion tracks the entire stream.
        const headers = new Headers(response.headers);
        headers.set('X-Request-Id', measurement.traceId);
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        measurement.finish(request.signal.aborted ? 'cancelled' : 'error', 500, error);
        throw error;
      }
    });
  };
}

export function metricsAuthorized(
  header: string | null,
  token = process.env.OBSERVABILITY_METRICS_TOKEN,
) {
  if (!token || token.length < 24 || !header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7)),
    expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function prometheusMetrics() {
  const lines = [
    '# HELP bypage_operation_duration_seconds Operation duration; API routes measure response headers.',
    '# TYPE bypage_operation_duration_seconds histogram',
  ];
  for (const [key, value] of state.metrics) {
    const [operation, outcome] = key.split(':');
    const labels = `operation="${operation}",outcome="${outcome}"`;
    bounds.forEach((bound, index) =>
      lines.push(
        `bypage_operation_duration_seconds_bucket{${labels},le="${bound}"} ${value.buckets[index]}`,
      ),
    );
    lines.push(
      `bypage_operation_duration_seconds_bucket{${labels},le="+Inf"} ${value.count}`,
      `bypage_operation_duration_seconds_sum{${labels}} ${value.sum}`,
      `bypage_operation_duration_seconds_count{${labels}} ${value.count}`,
    );
  }
  lines.push(
    '# HELP bypage_operations_active Currently active operations.',
    '# TYPE bypage_operations_active gauge',
  );
  for (const operation of operations)
    lines.push(
      `bypage_operations_active{operation="${operation}"} ${state.active.get(operation) || 0}`,
    );
  lines.push(
    '# HELP bypage_process_uptime_seconds Time since instrumentation initialized.',
    '# TYPE bypage_process_uptime_seconds gauge',
    `bypage_process_uptime_seconds ${(Date.now() - state.started) / 1000}`,
    '# HELP bypage_process_resident_memory_bytes Resident process memory.',
    '# TYPE bypage_process_resident_memory_bytes gauge',
    `bypage_process_resident_memory_bytes ${process.memoryUsage().rss}`,
  );
  return lines.join('\n') + '\n';
}
