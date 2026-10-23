// Small offline checks for multilingual search and progress anchors.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { excerptMatch, searchBookPassages } = await import('../src/lib/book-search.ts');
const { readingProgress } = await import('../src/lib/reading-progress.ts');

test('multilingual search highlights original accented, full-width and CJK text correctly', () => {
  for (const [source, query, expected] of [
    ['A café beside the river', 'CAFE', 'café'],
    ['A cafe\u0301 beside the river', 'cafe', 'cafe\u0301'],
    ['Read ＦＵＬＬ width text', 'full', 'ＦＵＬＬ'],
    ['一次跨越语言的阅读。', '跨越语言', '跨越语言'],
    ['A quiet\n\n  room', 'quiet room', 'quiet\n\n  room'],
  ]) {
    const result = excerptMatch(source, query);
    assert.ok(result);
    assert.equal(result.excerpt.slice(result.matchStart, result.matchEnd), expected);
  }
  assert.equal(excerptMatch('private paragraph', 'unmatched'), null);
});

test('passage search reports truncation, preserves anchors and observes cancellation', async () => {
  const books = [{ id: 'fixture', title: 'Original fixture', chapters: [{ title: 'One', paragraphs: Array.from({ length: 4 }, (_, i) => ({ id: `0.${i}`, text: 'A reading example.' })) }] }];
  const result = await searchBookPassages(books, 'reading', { limit: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.limited, true);
  assert.equal(result.matches[1].paragraphId, '0.1');
  assert.equal((await searchBookPassages(books, 'reading', { limit: 4 })).limited, false);
  await assert.rejects(searchBookPassages(books, 'reading', { signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('reading progress uses original character lengths and handles invalid anchors safely', () => {
  const chapters = [{ paragraphs: [{ id: '0.0', text: '1234' }, { id: '0.1', text: '123456' }] }];
  assert.equal(readingProgress(chapters, { paragraph: '0.1', offset: 0.5 }), 0.7);
  assert.equal(readingProgress(chapters, { paragraph: 'missing', offset: 1 }), 0);
  assert.equal(readingProgress(chapters, { paragraph: '0.1', offset: NaN }), 0.4);
  assert.equal(readingProgress(chapters, { paragraph: '0.1', offset: 5 }), 1);
});
