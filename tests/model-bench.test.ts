import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchCases, median, summarize, type Fixture, type RunResult } from '../src/core/model-bench.ts';

const lines = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ s: i, t: `line ${from + i}`, ref: (from + i) % 3 ? `訳 ${from + i}` : null }));

test('benchCases: the chunk, with the lines before it (and their human translations) and after it as context', () => {
  const fixture: Fixture = {
    video: 'v',
    title: 'Title',
    windows: [
      { track: 'en', start: 0, offset: 0, lines: lines(14) },
      { track: 'asr', start: 30, offset: 24, lines: lines(20, 24).map(({ s, t }) => ({ s, t })) },
    ],
  };
  const [first, middle] = benchCases(fixture);
  assert.equal(first.id, 'en@0');
  assert.deepEqual(first.lines, lines(10).map((line) => line.t));
  assert.deepEqual(first.refs.slice(0, 3), [null, '訳 1', '訳 2']);
  assert.deepEqual(first.context, { title: 'Title', before: [], after: ['line 10', 'line 11', 'line 12', 'line 13'] });

  assert.equal(middle.id, 'asr@30');
  assert.equal(middle.lines[0], 'line 30');
  assert.equal(middle.lines.length, 10);
  assert.deepEqual(middle.refs, new Array(10).fill(null));
  assert.deepEqual(middle.context.before.map((line) => line.source), ['line 24', 'line 25', 'line 26', 'line 27', 'line 28', 'line 29']);
  assert.equal(middle.context.before[0].translation, undefined);
  assert.deepEqual(middle.context.after, ['line 40', 'line 41', 'line 42', 'line 43']);
});

test('median: the middle value, or the mean of the two middle ones', () => {
  assert.equal(median([]), undefined);
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([400, 100, 200, 300]), 250);
});

test('summarize: one row per model, effort and prompt, with median times and tokens over the lines translated', () => {
  const run = (model: string, ms: number, input: number, output: number, translated: number): RunResult => ({
    model,
    effort: 'none',
    prompt: 'current',
    caseId: 'c',
    ok: true,
    firstLineMs: ms,
    totalMs: ms * 3,
    usage: { input_tokens: input, output_tokens: output, output_tokens_details: { reasoning_tokens: 0 } },
    translations: Array.from({ length: 10 }, (_, i) => (i < translated ? '訳' : undefined)),
  });
  const failed: RunResult = { model: 'a', effort: 'none', prompt: 'current', caseId: 'c', ok: false, error: 'http_500' };
  const [a, b] = summarize([run('a', 300, 800, 200, 10), run('b', 900, 700, 100, 5), run('a', 500, 800, 200, 10), failed], () => 10);

  assert.equal(a.model, 'a');
  assert.equal(a.runs, 3);
  assert.equal(a.failures, 1);
  assert.equal(a.firstLineMs, 400);
  assert.equal(a.totalMs, 1200);
  assert.equal(a.inputTokens, 800);
  assert.equal(a.reasoningTokens, 0);
  assert.equal(a.tokensPerLine, 100);
  assert.equal(a.coverage, 1);

  assert.equal(b.tokensPerLine, 160);
  assert.equal(b.coverage, 0.5);
});

test('summarize: tokens per line counts only the runs that reported their tokens; prompts are separate rows', () => {
  const run = (prompt: string, usage?: RunResult['usage']): RunResult => ({
    model: 'a',
    effort: 'none',
    prompt,
    caseId: 'c',
    ok: true,
    usage,
    translations: ['訳'],
  });
  const [current, compact] = summarize(
    [run('current', { input_tokens: 70, output_tokens: 30 }), run('current'), run('compact', { total_tokens: 40 })],
    () => 1
  );
  assert.equal(current.prompt, 'current');
  assert.equal(current.tokensPerLine, 100);
  assert.equal(current.coverage, 1);
  assert.equal(compact.tokensPerLine, 40);
});
