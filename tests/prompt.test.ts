import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, createLineParser, createPromptTranslator, type StreamFn } from '../src/core/prompt.ts';

const context = {
  title: 'How Transformers Work',
  before: [
    { source: "so today we're going", translation: '今日は' },
    { source: 'to talk about how', translation: undefined },
  ],
  after: ['[Music]'],
};

const enJa = { source: 'en', target: 'ja' };

const streamOf =
  (...chunks: string[]): StreamFn =>
  async function* () {
    for (const chunk of chunks) yield chunk;
  };

test('buildPrompt: includes the title, surrounding lines and the numbered lines to translate', () => {
  const prompt = buildPrompt(['transformers actually work', 'right?'], context, enJa);
  assert.match(prompt, /How Transformers Work/);
  assert.match(prompt, /- so today we're going\n {2}→ 今日は/);
  assert.match(prompt, /- to talk about how\n/);
  assert.match(prompt, /<lines>\n1\ttransformers actually work\n2\tright\?\n<\/lines>/);
  assert.match(prompt, /## 直後の行\n- \[Music\]/);
  assert.match(prompt, /行数は 2。/);
});

test('buildPrompt: (なし) when there is no context', () => {
  const prompt = buildPrompt(['a'], { before: [], after: [] }, enJa);
  assert.match(prompt, /## 直前の行（→ のあとは表示済みの訳）\n\(なし\)/);
  assert.match(prompt, /## 直後の行\n\(なし\)/);
  assert.match(prompt, /## 動画タイトル\n\(不明\)/);
});

test('buildPrompt: names the source and target languages in Japanese', () => {
  const prompt = buildPrompt(['안녕하세요'], { before: [], after: [] }, { source: 'ko', target: 'en' });
  assert.match(prompt, /韓国語字幕を英語字幕に訳す/);
  assert.match(prompt, /各行を英語に訳す/);
  assert.match(prompt, /短く自然な英語にする/);
  assert.match(prompt, /## 訳す行（番号<TAB>韓国語）/);
  assert.doesNotMatch(prompt, /日本語/);
});

test('createLineParser: reports each line as it arrives', () => {
  const seen: [number, string][] = [];
  const parser = createLineParser(2, (i, t) => seen.push([i, t]));
  parser.feed('1\tあ\n');
  assert.deepEqual(seen, [[0, 'あ']]);
  parser.feed('2\tい\n');
  assert.deepEqual(parser.end(), ['あ', 'い']);
});

test('createLineParser: waits for the newline when a chunk ends mid-line', () => {
  const seen: [number, string][] = [];
  const parser = createLineParser(2, (i, t) => seen.push([i, t]));
  parser.feed('1\tこん');
  assert.deepEqual(seen, []);
  parser.feed('にちは\n2');
  assert.deepEqual(seen, [[0, 'こんにちは']]);
  parser.feed('\tさよなら');
  // A last line that doesn't end with a newline is read by end
  assert.deepEqual(parser.end(), ['こんにちは', 'さよなら']);
});

test('createLineParser: accepts ": ", ". " and the like besides TAB, and ignores code fences and extra lines', () => {
  const parser = createLineParser(3);
  parser.feed('```\n1: あ\n2. い\n説明です\n3）う\n```\n');
  assert.deepEqual(parser.end(), ['あ', 'い', 'う']);
});

test('createLineParser: drops out-of-range numbers, repeated numbers and empty translations; missing lines are undefined', () => {
  const parser = createLineParser(3);
  parser.feed('0\tx\n1\tあ\n1\tまたあ\n4\tx\n3\t\n');
  assert.deepEqual(parser.end(), ['あ', undefined, undefined]);
});

test('createPromptTranslator: passes the prompt to the stream and reports lines as they arrive', async () => {
  const prompts: string[] = [];
  const seen: number[] = [];
  const stream: StreamFn = (prompt) => {
    prompts.push(prompt);
    return streamOf('1\t実際の', '仕組み\n2\tですよね\n')(prompt);
  };
  const translator = createPromptTranslator(stream, enJa);
  const result = await translator.translate(['transformers actually work', 'right?'], context, {
    onLine: (i) => seen.push(i),
  });
  assert.deepEqual(result, ['実際の仕組み', 'ですよね']);
  assert.deepEqual(seen, [0, 1]);
  assert.match(prompts[0], /transformers actually work/);
});

test('createPromptTranslator: stops reading when aborted', async () => {
  const controller = new AbortController();
  const stream: StreamFn = async function* () {
    yield '1\tあ\n';
    controller.abort();
    yield '2\tい\n';
  };
  const translator = createPromptTranslator(stream, enJa);
  await assert.rejects(translator.translate(['a', 'b'], context, { signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('createLineParser: keeps symbols after the TAB as part of the translation', () => {
  const parser = createLineParser(3);
  parser.feed('1\t.5 秒\n2\t...\n3\t: と言った\n');
  assert.deepEqual(parser.end(), ['.5 秒', '...', ': と言った']);
});

test('createPromptTranslator: does not use a partial line when an aborted stream ends normally', async () => {
  const controller = new AbortController();
  const seen: number[] = [];
  const stream: StreamFn = async function* () {
    yield '1\tあ\n2\tい';
    controller.abort();
  };
  const translator = createPromptTranslator(stream, enJa);
  await assert.rejects(
    translator.translate(['a', 'b'], context, { signal: controller.signal, onLine: (i) => seen.push(i) }),
    { name: 'AbortError' }
  );
  // Line 1, which arrived up to its newline, was already reported; line 2, cut off midway, is not
  assert.deepEqual(seen, [0]);
});
