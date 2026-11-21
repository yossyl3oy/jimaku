import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPrompt, createLineParser, createPromptTranslator, type StreamFn } from '../src/prompt.ts';

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
  assert.match(prompt, /## 動画タイトル\nHow Transformers Work/);
  assert.match(prompt, /- so today we're going\n {2}→ 今日は/);
  assert.match(prompt, /- to talk about how\n/);
  assert.match(prompt, /<lines>\n1\ttransformers actually work\n2\tright\?\n<\/lines>/);
  assert.match(prompt, /## 直後の行\n- \[Music\]/);
  assert.match(prompt, /行数は 2。/);
  // The output is shown with real TABs, not "\t" written out
  assert.match(prompt, /\n1\t1行目の訳\n2\t2行目の訳$/);
});

// The YouTube prompt is the one the model benchmark compared (see prompt.ts), so any change to it shows up here
test('buildPrompt: the YouTube prompt stays exactly as benchmarked', () => {
  const prompt = buildPrompt(['transformers actually work', 'right?'], context, enJa);
  assert.equal(prompt, buildPrompt(['transformers actually work', 'right?'], context, enJa, 'youtube'));
  assert.equal(
    prompt,
    `あなたは YouTube 動画の英語字幕を日本語字幕に訳す翻訳者です。

## ルール
1. 「訳す行」の各行を日本語に訳す。行数は 2。
2. 1行は画面に1つずつ出る字幕。行をまとめたり、別の行に言葉を移したりしない。
3. 自動生成字幕では1つの文が複数の行にまたがる。前後の行から文全体の意味をつかみ、その行が担う部分を自然な日本語にする。語順の都合で訳しにくければ、意味の切れ目で分けてよい。
4. 「直前の行」「直後の行」は文脈にだけ使う。人名・呼び方・口調をそろえる。直前の行の訳は変えない。
5. 字幕としてひと目で読める、短く自然な日本語にする。

## 動画タイトル
How Transformers Work

## 直前の行（→ のあとは表示済みの訳）
- so today we're going
  → 今日は
- to talk about how

## 訳す行（番号<TAB>英語）
<lines>
1\ttransformers actually work
2\tright?
</lines>

## 直後の行
- [Music]

## 出力
訳す行と同じ番号を付け、「番号<TAB>訳」を1行ずつ、番号順に出す。説明やコードブロックは付けない。
1\t1行目の訳
2\t2行目の訳`
  );
});

test('buildPrompt: on X, names a video posted to X and the post text instead of a title', () => {
  const prompt = buildPrompt(['a'], { ...context, title: 'Applications are now open' }, enJa, 'x');
  assert.match(prompt, /^あなたは X（旧Twitter）に投稿された動画の英語字幕を日本語字幕に訳す翻訳者です。/);
  assert.match(prompt, /## 投稿の本文\nApplications are now open\n/);
  assert.doesNotMatch(prompt, /YouTube|動画タイトル/);
  // Everything else is the YouTube prompt's
  const youtube = buildPrompt(['a'], { ...context, title: 'Applications are now open' }, enJa);
  assert.equal(
    prompt.replace('X（旧Twitter）に投稿された動画', 'YouTube 動画').replace('## 投稿の本文', '## 動画タイトル'),
    youtube
  );
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

test('createLineParser: the translation is the last field, after the copied source line', () => {
  const sources = ['Elon, hey, welcome back', 'to TED.'];
  const seen: [number, string][] = [];
  const parser = createLineParser(sources, (i, t) => seen.push([i, t]));
  parser.feed('1\tElon, hey, welcome back\tイーロン、おかえりなさい\n2\tto TED.\tTEDへ\n');
  assert.deepEqual(seen, [
    [0, 'イーロン、おかえりなさい'],
    [1, 'TEDへ'],
  ]);
  // Without the copy it reads the same
  const plain = createLineParser(sources);
  plain.feed('1\tイーロン、おかえりなさい\n');
  assert.deepEqual(plain.end(), ['イーロン、おかえりなさい', undefined]);
});

test('createLineParser: a line holding only the copied source is missing, but a translation equal to it is kept', () => {
  const parser = createLineParser(['Elon.', 'Thanks for  having me.', '2026']);
  parser.feed('1\tElon.\tElon.\n2\tthanks for having me.\n3\t2026\n');
  assert.deepEqual(parser.end(), ['Elon.', undefined, '2026']);
});

test('createLineParser: a TAB or "\\t" inside the translation stays, and a copy that differs a little still counts', () => {
  const sources = ['Open the folder', 'so we said, hello', 'Type the path'];
  const parser = createLineParser(sources);
  parser.feed('1\tOpen the folder\tC:\\temp を開く\n');
  parser.feed('2\tso we said hello\tそれで「こんにちは」\tと言いました\n');
  // Without the copy, a "\t" in the translation isn't taken for one
  parser.feed('3\tC:\\temp と入力\n');
  assert.deepEqual(parser.end(), ['C:\\temp を開く', 'それで「こんにちは」\tと言いました', 'C:\\temp と入力']);
});

test('createLineParser: a TAB written out as "\\t" is a TAB too', () => {
  const parser = createLineParser(2);
  parser.feed('1\\tというのが狙いです\n2\\tand it\'s aligned on true north.\\t真北に向けてあります\n');
  assert.deepEqual(parser.end(), ['というのが狙いです', '真北に向けてあります']);
});

test('createLineParser: drops characters no language uses (private use, unassigned planes), keeping new emoji and CJK', () => {
  const parser = createLineParser(2);
  parser.feed('1\t次は\u{4E7FF}\n2\tいいね👍\u{1FAE9}\u{E000}𠮷\u{3134A}\n');
  assert.deepEqual(parser.end(), ['次は', 'いいね👍\u{1FAE9}𠮷\u{3134A}']);
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

test('createPromptTranslator: asks with the prompt for the site it was made for (YouTube unless told)', async () => {
  const prompts: string[] = [];
  const stream: StreamFn = (prompt) => {
    prompts.push(prompt);
    return streamOf('1\tあ\n')(prompt);
  };
  await createPromptTranslator(stream, enJa).translate(['a'], context);
  await createPromptTranslator(stream, enJa, undefined, 'x').translate(['a'], context);
  assert.equal(prompts[0], buildPrompt(['a'], context, enJa, 'youtube'));
  assert.equal(prompts[1], buildPrompt(['a'], context, enJa, 'x'));
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
