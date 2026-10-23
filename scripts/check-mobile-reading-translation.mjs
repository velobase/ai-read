// Offline behavior checks for the actual mobile scheduler. No Expo runtime, server,
// model, database files, dependency installation or application startup is involved.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';

const filename = new URL('../apps/mobile/src/adapters/translation-queue.ts', import.meta.url);
const { outputText } = ts.transpileModule(await readFile(filename, 'utf8'), {
  fileName: filename.pathname,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
const abortError = () => Object.assign(new Error('cancelled'), { name: 'AbortError' });

function harness(texts, options = {}) {
  const book = {
    id: 'fixture-book',
    title: 'Offline scheduler fixture',
    language: 'en',
    chapters: [
      {
        id: 'chapter',
        title: 'Fixture',
        paragraphs: Object.entries(texts).map(([id, text]) => ({ id, text })),
      },
    ],
  };
  const entries = book.chapters[0].paragraphs.map((paragraph, ordinal) => ({
    paragraph,
    ordinal,
    chapter: 'Fixture',
    chapterIndex: 0,
  }));
  const handle = { key: 'fixture-library' };
  const leaseController = new AbortController();
  const lease = {
    handle,
    epoch: 1,
    signal: leaseController.signal,
    isCurrent: () => !leaseController.signal.aborted,
  };
  const owner = Symbol('reader');
  const saved = { zh: { ...(options.saved || {}) } };
  const drafts = new Map();
  const checkpoints = [],
    commits = [],
    calls = [],
    capabilityCalls = [],
    errors = [];
  const storeListeners = new Set(),
    accountListeners = new Set(),
    appListeners = new Set();
  const account = {
    revision: 1,
    origin: 'https://fixture.invalid',
    loading: false,
    busy: false,
    issue: '',
  };
  let storeRevision = 0,
    clock = 0,
    timerId = 0,
    uuid = 0;
  const timers = new Map();
  const checkGuard = (guard) => {
    if (guard.signal.aborted || !guard.isCurrent()) throw abortError();
  };
  const AppState = {
    currentState: 'active',
    addEventListener(name, fn) {
      assert.equal(name, 'change');
      appListeners.add(fn);
      return { remove: () => appListeners.delete(fn) };
    },
  };
  const modules = {
    'react-native': { AppState },
    'expo-crypto': { randomUUID: () => `fixture-${++uuid}` },
    '@bypage/reading-core': {
      effectiveBookLanguage: (value) => value.sourceLanguage || value.language,
      sameReadingLanguage: (a, b) => a === b,
      savedTranslationKey: (language, paragraphId, version) =>
        JSON.stringify({ language, paragraphId, version }),
      resolveSavedTranslationIdentity: (_book, key) => JSON.parse(key),
    },
    './account': {
      accountRevision: () => account.revision,
      accountSnapshot: () => account,
      subscribeAccount: (fn) => {
        accountListeners.add(fn);
        return () => accountListeners.delete(fn);
      },
    },
    './api': {
      normalizeServerOrigin: (origin) => new URL(origin).origin,
      async checkConnection(origin, signal) {
        if (signal.aborted) throw abortError();
        capabilityCalls.push({ origin, signal });
        await options.connection?.(capabilityCalls.length);
        return { nativeTranslation: true, translationContextKey: 'a'.repeat(64) };
      },
      translateReading(origin, input, signal) {
        const call = { origin, input, signal };
        calls.push(call);
        if (options.respond)
          return Promise.resolve().then(() => options.respond(call, calls.length));
        return new Promise((resolve, reject) => {
          call.resolve = resolve;
          call.reject = reject;
          if (options.honorAbort !== false) {
            if (signal.aborted) reject(abortError());
            else signal.addEventListener('abort', () => reject(abortError()), { once: true });
          }
        });
      },
    },
    './database': {
      getTranslationDisplay: async () => ({ texts: structuredClone(saved), keys: {} }),
    },
    './translation-store': {
      subscribeTranslationStore: (fn) => {
        storeListeners.add(fn);
        return () => storeListeners.delete(fn);
      },
      translationStoreRevision: () => storeRevision,
    },
    './translation-drafts': {
      createTranslationDraftScope: (_book, origin, contextKey, language) => ({
        origin,
        contextKey,
        language,
      }),
      async loadTranslationDraft(_handle, _book, id, _scope, guard) {
        checkGuard(guard);
        return drafts.has(id) ? structuredClone(drafts.get(id)) : null;
      },
      async saveTranslationDraft(_handle, _book, id, _scope, parts, guard) {
        checkGuard(guard);
        const next = structuredClone({ parts });
        drafts.set(id, next);
        checkpoints.push({ id, parts: next.parts });
        return next;
      },
      async commitTranslationDraft(_handle, _book, id, scope, guard) {
        checkGuard(guard);
        const draft = drafts.get(id);
        assert.equal(
          draft?.parts.at(-1)?.end,
          texts[id].length,
          'only a complete paragraph may be committed',
        );
        // This mock models the existing atomic writer's preserve-existing contract.
        if (!saved[scope.language][id])
          saved[scope.language][id] = draft.parts.map((part) => part.text).join('\n\n');
        drafts.delete(id);
        commits.push(id);
        storeRevision++;
        for (const fn of storeListeners) fn(handle, book.id);
      },
    },
  };
  class ClockDate extends Date {
    static now() {
      return clock;
    }
  }
  const exports = {};
  const context = createContext({
    exports,
    Error,
    TypeError,
    URL,
    AbortController,
    Date: ClockDate,
    console: { error: (...values) => errors.push(values) },
    setTimeout(fn, delay = 0) {
      const id = ++timerId;
      timers.set(id, { at: clock + delay, fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unmocked import prohibited: ${name}`);
      return modules[name];
    },
    fetch() {
      assert.fail('Network access is prohibited in this check');
    },
  });
  new Script(outputText, { filename: filename.pathname }).runInContext(context);
  return {
    calls,
    capabilityCalls,
    saved,
    drafts,
    checkpoints,
    commits,
    errors,
    timers,
    snapshot: exports.translationQueueSnapshot,
    cached: () => exports.cachedBookTranslations(handle, book.id),
    async request(ids = Object.keys(texts)) {
      exports.requestReadingTranslation(owner, {
        lease,
        book,
        origin: account.origin,
        language: 'zh',
        entries: ids.map((id) => entries.find((entry) => entry.paragraph.id === id)),
      });
      await flush();
    },
    async resolve(index, text) {
      calls[index].resolve(text);
      await flush();
    },
    async app(state) {
      AppState.currentState = state;
      for (const fn of appListeners) fn(state);
      await flush();
    },
    async retry() {
      exports.retryReadingTranslation(owner);
      await flush();
    },
    async release() {
      exports.requestReadingTranslation(owner, null);
      await flush();
    },
    async advance(ms) {
      const end = clock + ms;
      for (let count = 0; count < 1000; count++) {
        const pending = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) {
          clock = end;
          await flush();
          return;
        }
        const [id, timer] = pending;
        clock = timer.at;
        timers.delete(id);
        timer.fn();
        await flush();
      }
      assert.fail('Unexpected unbounded timer loop');
    },
  };
}

test('saved paragraphs are reused without a model or capability request', async () => {
  const h = harness({ p: 'Original text' }, { saved: { p: 'Previously saved translation' } });
  await h.request();
  assert.equal(h.calls.length, 0);
  assert.equal(h.capabilityCalls.length, 0);
  assert.equal(h.cached().zh.p, 'Previously saved translation');
  await h.release();
});

test('a paragraph above 60,000 characters checkpoints 6,000-unit chunks and publishes only when complete', async () => {
  const source = 'a'.repeat(5999) + '😀' + 'b'.repeat(60000);
  const h = harness({ long: source });
  await h.request();
  let offset = 0;
  for (let index = 0; offset < source.length; index++) {
    const chunk = h.calls[index].input.target;
    assert.ok(chunk.length > 0 && chunk.length <= 6000);
    assert.equal(chunk, source.slice(offset, offset + chunk.length));
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk), 'a chunk must not split a surrogate pair');
    assert.equal(h.cached().zh.long, undefined, 'partial output must remain hidden');
    offset += chunk.length;
    await h.resolve(index, `translated chunk ${index + 1}`);
    assert.equal(h.checkpoints.at(-1).parts.at(-1).end, offset);
    assert.equal(h.commits.length, offset === source.length ? 1 : 0);
  }
  assert.equal(h.calls.map((call) => call.input.target).join(''), source);
  assert.equal(h.drafts.size, 0);
  assert.equal(
    h.cached().zh.long,
    h.calls.map((_, index) => `translated chunk ${index + 1}`).join('\n\n'),
  );
  await h.release();
});

test('background interruption keeps completed checkpoints and resumes the unfinished chunk in foreground', async () => {
  const source = 'a'.repeat(6000) + 'b'.repeat(6000) + 'c'.repeat(1000);
  const h = harness({ p: source });
  await h.request();
  await h.resolve(0, 'first completed chunk');
  assert.equal(h.calls.length, 2);
  await h.app('background');
  assert.ok(h.calls[1].signal.aborted);
  assert.equal(h.checkpoints.length, 1);
  assert.equal(h.drafts.get('p').parts.at(-1).end, 6000);
  assert.equal(h.saved.zh.p, undefined);
  await h.advance(200000);
  assert.equal(h.calls.length, 2);
  await h.app('active');
  assert.equal(h.calls[2].input.target, source.slice(6000, 12000));
  await h.resolve(2, 'resumed second chunk');
  await h.resolve(3, 'final chunk');
  assert.equal(h.saved.zh.p, 'first completed chunk\n\nresumed second chunk\n\nfinal chunk');
  assert.deepEqual(h.commits, ['p']);
  await h.release();
});

test('a new reading position waits for stale work to settle, rejects its late result and runs next', async () => {
  const h = harness({ old: 'old paragraph', next: 'new visible paragraph' }, { honorAbort: false });
  await h.request(['old']);
  await h.request(['next']);
  assert.ok(h.calls[0].signal.aborted);
  assert.equal(h.calls.length, 1, 'old in-flight work must settle before a new model call');
  await h.resolve(0, 'late stale result');
  assert.equal(h.saved.zh.old, undefined);
  assert.equal(h.checkpoints.length, 0);
  assert.equal(h.calls[1].input.target, 'new visible paragraph');
  await h.resolve(1, 'new visible translation');
  assert.deepEqual(h.commits, ['next']);
  await h.release();
});

test('HTTP failures receive two automatic retries, stay online, and do not restart on foreground', async () => {
  const failure = new Error('HTTP 503', { cause: new Error('fixture upstream unavailable') });
  const h = harness(
    { p: 'source' },
    {
      respond: () => {
        throw failure;
      },
    },
  );
  await h.request();
  assert.equal(h.calls.length, 1);
  await h.advance(999);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  assert.equal(h.calls.length, 2);
  await h.advance(2999);
  assert.equal(h.calls.length, 2);
  await h.advance(1);
  assert.equal(h.calls.length, 3);
  assert.equal(h.snapshot().status, 'error');
  assert.equal(h.snapshot().online, true);
  assert.equal(h.snapshot().error, 'HTTP 503');
  assert.equal(
    h.errors[0].at(-1),
    failure,
    'the original exception and cause must reach the logger',
  );
  await h.app('background');
  await h.app('active');
  await h.advance(60000);
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 0);
  await h.retry();
  assert.equal(h.calls.length, 4, 'explicit retry may reset the bounded retry allowance');
  await h.release();
});

test('offline polling checks capabilities only and resumes translation after connectivity returns', async () => {
  let connected = false;
  const h = harness(
    { p: 'source' },
    {
      connection: (count) => {
        if (count > 1 && !connected) throw new TypeError('Network request failed');
      },
      respond: () => {
        if (!connected) throw new TypeError('Network request failed');
        return 'recovered translation';
      },
    },
  );
  await h.request();
  assert.equal(h.calls.length, 1);
  assert.equal(h.snapshot().status, 'offline');
  await h.advance(30000);
  assert.equal(h.capabilityCalls.length, 3);
  assert.equal(h.calls.length, 1, 'offline probes must not call the model');
  connected = true;
  await h.advance(15000);
  assert.equal(h.calls.length, 2);
  assert.equal(h.saved.zh.p, 'recovered translation');
  assert.equal(h.snapshot().online, true);
  await h.release();
});
