// Offline DOM checks of the real reading-anchor functions. No browser or network.
// Run: node --experimental-strip-types scripts/check-reading-translation-layout.mjs
import assert from 'node:assert/strict';
import {
  readReadingAnchor,
  restoreReadingAnchor,
  forgetReadingAnchor,
  readyContentAnchor,
} from '../src/components/reader/reading-layout.ts';
globalThis.getComputedStyle = () => ({ paddingTop: '88', paddingBottom: '80' });
globalThis.NodeFilter = { SHOW_TEXT: 4 };
globalThis.document = {
  createTreeWalker(element) {
    let visited = false;
    return {
      nextNode() {
        if (visited || !element.node) return false;
        visited = true;
        this.currentNode = element.node;
        return true;
      },
    };
  },
  createRange() {
    return {
      selectNodeContents(node) {
        this.node = node;
        this.offset = 0;
      },
      setStart(node, offset) {
        this.node = node;
        this.offset = offset;
      },
      setEnd() {},
      getBoundingClientRect() {
        return this.node.rect(this.offset);
      },
      getClientRects() {
        return [this.node.rect(0)];
      },
    };
  },
};
function fixture() {
  const root = {
    scrollTop: 0,
    dataset: {},
    closest() {
      return {
        getAttribute() {
          return 'scroll';
        },
      };
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 400 };
    },
    querySelectorAll() {
      return passages;
    },
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  };
  const frame = {
    dataset: { chapterIndex: '0' },
    querySelector() {
      return passages[0];
    },
    getBoundingClientRect() {
      return { top: -root.scrollTop };
    },
  };
  const passages = [];
  function add(id, base, translated = '') {
    const passage = {
      dataset: { paragraph: id },
      base,
      translated,
      closest() {
        return frame;
      },
      getBoundingClientRect() {
        return {
          top: this.base - root.scrollTop,
          bottom: this.base - root.scrollTop + 100,
          left: 0,
          right: 400,
          width: 400,
        };
      },
      getClientRects() {
        return [this.getBoundingClientRect()];
      },
      querySelector(selector) {
        return this.translated && selector.includes('data-note-source') ? this.element : null;
      },
    };
    const element = {
      dataset: { noteSource: 'translation' },
      get textContent() {
        return passage.translated;
      },
      closest() {
        return passage;
      },
      getBoundingClientRect() {
        return passage.getBoundingClientRect();
      },
    };
    element.node = {
      get textContent() {
        return passage.translated;
      },
      get length() {
        return passage.translated.length;
      },
      rect(offset) {
        const top = passage.base - root.scrollTop + Math.floor(offset / 10) * 20;
        return { top, bottom: top + 20, left: 0, right: 100, width: 100 };
      },
    };
    passage.element = element;
    passages.push(passage);
    return passage;
  }
  return { root, add };
}
const { root, add } = fixture();
add('before', 0, 'Earlier text');
const target = add('target', 500);
const text = '0123456789'.repeat(20);
const saved = {
  paragraph: 'target',
  chapter: 0,
  offset: 0,
  textSource: 'translation',
  textOffset: 43,
  textQuote: text.slice(43, 75),
  visualOffset: 0,
};
let pending = { scope: 'book:zh:translation', anchor: saved };
restoreReadingAnchor(root, saved);
assert.deepEqual(
  readReadingAnchor(root),
  saved,
  'placeholder restore must retain exact saved offset and quote',
);
assert.equal(
  readyContentAnchor(root, pending, pending.scope),
  null,
  'placeholder cannot complete a restore',
);
target.translated = text;
assert.equal(
  readyContentAnchor(root, pending, pending.scope),
  saved,
  'actual translated text unlocks restore',
);
restoreReadingAnchor(root, readyContentAnchor(root, pending, pending.scope));
assert.equal(
  root.scrollTop,
  492,
  'restored text offset 43 should align its line, not paragraph start',
);
assert.equal(readReadingAnchor(root).textOffset, 43);
assert.equal(
  readyContentAnchor(root, pending, 'book:fr:translation'),
  null,
  'new target language invalidates old request',
);
pending = null;
forgetReadingAnchor(root);
assert.equal(
  readyContentAnchor(root, pending, 'book:zh:translation'),
  null,
  'explicit movement cancels pending restore',
);
const second = fixture();
const placeholder = second.add('missing', 300);
second.add('available', 410, 'Visible later text');
second.root.scrollTop = 240;
const visible = readReadingAnchor(second.root);
assert.equal(
  visible.paragraph,
  'missing',
  'anchor must use first visible placeholder, not later available text',
);
assert.equal(visible.visualOffset, -28);
placeholder.translated = text;
restoreReadingAnchor(second.root, visible);
assert.equal(
  second.root.scrollTop,
  240,
  'first placeholder replacement must preserve its screen position',
);
assert.equal(readReadingAnchor(second.root).textSource, 'translation');
console.log(
  'PASS: saved offset survives placeholder; waits for real text; exact restoration; scope isolation; user cancellation; visible placeholder retention; replacement geometry.',
);
