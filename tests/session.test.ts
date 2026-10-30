import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Caption } from '../src/core/captions.ts';
import { createMockTranslator } from '../src/core/mock.ts';
import { createCaptionSession } from '../src/core/session.ts';
import type { Translator } from '../src/core/translator.ts';

// One line per second, 30 lines
const captions: Caption[] = Array.from({ length: 30 }, (_, i) => ({
  startTime: i,
  endTime: i + 1,
  text: `line ${i}`,
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const recording = (inner: Translator) => {
  const requested: string[][] = [];
  const translator: Translator = {
    translate(lines, context, options) {
      requested.push(lines);
      return inner.translate(lines, context, options);
    },
  };
  return { translator, requested };
};

test('run: translates from the line being watched to the end; the lines before wait until playback goes back', async () => {
  let time = 15.5;
  const { translator, requested } = recording(createMockTranslator());
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time, chunkSize: 10, idleMs: 5 });
  const run = session.run();
  await sleep(30);
  assert.deepEqual(
    requested.map((lines) => [lines[0], lines.at(-1)]),
    [
      ['line 15', 'line 24'],
      ['line 25', 'line 29'],
    ]
  );
  assert.equal(session.linesAt(3.2)?.translation, undefined);

  // Going back to the start translates the rest, and then the session ends
  time = 0;
  session.seek();
  await run;
  assert.deepEqual(
    requested.slice(2).map((lines) => [lines[0], lines.at(-1)]),
    [
      ['line 0', 'line 9'],
      ['line 10', 'line 14'],
    ]
  );
  assert.deepEqual(session.linesAt(3.2), { index: 3, source: 'line 3', translation: '【訳】line 3' });
});

test('run: keeps only aheadSeconds of playback translated, and goes on as playback gets near', async () => {
  let time = 0;
  const { translator, requested } = recording(createMockTranslator());
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time, chunkSize: 5, aheadSeconds: 12, idleMs: 5 });
  const controller = new AbortController();
  void session.run(controller.signal);
  await sleep(30);
  // Lines starting within 12 seconds: chunks from 0, 5 and 10; the one from 15 waits
  assert.deepEqual(requested.map((lines) => lines[0]), ['line 0', 'line 5', 'line 10']);

  time = 4;
  await sleep(30);
  assert.deepEqual(requested.map((lines) => lines[0]), ['line 0', 'line 5', 'line 10', 'line 15']);
  controller.abort();
});

test('linesAt: translation is undefined until translated, null at a time with no caption', () => {
  const session = createCaptionSession({ captions, translator: createMockTranslator(), getCurrentTime: () => 0 });
  assert.deepEqual(session.linesAt(0.5), { index: 0, source: 'line 0', translation: undefined });
  assert.equal(session.linesAt(31), null);
});

test('run: each translated line is visible as it arrives (no waiting for the whole chunk)', async () => {
  const session = createCaptionSession({
    captions,
    translator: createMockTranslator({ ttftMs: 0, perLineMs: 40 }),
    getCurrentTime: () => 0,
  });
  const controller = new AbortController();
  void session.run(controller.signal);
  await sleep(60);
  assert.equal(session.linesAt(0.5)?.translation, '【訳】line 0');
  assert.equal(session.linesAt(9.5)?.translation, undefined);
  controller.abort();
});

test('seek: a jump to an untranslated part cuts off the chunk in flight and translates from the new position', async () => {
  let time = 0;
  const { translator, requested } = recording(createMockTranslator({ ttftMs: 30, perLineMs: 30 }));
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time });
  const controller = new AbortController();
  void session.run(controller.signal);
  await sleep(50);

  time = 20.5;
  session.seek();
  await sleep(50);
  assert.equal(requested[1][0], 'line 20');
  assert.equal(session.linesAt(20.5)?.translation, '【訳】line 20');
  // Lines that arrived before the cut-off stay
  assert.equal(session.linesAt(0.5)?.translation, '【訳】line 0');
  controller.abort();
});

test('seek: does not cut off when the jump lands inside the chunk being translated', async () => {
  let time = 0;
  const { translator, requested } = recording(createMockTranslator({ ttftMs: 30, perLineMs: 10 }));
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time });
  const controller = new AbortController();
  void session.run(controller.signal);
  await sleep(10);
  time = 5.5;
  session.seek();
  await sleep(150);
  assert.deepEqual(requested.map((lines) => lines[0]).slice(0, 2), ['line 0', 'line 10']);
  controller.abort();
});

test('seek: lines that never arrived after a cut-off are requested again when playback goes back there', async () => {
  let time = 0;
  const { translator, requested } = recording(createMockTranslator({ ttftMs: 20, perLineMs: 20 }));
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time, idleMs: 5 });
  const run = session.run();
  await sleep(30);
  time = 20.5;
  session.seek();
  await sleep(500);
  time = 0;
  session.seek();
  await run;
  // The rest of the 0s are requested again, and every line gets a translation
  assert.ok(requested.slice(1).some((lines) => lines.includes('line 9')));
  for (let i = 0; i < 30; i++) assert.equal(session.linesAt(i + 0.5)?.translation, `【訳】line ${i}`);
});

test("run: puts the previous chunk's translations in the next request's context", async () => {
  const contexts: unknown[] = [];
  const translator: Translator = {
    async translate(lines, context) {
      contexts.push(context.before.at(-1));
      return lines.map((line) => `訳:${line}`);
    },
  };
  const session = createCaptionSession({
    captions,
    translator,
    getCurrentTime: () => 0,
    chunkSize: 10,
    beforeLines: 1,
  });
  await session.run();
  assert.deepEqual(contexts, [
    undefined,
    { source: 'line 9', translation: '訳:line 9' },
    { source: 'line 19', translation: '訳:line 19' },
  ]);
});

test('run: a failed chunk gets no translation (empty strings) and the session moves on', async () => {
  const errors: unknown[] = [];
  const translator: Translator = {
    async translate(lines) {
      if (lines[0] === 'line 10') throw new Error('boom');
      return lines.map(() => 'ok');
    },
  };
  const session = createCaptionSession({
    captions,
    translator,
    getCurrentTime: () => 0,
    chunkSize: 10,
    onError: (error) => errors.push(error),
  });
  await session.run();
  assert.equal(errors.length, 1);
  assert.equal(session.linesAt(10.5)?.translation, '');
  assert.equal(session.linesAt(20.5)?.translation, 'ok');
});

test('run: once aborted, does not move to the next chunk or use late translations', async () => {
  const controller = new AbortController();
  const { translator, requested } = recording({
    async translate(lines) {
      controller.abort();
      return lines;
    },
  });
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => 0, chunkSize: 10 });
  await session.run(controller.signal);
  assert.equal(requested.length, 1);
  assert.equal(session.linesAt(0.5)?.translation, undefined);
});

test('run: a failure after aborting does not call onError', async () => {
  const controller = new AbortController();
  const errors: unknown[] = [];
  const translator: Translator = {
    async translate() {
      controller.abort();
      throw new Error('network down');
    },
  };
  const session = createCaptionSession({
    captions,
    translator,
    getCurrentTime: () => 0,
    onError: (error) => errors.push(error),
  });
  await session.run(controller.signal);
  assert.deepEqual(errors, []);
});

test('seek: ignores lines and normal results that arrive after a cut-off, and requests again', async () => {
  let time = 0;
  let calls = 0;
  const translator: Translator = {
    async translate(lines, _context, options = {}) {
      calls++;
      if (calls === 1) {
        // Wait until cut off, then return a late translation (normally, not by throwing)
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve()));
        options.onLine?.(0, 'late');
        return lines.map(() => 'late');
      }
      return lines.map((line) => `訳:${line}`);
    },
  };
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time, idleMs: 5 });
  const run = session.run();
  await sleep(10);
  time = 20.5;
  session.seek();
  await sleep(30);
  time = 0;
  session.seek();
  await run;
  assert.equal(session.linesAt(0.5)?.translation, '訳:line 0');
  assert.equal(session.linesAt(20.5)?.translation, '訳:line 20');
});

test('run: a fatal error stops the session instead of failing every chunk', async () => {
  const errors: unknown[] = [];
  const calls: string[] = [];
  const translator: Translator = {
    async translate(lines) {
      calls.push(lines[0]);
      throw new Error('not signed in');
    },
  };
  const session = createCaptionSession({
    captions,
    translator,
    getCurrentTime: () => 0,
    onError: (error) => errors.push(error),
    isFatal: () => true,
  });
  await session.run();
  assert.deepEqual(calls, ['line 0']);
  assert.equal(errors.length, 1);
  // The lines stay untranslated (not empty), so a new session after signing in translates them
  assert.equal(session.linesAt(0.5)?.translation, undefined);
});

test('run: with translations from before, only the missing lines are requested, and they are filled in place', async () => {
  const { translator, requested } = recording(createMockTranslator());
  const translations: (string | undefined)[] = captions.map((_, i) => (i < 20 ? `前の訳 ${i}` : undefined));
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => 0.5, chunkSize: 10, translations });
  // Already there before anything is requested
  assert.equal(session.linesAt(0.5)?.translation, '前の訳 0');
  await session.run();
  assert.deepEqual(requested, [captions.slice(20).map((caption) => caption.text)]);
  assert.equal(translations[25], '【訳】line 25');
  assert.equal(translations[5], '前の訳 5');
});

test('run: lines that failed before (empty strings) are tried again', async () => {
  const { translator, requested } = recording(createMockTranslator());
  const translations: (string | undefined)[] = captions.map((_, i) => (i === 3 || i === 4 ? '' : `前の訳 ${i}`));
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => 0.5, translations });
  assert.equal(session.linesAt(3.5)?.translation, undefined);
  await session.run();
  assert.deepEqual(requested, [['line 3', 'line 4']]);
  assert.equal(translations[3], '【訳】line 3');
});

test('run: a session stopped partway leaves what arrived for the next one (turning jimaku off and on)', async () => {
  const translations: (string | undefined)[] = new Array(captions.length).fill(undefined);
  const first = recording(createMockTranslator({ ttftMs: 10, perLineMs: 10 }));
  const controller = new AbortController();
  const stopped = createCaptionSession({ captions, translator: first.translator, getCurrentTime: () => 0.5, translations });
  const run = stopped.run(controller.signal);
  await sleep(60);
  controller.abort();
  await run;
  const arrived = translations.filter((translation) => translation !== undefined).length;
  assert.ok(arrived > 0 && arrived < captions.length, `arrived ${arrived}`);

  const second = recording(createMockTranslator());
  await createCaptionSession({ captions, translator: second.translator, getCurrentTime: () => 0.5, translations }).run();
  assert.equal(second.requested.flat().length, captions.length - arrived);
  for (let i = 0; i < 30; i++) assert.equal(translations[i], `【訳】line ${i}`);
});

test('run: onChunkEnd is called after each chunk, with its lines already filled in', async () => {
  const translations: (string | undefined)[] = new Array(captions.length).fill(undefined);
  const filled: number[] = [];
  const session = createCaptionSession({
    captions,
    translations,
    translator: createMockTranslator(),
    getCurrentTime: () => 0,
    chunkSize: 10,
    onChunkEnd: () => filled.push(translations.filter((line) => line).length),
  });
  await session.run();
  assert.deepEqual(filled, [10, 20, 30]);
});

test('run: cached lines are never requested, and the window starts after them', async () => {
  let time = 0;
  const { translator, requested } = recording(createMockTranslator());
  // Lines 0-14 came from the cache (this tab or another)
  const translations: (string | undefined)[] = captions.map((_, i) => (i < 15 ? `前の訳 ${i}` : undefined));
  const session = createCaptionSession({ captions, translator, getCurrentTime: () => time, translations, chunkSize: 5, aheadSeconds: 12, idleMs: 5 });
  const controller = new AbortController();
  void session.run(controller.signal);
  await sleep(30);
  // Line 15 starts more than 12 seconds ahead, so nothing is requested yet
  assert.deepEqual(requested, []);
  time = 4;
  await sleep(30);
  assert.deepEqual(requested.map((lines) => lines[0]), ['line 15']);
  assert.equal(session.linesAt(3.5)?.translation, '前の訳 3');
  controller.abort();
});
