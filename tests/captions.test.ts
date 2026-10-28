import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findCaptionIndex, findCaptionIndexAtOrBefore, parseJson3 } from '../src/core/captions.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/asr-json3.json', import.meta.url), 'utf8'));

test('parseJson3: joins auto-generated caption words into one line and drops newline-only events', () => {
  const captions = parseJson3(fixture);
  assert.deepEqual(
    captions.map((c) => c.text),
    ["so today we're going", 'to talk about how', 'transformers actually work', '[Music]']
  );
});

test('parseJson3: cuts an overlapping display time at the start of the next line', () => {
  const captions = parseJson3(fixture);
  assert.deepEqual(
    captions.map((c) => [c.startTime, c.endTime]),
    [
      [0.16, 2.16],
      [2.16, 4.2],
      [4.2, 6.41],
      [6.41, 9.41],
    ]
  );
});

test('parseJson3: empty when there are no events', () => {
  assert.deepEqual(parseJson3({}), []);
});

test('findCaptionIndex: returns the line being shown, null between lines', () => {
  const captions = parseJson3(fixture);
  assert.equal(findCaptionIndex(captions, 0), null);
  assert.equal(findCaptionIndex(captions, 0.16), 0);
  assert.equal(findCaptionIndex(captions, 2.159), 0);
  assert.equal(findCaptionIndex(captions, 2.16), 1);
  assert.equal(findCaptionIndex(captions, 9.0), 3);
  assert.equal(findCaptionIndex(captions, 9.41), null);
  assert.equal(findCaptionIndex([], 1), null);
});

test('findCaptionIndexAtOrBefore: the last line that started by that time', () => {
  const captions = parseJson3(fixture);
  assert.equal(findCaptionIndexAtOrBefore(captions, 0), 0);
  assert.equal(findCaptionIndexAtOrBefore(captions, 5), 2);
  assert.equal(findCaptionIndexAtOrBefore(captions, 100), 3);
});
