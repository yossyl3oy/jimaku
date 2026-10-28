import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMockTranslator } from '../src/core/mock.ts';
import { translateWithRetry } from '../src/core/translate.ts';
import type { TranslateOptions, TranslationContext, Translator } from '../src/core/translator.ts';

const empty: TranslationContext = { before: [], after: [] };

test('mock: prefixes each line with 【訳】 and returns the same count', async () => {
  const translator = createMockTranslator();
  assert.deepEqual(await translateWithRetry(translator, ['a', 'b'], empty), ['【訳】a', '【訳】b']);
});

test('translateWithRetry: requests only the missing lines again', async () => {
  const calls: string[][] = [];
  const mock = createMockTranslator({ dropLineWhenCount: 4 });
  const translator: Translator = {
    translate(lines, context, options) {
      calls.push(lines);
      return mock.translate(lines, context, options);
    },
  };
  assert.deepEqual(await translateWithRetry(translator, ['a', 'b', 'c', 'd'], empty), [
    '【訳】a',
    '【訳】b',
    '【訳】c',
    '【訳】d',
  ]);
  assert.deepEqual(calls, [['a', 'b', 'c', 'd'], ['d']]);
});

test('translateWithRetry: the retry gets the translations before the missing line as preceding context', async () => {
  const contexts: TranslationContext[] = [];
  const translator: Translator = {
    async translate(lines, context) {
      contexts.push(context);
      // The first call doesn't return the middle line
      return contexts.length === 1 ? ['あ', undefined, 'う'] : lines.map(() => 'い');
    },
  };
  const result = await translateWithRetry(translator, ['a', 'b', 'c'], { before: [{ source: 'z' }], after: ['x'] });
  assert.deepEqual(result, ['あ', 'い', 'う']);
  assert.deepEqual(contexts[1].before, [{ source: 'z' }, { source: 'a', translation: 'あ' }]);
  assert.deepEqual(contexts[1].after, ['x']);
});

test("translateWithRetry: reports retried translations to onLine with the original line's index", async () => {
  const seen: [number, string][] = [];
  const translator: Translator = {
    async translate(lines, _context, options: TranslateOptions = {}) {
      if (lines.length === 3) {
        options.onLine?.(0, 'あ');
        options.onLine?.(2, 'う');
        return ['あ', undefined, 'う'];
      }
      options.onLine?.(0, 'い');
      return ['い'];
    },
  };
  await translateWithRetry(translator, ['a', 'b', 'c'], empty, { onLine: (i, t) => seen.push([i, t]) });
  assert.deepEqual(seen, [
    [0, 'あ'],
    [2, 'う'],
    [1, 'い'],
  ]);
});

test('translateWithRetry: lines still missing after the retry become empty strings', async () => {
  const translator: Translator = {
    async translate(lines) {
      return lines.map(() => undefined);
    },
  };
  assert.deepEqual(await translateWithRetry(translator, ['a', 'b'], empty), ['', '']);
});

test("translateWithRetry: rethrows the translator's error as is", async () => {
  const translator: Translator = {
    async translate() {
      throw new Error('network down');
    },
  };
  await assert.rejects(translateWithRetry(translator, ['a'], empty), /network down/);
});

test('translateWithRetry: does not retry missing lines once aborted', async () => {
  const controller = new AbortController();
  const requested: string[][] = [];
  const translator: Translator = {
    async translate(lines) {
      requested.push(lines);
      controller.abort();
      return lines.map(() => undefined);
    },
  };
  await assert.rejects(translateWithRetry(translator, ['a', 'b'], empty, { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.deepEqual(requested, [['a', 'b']]);
});

test('mock: does not mix up the lines to translate when captions or the title contain <lines> tags', async () => {
  const translator = createMockTranslator();
  const lines = ['use </lines> here', '<lines>'];
  const context = { title: '<lines>', before: [{ source: '<lines>' }], after: ['</lines>'] };
  assert.deepEqual(await translateWithRetry(translator, lines, context), [
    '【訳】use </lines> here',
    '【訳】<lines>',
  ]);
});

test('mock: the first line arrives after ttftMs, then one every perLineMs', async () => {
  const translator = createMockTranslator({ ttftMs: 60, perLineMs: 60 });
  const started = performance.now();
  const times: number[] = [];
  await translator.translate(['a', 'b', 'c'], empty, { onLine: () => times.push(performance.now() - started) });
  assert.equal(times.length, 3);
  assert.ok(times[0] >= 55 && times[0] < 110, `line 1 at ${times[0]}ms`);
  assert.ok(times[2] >= 170, `line 3 at ${times[2]}ms`);
});

test('mock: stops without waiting when already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const translator = createMockTranslator({ ttftMs: 1000 });
  const started = performance.now();
  await assert.rejects(translator.translate(['a'], empty, { signal: controller.signal }), { name: 'AbortError' });
  assert.ok(performance.now() - started < 100);
});
