import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController, type StartFn } from '../src/core/controller.ts';

// Records how start is called. finish(i) ends the i-th start.
const recorder = () => {
  const calls: { videoId: string; signal: AbortSignal; mount: () => void; finish: (error?: Error) => void }[] = [];
  const start: StartFn = (videoId, signal, onMounted) =>
    new Promise((resolve, reject) => {
      calls.push({ videoId, signal, mount: onMounted, finish: (error) => (error ? reject(error) : resolve()) });
    });
  return { calls, start };
};

// Advances the retry waits by hand. waits[i].go() ends the i-th wait.
const manualWait = () => {
  const waits: { ms: number; signal: AbortSignal; go: () => void }[] = [];
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      waits.push({ ms, signal, go: resolve });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  return { waits, wait };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Opens a video and turns jimaku on for it
const watch = (controller: ReturnType<typeof createController>, videoId: string) => {
  controller.navigate(videoId);
  controller.setEnabled(true);
};

test('navigate: a video opens off, and turning it on starts it', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  controller.navigate('a');
  assert.equal(controller.isEnabled(), false);
  assert.equal(calls.length, 0);
  controller.setEnabled(true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a']);
});

test('navigate: the same video again (the page notifying twice, say) stays on without restarting', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  watch(controller, 'a');
  controller.navigate('a');
  assert.equal(controller.isEnabled(), true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a']);
});

test('navigate: another video, or a page without one, stops the translation and turns jimaku off', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  watch(controller, 'a');
  controller.navigate('b');
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(controller.isEnabled(), false);
  assert.equal(calls.length, 1);

  watch(controller, 'b');
  controller.navigate(null);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(controller.isEnabled(), false);

  // Coming back to a video it was on for still opens off
  controller.navigate('b');
  assert.equal(controller.isEnabled(), false);
  assert.equal(calls.length, 2);
});

test('setEnabled: off stops, on starts the current video again', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  watch(controller, 'a');
  controller.setEnabled(false);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(controller.isEnabled(), false);

  controller.setEnabled(true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'a']);
  assert.equal(calls[1].signal.aborted, false);
});

test('retries automatically at the set intervals after a failure, and gives up when they run out', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const errors: unknown[] = [];
  const controller = createController(start, { onError: (e) => errors.push(e), retryDelays: [100, 500], wait });
  watch(controller, 'a');

  calls[0].finish(new Error('timedtext returned an empty body'));
  await tick();
  assert.deepEqual(waits.map((w) => w.ms), [100]);
  waits[0].go();
  await tick();
  assert.equal(calls.length, 2);

  calls[1].finish(new Error('again'));
  await tick();
  waits[1].go();
  await tick();
  assert.equal(calls.length, 3);

  calls[2].finish(new Error('still'));
  await tick();
  assert.equal(waits.length, 2);
  assert.equal(errors.length, 3);

  // Even after the retries run out, opening the same video again starts it
  controller.navigate('a');
  assert.equal(calls.length, 4);
});

test('does not retry after moving to another video while waiting to retry', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const controller = createController(start, { retryDelays: [100], wait });
  watch(controller, 'a');
  calls[0].finish(new Error('boom'));
  await tick();

  controller.navigate('b');
  assert.equal(waits[0].signal.aborted, true);
  await tick();
  assert.deepEqual(calls.map((c) => c.videoId), ['a']);
});

test('does not start twice when the same video reopens while waiting to retry', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const controller = createController(start, { retryDelays: [100], wait });
  watch(controller, 'a');
  calls[0].finish(new Error('boom'));
  await tick();

  controller.navigate('a');
  assert.equal(calls.length, 1);
  waits[0].go();
  await tick();
  assert.equal(calls.length, 2);
});

test('does not retry after a normal return without mounting (no English captions, etc.), but starts when the same video reopens', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const controller = createController(start, { retryDelays: [100], wait });
  watch(controller, 'a');
  calls[0].finish();
  await tick();
  assert.equal(waits.length, 0);

  controller.navigate('a');
  assert.equal(calls.length, 2);
});

test('once mounted, does not restart for the same video even after it ends', async () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  watch(controller, 'a');
  calls[0].mount();
  calls[0].finish();
  await tick();

  controller.navigate('a');
  assert.equal(calls.length, 1);
});

test('a failure after stopping neither calls onError nor retries', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const errors: unknown[] = [];
  const controller = createController(start, { onError: (e) => errors.push(e), retryDelays: [100], wait });
  watch(controller, 'a');
  controller.setEnabled(false);
  calls[0].finish(new Error('aborted'));
  await tick();
  assert.deepEqual(errors, []);
  assert.equal(waits.length, 0);
});

test('restart: starts the current video again from scratch, and does nothing while off', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  watch(controller, 'a');
  calls[0].mount();
  controller.restart();
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'a']);
  controller.setEnabled(false);
  controller.restart();
  assert.equal(calls.length, 2);
});
