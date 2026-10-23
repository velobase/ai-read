// Offline checks of the real Web reading translator. No browser, network or model is used.
// Run: node scripts/check-web-reading-translation.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = path.join(root, 'packages/reading-core/src');
const webRoot = path.join(root, 'src/lib');
const compiled = new Map();
const clone = (value) => structuredClone(value);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const settings = {
  language: 'zh-CN',
  baseUrl: 'https://offline.invalid/v1',
  model: 'fixture-model-a',
  translationPrompt: '',
};
const book = (text = 'An original reading fixture.', secondParagraph = false) => ({
  id: 'fixture-book',
  title: 'Offline reading fixture',
  author: 'Fixture author',
  language: 'en',
  importedAt: 1,
  chapters: [
    {
      id: 'chapter-0',
      title: 'One',
      paragraphs: [
        { id: '0.0', kind: 'text', text },
        ...(secondParagraph ? [{ id: '0.1', kind: 'text', text: 'Second paragraph.' }] : []),
      ],
    },
  ],
});

function harness(fixture = book(), respond = () => '完整译文') {
  let stores = new Map();
  let transactions = Promise.resolve();
  const events = { calls: [], locks: [], drafts: [], publications: [], local: 0, sync: 0 };
  const table = (database, name) => {
    if (!database.has(name)) database.set(name, new Map());
    return database.get(name);
  };
  const put = (name, key, value) => table(stores, name).set(JSON.stringify(key), clone(value));
  const values = (name) => [...table(stores, name).values()].map(clone);
  const get = (name, key) => clone(table(stores, name).get(JSON.stringify(key)));
  put('books', fixture.id, fixture);
  const database = {
    idb: async (value) => value,
    readLocal: async (name, key) => get(name, key),
    notifyLocalData: () => events.local++,
    notifySyncDirty: () => events.sync++,
    localTransaction: (_mode, callback) => {
      const result = transactions.then(async () => {
        const snapshot = clone(stores);
        const writes = [];
        const tx = {
          objectStore: (name) => ({
            get: (key) => clone(table(snapshot, name).get(JSON.stringify(key))),
            put: (value, key) => {
              table(snapshot, name).set(JSON.stringify(key), clone(value));
              writes.push({ name, value: clone(value) });
              return key;
            },
            delete: (key) => table(snapshot, name).delete(JSON.stringify(key)),
          }),
        };
        const value = await callback(tx);
        // Failed callbacks never commit, matching IDB transaction atomicity.
        stores = snapshot;
        for (const write of writes) {
          if (write.name === 'translation-jobs') events.drafts.push(write.value.parts.length);
          if (write.name === 'translation-versions') events.publications.push(write.value);
        }
        return value;
      });
      transactions = result.catch(() => {});
      return result;
    },
  };
  const lockTails = new Map();
  const secondLock = deferred();
  const locks = {
    request: async (name, { signal }, run) => {
      events.locks.push(name);
      if (events.locks.length === 2) secondLock.resolve();
      const previous = lockTails.get(name) || Promise.resolve();
      const release = deferred();
      const tail = previous.then(() => release.promise);
      lockTails.set(name, tail);
      await previous;
      try {
        signal.throwIfAborted();
        return await run();
      } finally {
        release.resolve();
        if (lockTails.get(name) === tail) lockTails.delete(name);
      }
    },
  };
  const mocks = new Map([
    [path.join(webRoot, 'local-database'), database],
    [path.join(webRoot, 'storage-scope'), { libraryDatabaseName: () => 'offline-fixture' }],
    [
      path.join(webRoot, 'sync-storage'),
      {
        ensureLocalBook: async (tx, id) => tx.objectStore('books').get(id),
        stage: async (tx, kind, bookId, key, payload) =>
          tx.objectStore('outbox').put({ kind, bookId, key, payload }, [bookId, key]),
      },
    ],
    [
      path.join(webRoot, 'ai'),
      {
        AIRequestError: class AIRequestError extends Error {},
        streamAI: async (config, input, signal, onText) => {
          const call = {
            model: config.model,
            target: input.target,
            draftParts: values('translation-jobs')[0]?.parts.length || 0,
            published: values('translation-versions').length,
          };
          events.calls.push(call);
          onText('未完成的流式输出');
          return respond({ call, signal, ordinal: events.calls.length });
        },
      },
    ],
  ]);
  const context = vm.createContext({
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    AbortSignal,
    DOMException,
    navigator: { locks },
    // Deliberately no fetch, XMLHttpRequest, process or native require.
  });
  const modules = new Map();
  const allowedWeb = new Set([
    'reading-translation',
    'saved-translation-storage',
    'translation-selection',
    'translation-storage',
    'translation-edition',
    'translation-prompt',
  ]);
  function load(filename) {
    if (mocks.has(filename)) return mocks.get(filename);
    if (filename === coreRoot)
      return Object.assign(
        {},
        load(path.join(coreRoot, 'reading-language')),
        load(path.join(coreRoot, 'translation-source')),
        load(path.join(coreRoot, 'saved-translation')),
      );
    assert.ok(
      filename.startsWith(`${coreRoot}${path.sep}`) ||
        (path.dirname(filename) === webRoot && allowedWeb.has(path.basename(filename))),
      `Unexpected module in offline harness: ${filename}`,
    );
    if (modules.has(filename)) return modules.get(filename).exports;
    if (!compiled.has(filename))
      compiled.set(
        filename,
        ts.transpileModule(readFileSync(`${filename}.ts`, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          fileName: `${filename}.ts`,
        }).outputText,
      );
    const module = { exports: {} };
    modules.set(filename, module);
    const require = (specifier) => {
      assert.ok(specifier.startsWith('.'), `Unexpected external import: ${specifier}`);
      return load(path.resolve(path.dirname(filename), specifier));
    };
    const execute = vm.runInContext(
      `(function(require,module,exports){${compiled.get(filename)}\n})`,
      context,
      {
        filename: `${filename}.ts`,
      },
    );
    execute(require, module, module.exports);
    return module.exports;
  }
  const { translateReadingParagraph } = load(path.join(webRoot, 'reading-translation'));
  return {
    fixture,
    events,
    get,
    put,
    values,
    secondLock: secondLock.promise,
    core: load(coreRoot),
    storage: load(path.join(webRoot, 'saved-translation-storage')),
    edition: load(path.join(webRoot, 'translation-edition')),
    keys: load(path.join(webRoot, 'translation-storage')),
    run: (config = settings, signal = new AbortController().signal) =>
      translateReadingParagraph(fixture, 0, '0.0', config, signal),
  };
}

async function artifact(h, paragraphs) {
  const source = await h.edition.translationSource(h.fixture);
  const edition = {
    id: 'fixture-edition',
    bookId: h.fixture.id,
    language: settings.language,
    sourceHash: source.hash,
  };
  h.put('translation-manifests', h.keys.manifestKey(h.fixture.id, settings.language), {
    selectedId: edition.id,
    editions: [edition],
  });
  h.put('chapter-translations', h.keys.chapterKey(edition.id, 0), {
    bookId: h.fixture.id,
    editionId: edition.id,
    index: 0,
    sourceHash: source.chapters[0],
    paragraphs,
  });
}

test('historical source hashes retain canonical field order across JSONB reads', async () => {
  const h = harness();
  const source = await h.edition.translationSource(h.fixture);
  const reordered = {
    ...h.fixture,
    chapters: h.fixture.chapters.map((chapter) => ({
      paragraphs: chapter.paragraphs.map((paragraph) => ({
        text: paragraph.text,
        kind: paragraph.kind,
        id: paragraph.id,
      })),
      title: chapter.title,
      id: chapter.id,
    })),
  };
  const normalized = await h.edition.translationSource(reordered);
  assert.equal(normalized.hash, source.hash);
  assert.deepEqual(normalized.chapters, source.chapters);
  assert.equal(h.events.calls.length, 0);
});

test('source-language overrides keep historical canonical SHA identity', async () => {
  for (const language of ['auto', 'en']) {
    const fixture = { ...book(), language, sourceLanguage: 'fr' };
    const h = harness(fixture);
    const storedSource = h.edition.translationBookSource(fixture);
    assert.equal(storedSource.language, 'fr');
    const local = await h.edition.translationSource(fixture);
    const historical = await h.edition.translationSource(storedSource);
    assert.equal(historical.hash, local.hash);
    assert.deepEqual(historical.chapters, local.chapters);
    const importedFingerprint = h.core.translationBookFingerprint(fixture);
    assert.notEqual(h.core.translationBookFingerprint(storedSource), importedFingerprint);
    // A server snapshot has the effective language, not the original import language.
    // Its canonical SHA proves historical identity without inventing a portable book proof.
    assert.equal(
      h.edition.matchesTranslationSource(
        { sourceHash: historical.hash },
        local.hash,
        importedFingerprint,
      ),
      true,
    );
    assert.equal(h.events.calls.length, 0);
  }
});

test('an exact saved selection is read without calling the model', async () => {
  const h = harness();
  const key = h.core.savedTranslationKey(settings.language, '0.0', webcrypto.randomUUID());
  const version = h.storage.createSavedTranslationRecord(h.fixture, key, '已保存的译文', 1);
  h.put('translation-versions', [h.fixture.id, key], version);
  h.put('translation-selections', [h.fixture.id, settings.language, '0.0'], {
    bookId: h.fixture.id,
    language: settings.language,
    paragraphId: '0.0',
    key,
  });
  await h.run();
  assert.equal(h.events.calls.length, 0);
  assert.deepEqual(h.values('translation-versions'), [clone(version)]);
  assert.equal(h.values('outbox').length, 0);
});

test('a complete matching chapter artifact needs no model request', async () => {
  const h = harness(book(undefined, true));
  await artifact(h, { '0.0': '第一段译文', 0.1: '第二段译文' });
  await h.run();
  assert.equal(h.events.calls.length, 0);
  assert.equal(h.values('translation-versions').length, 0);
  assert.equal(h.events.local, 1);
});

test('an incomplete chapter artifact does not block paragraph generation', async () => {
  const h = harness(book(undefined, true));
  await artifact(h, { '0.0': '残缺章节中的译文' });
  await h.run();
  assert.equal(h.events.calls.length, 1);
  assert.equal(h.values('translation-versions')[0].text, '完整译文');
  assert.equal(h.events.publications.length, 1);
});

test('long paragraphs checkpoint each chunk and publish one complete paragraph', async () => {
  const h = harness(book('x'.repeat(13050)), ({ ordinal }) => `译文${ordinal}`);
  await h.run();
  assert.deepEqual(
    h.events.calls.map((call) => call.target.length),
    [6000, 6000, 1050],
  );
  assert.deepEqual(
    h.events.calls.map((call) => call.draftParts),
    [0, 1, 2],
  );
  assert.deepEqual(
    h.events.calls.map((call) => call.published),
    [0, 0, 0],
  );
  assert.deepEqual(h.events.drafts, [1, 2, 3]);
  assert.equal(h.events.publications.length, 1);
  assert.equal(h.values('translation-versions')[0].text, '译文1\n\n译文2\n\n译文3');
  assert.equal(h.values('translation-selections').length, 1);
  assert.equal(h.values('outbox').length, 1);
  assert.equal(h.values('translation-jobs').length, 0);
  assert.equal(h.events.local, 1);
  assert.equal(h.events.sync, 1);
});

test('switching reading context rejects a late result and resumes its last checkpoint', async () => {
  const controller = new AbortController();
  const text = `${'a'.repeat(6000)}${'b'.repeat(6000)}${'c'.repeat(1050)}`;
  const h = harness(book(text), ({ ordinal }) => {
    if (ordinal === 2) {
      controller.abort();
      return '已经取消但仍然返回的输出';
    }
    return ordinal === 1 ? '第一块' : ordinal === 3 ? '第二块' : '第三块';
  });
  await assert.rejects(h.run(settings, controller.signal), { name: 'AbortError' });
  assert.equal(h.events.publications.length, 0);
  assert.equal(h.values('translation-selections').length, 0);
  assert.equal(h.values('translation-jobs')[0].parts.length, 1);
  assert.equal(h.values('translation-jobs')[0].parts[0].end, 6000);
  assert.equal(h.events.local, 0);
  assert.equal(h.events.sync, 0);
  await h.run();
  assert.equal(h.events.calls[2].target, text.slice(6000, 12000));
  assert.equal(h.events.calls[3].target, text.slice(12000));
  assert.equal(h.values('translation-versions')[0].text, '第一块\n\n第二块\n\n第三块');
  assert.equal(h.events.publications.length, 1);
  assert.equal(h.values('translation-jobs').length, 0);
});

test(
  'concurrent requests with different model settings share the paragraph lock',
  { timeout: 5000 },
  async () => {
    const entered = deferred();
    const release = deferred();
    const h = harness(book(), async () => {
      entered.resolve();
      await release.promise;
      return '只生成一次';
    });
    const first = h.run();
    await entered.promise;
    const second = h.run({
      ...settings,
      model: 'fixture-model-b',
      translationPrompt: 'Other prompt',
    });
    await h.secondLock;
    assert.equal(h.events.calls.length, 1);
    assert.equal(h.events.locks[0], h.events.locks[1]);
    release.resolve();
    await Promise.all([first, second]);
    assert.equal(h.events.calls.length, 1);
    assert.equal(h.events.calls[0].model, settings.model);
    assert.equal(h.events.publications.length, 1);
    assert.equal(h.values('translation-selections').length, 1);
    assert.equal(h.values('outbox').length, 1);
  },
);
