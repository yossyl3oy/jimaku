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

test('navigate: starts when a video opens, and does not restart for the same video', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  controller.navigate('a');
  controller.navigate('a');
  assert.deepEqual(calls.map((c) => c.videoId), ['a']);
});

test('navigate: moving to another video stops the previous one and starts; a non-video page only stops', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  controller.navigate('a');
  controller.navigate('b');
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'b']);
  controller.navigate(null);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(calls.length, 2);
});

test('setEnabled: off stops, on starts the current video again', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  controller.navigate('a');
  controller.setEnabled(false);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(controller.isEnabled(), false);

  // Moving to another video while off doesn't start it
  controller.navigate('b');
  assert.equal(calls.length, 1);

  controller.setEnabled(true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'b']);
  assert.equal(calls[1].signal.aborted, false);
});

test('retries automatically at the set intervals after a failure, and gives up when they run out', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const errors: unknown[] = [];
  const controller = createController(start, { onError: (e) => errors.push(e), retryDelays: [100, 500], wait });
  controller.navigate('a');

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
  controller.navigate('a');
  calls[0].finish(new Error('boom'));
  await tick();

  controller.navigate('b');
  assert.equal(waits[0].signal.aborted, true);
  await tick();
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'b']);
});

test('does not start twice when the same video reopens while waiting to retry', async () => {
  const { calls, start } = recorder();
  const { waits, wait } = manualWait();
  const controller = createController(start, { retryDelays: [100], wait });
  controller.navigate('a');
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
  controller.navigate('a');
  calls[0].finish();
  await tick();
  assert.equal(waits.length, 0);

  controller.navigate('a');
  assert.equal(calls.length, 2);
});

test('once mounted, does not restart for the same video even after it ends', async () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  controller.navigate('a');
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
  controller.navigate('a');
  controller.setEnabled(false);
  calls[0].finish(new Error('aborted'));
  await tick();
  assert.deepEqual(errors, []);
  assert.equal(waits.length, 0);
});

test('restart: starts the current video again from scratch, and does nothing while off', () => {
  const { calls, start } = recorder();
  const controller = createController(start);
  controller.navigate('a');
  calls[0].mount();
  controller.restart();
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'a']);
  controller.setEnabled(false);
  controller.restart();
  assert.equal(calls.length, 2);
});
