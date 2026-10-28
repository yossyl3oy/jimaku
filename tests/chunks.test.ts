import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildContext, nextRange } from '../src/core/chunks.ts';

const flags = (count: number, requested: number[] = []) =>
  Array.from({ length: count }, (_, i) => requested.includes(i));

test('nextRange: size lines from the line being watched', () => {
  assert.deepEqual(nextRange(flags(30), 15, 10), { start: 15, end: 25 });
  assert.deepEqual(nextRange(flags(30), 25, 10), { start: 25, end: 30 });
});

test('nextRange: if the watched line is requested, starts at the next unrequested line', () => {
  assert.deepEqual(nextRange(flags(30, [15, 16, 17]), 15, 10), { start: 18, end: 28 });
});

test('nextRange: stops at a requested line midway', () => {
  assert.deepEqual(nextRange(flags(30, [20]), 15, 10), { start: 15, end: 20 });
});

test('nextRange: goes back when everything after is requested, null when everything is', () => {
  const requested = flags(30, Array.from({ length: 20 }, (_, i) => i + 10));
  assert.deepEqual(nextRange(requested, 15, 10), { start: 0, end: 10 });
  assert.equal(nextRange(flags(3, [0, 1, 2]), 0, 10), null);
  assert.equal(nextRange([], 0, 10), null);
  assert.throws(() => nextRange(flags(3), 0, 0), RangeError);
});

test('buildContext: preceding lines carry translations, following lines only the source', () => {
  const sources = ['a', 'b', 'c', 'd', 'e', 'f'];
  const translations = ['あ', 'い', undefined];
  const context = buildContext(sources, translations, { start: 3, end: 5 }, {
    title: 't',
    beforeLines: 2,
    afterLines: 3,
  });
  assert.deepEqual(context, {
    title: 't',
    before: [
      { source: 'b', translation: 'い' },
      { source: 'c', translation: undefined },
    ],
    after: ['f'],
  });
});

test('buildContext: the first chunk has no preceding lines', () => {
  const context = buildContext(['a', 'b'], [], { start: 0, end: 1 }, { beforeLines: 5, afterLines: 0 });
  assert.deepEqual(context.before, []);
  assert.deepEqual(context.after, []);
});
