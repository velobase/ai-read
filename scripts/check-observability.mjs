// Focused, offline regression checks. No browser, database or model calls.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.'))
        return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { safeClientProperties, safeClientEvent, surfaceForPath } =
  await import('../src/lib/observability/schema.ts');
const { beginOperation, observe, observedRoute, prometheusMetrics, metricsAuthorized } =
  await import('../src/lib/server/observability.ts');

test('telemetry reconstructs properties without private fields or arbitrary labels', () => {
  const input = {
    surface: 'reader',
    durationMs: 42.25,
    title: 'private book',
    apiKey: 'secret',
    question: 'private question',
    bookId: 'private id',
    surfaceUrl: '/read/private',
    errorKind: 'private exception',
    mode: 'bilingual',
    nested: { text: 'private' },
  };
  assert.deepEqual(safeClientProperties(input), {
    surface: 'reader',
    mode: 'bilingual',
    durationMs: 42.25,
  });
  assert.equal(
    JSON.stringify(safeClientEvent({ name: 'book_open', properties: input })).includes('private'),
    false,
  );
});

test('invalid events, timestamps and metric values are bounded', () => {
  assert.equal(safeClientEvent({ name: 'private title' }), null);
  assert.deepEqual(safeClientProperties({ count: -1, value: Infinity, durationMs: NaN }), {});
  assert.equal(safeClientEvent({ name: 'web_vital', at: 9e99 }, 1000).at, 1000);
  assert.equal(safeClientProperties({ value: 9e99 }).value, 86_400_000);
});

test('route labels never retain book IDs or query strings', () => {
  assert.equal(surfaceForPath('/read/private-book?question=secret'), 'reader');
  assert.equal(surfaceForPath('/books/private-book'), 'book');
  assert.equal(surfaceForPath('/search?q=private'), 'search');
  assert.equal(surfaceForPath('/unrecognized-secret-path'), 'other');
});

test('metrics require a configured long bearer token', () => {
  const token = 'test-only-token-with-at-least-24-characters';
  assert.equal(metricsAuthorized(`Bearer ${token}`, token), true);
  assert.equal(metricsAuthorized(`Bearer ${token}x`, token), false);
  assert.equal(metricsAuthorized(`Bearer ${token.slice(1)}x`, token), false);
  assert.equal(metricsAuthorized('Bearer short', 'short'), false);
  assert.equal(metricsAuthorized(null, token), false);
});

test('operations finish once, correlate across async work, and redact exceptions', async () => {
  const records = [];
  const originalInfo = console.info,
    originalError = console.error;
  console.info = console.error = (line) => records.push(JSON.parse(line));
  try {
    const parent = beginOperation('api.ai');
    await parent.run(async () => {
      await Promise.resolve();
      await assert.rejects(
        observe('ai.completion', async () => {
          throw new Error('secret book and key');
        }),
      );
    });
    parent.finish();
    parent.finish();
    assert.equal(records.length, 2);
    assert.equal(records[0].trace_id, records[1].trace_id);
    assert.notEqual(records[0].span_id, records[1].span_id);
    assert.equal(JSON.stringify(records).includes('secret'), false);
    assert.match(prometheusMetrics(), /bypage_operations_active\{operation="ai.completion"\} 0/);
    assert.match(prometheusMetrics(), /operation="ai.completion",outcome="error"\} 1/);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
});

test('route observation preserves response bodies, status, and cache headers', async () => {
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const route = observedRoute('api.config', async () =>
      Response.json({ ok: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } }),
    );
    const response = await route(new Request('http://localhost/api/config'));
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-request-id'), /^[a-f0-9]{32}$/);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    console.info = originalInfo;
  }
});
