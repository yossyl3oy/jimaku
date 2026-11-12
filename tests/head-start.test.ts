import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHeadStart, type PrepareFn } from '../src/core/head-start.ts';

// Records how prepare is called. finish(value) ends that call; fail(error) makes it throw.
const recorder = () => {
  const calls: {
    videoId: string;
    signal: AbortSignal;
    early: boolean;
    finish: (value: string) => void;
    fail: (error: Error) => void;
  }[] = [];
  const prepare: PrepareFn<string> = (videoId, signal, early) =>
    new Promise((resolve, reject) => {
      calls.push({ videoId, signal, early, finish: resolve, fail: reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  return { calls, prepare };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));
const run = () => new AbortController();

test('take: without a head start, prepares in full with the given signal', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  const { signal } = run();
  const taken = headStart.take('a', signal);
  assert.deepEqual(calls.map((c) => [c.videoId, c.early]), [['a', false]]);
  assert.equal(calls[0].signal, signal);
  calls[0].finish('captions of a');
  assert.equal(await taken, 'captions of a');
});

test('begin: prepares early, and take hands over what it prepared without preparing again', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  assert.deepEqual(calls.map((c) => [c.videoId, c.early]), [['a', true]]);
  calls[0].finish('captions of a');
  await tick();
  assert.equal(await headStart.take('a', run().signal), 'captions of a');
  assert.equal(calls.length, 1);
});

test('take: waits for a head start still under way', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const taken = headStart.take('a', run().signal);
  calls[0].finish('captions of a');
  assert.equal(await taken, 'captions of a');
  assert.equal(calls.length, 1);
});

test('begin: again for the same video does not prepare twice', () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  headStart.begin('a');
  assert.equal(calls.length, 1);
});

test('begin: another video stops the head start of the one before', () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  headStart.begin('b');
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls.map((c) => c.videoId), ['a', 'b']);
  assert.equal(calls[1].signal.aborted, false);
});

test('take: a head start is taken only once (turning jimaku on again prepares anew)', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  calls[0].finish('first');
  assert.equal(await headStart.take('a', run().signal), 'first');
  const again = headStart.take('a', run().signal);
  assert.deepEqual(calls.map((c) => c.early), [true, false]);
  calls[1].finish('second');
  assert.equal(await again, 'second');
});

test('take: the head start of another video is stopped and not used', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const taken = headStart.take('b', run().signal);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls.map((c) => [c.videoId, c.early]), [
    ['a', true],
    ['b', false],
  ]);
  calls[1].finish('captions of b');
  assert.equal(await taken, 'captions of b');
});

test('drop: stops and forgets the head start, so take prepares in full', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  calls[0].finish('prepared for another language');
  await tick();
  headStart.drop();
  assert.equal(calls[0].signal.aborted, true);
  const taken = headStart.take('a', run().signal);
  assert.deepEqual(calls.map((c) => c.early), [true, false]);
  calls[1].finish('captions of a');
  assert.equal(await taken, 'captions of a');
});

test('take: a head start that already failed is not handed over; it prepares in full', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  calls[0].fail(new Error('an ad is showing'));
  await tick();
  const taken = headStart.take('a', run().signal);
  assert.deepEqual(calls.map((c) => c.early), [true, false]);
  calls[1].finish('captions of a');
  assert.equal(await taken, 'captions of a');
});

test('take: a head start that fails after it was taken is followed by a full one', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const { signal } = run();
  const taken = headStart.take('a', signal);
  calls[0].fail(new Error('no caption URL yet'));
  await tick();
  assert.deepEqual(calls.map((c) => c.early), [true, false]);
  assert.equal(calls[1].signal, signal);
  calls[1].finish('captions of a');
  assert.equal(await taken, 'captions of a');
});

test('take: the full one failing is what the caller gets (so it can retry as before)', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const taken = headStart.take('a', run().signal);
  calls[0].fail(new Error('no caption URL yet'));
  await tick();
  calls[1].fail(new Error('timedtext 500'));
  await assert.rejects(taken, /timedtext 500/);
});

test('begin: after a failed head start, tries again', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  calls[0].fail(new Error('player not found'));
  await tick();
  headStart.begin('a');
  assert.deepEqual(calls.map((c) => c.early), [true, true]);
});

test('take: once taken, the head start stops with the run (turning jimaku off, another video)', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const controller = run();
  const taken = headStart.take('a', controller.signal);
  const reason = new Error('turned off');
  controller.abort(reason);
  assert.equal(calls[0].signal.aborted, true);
  await assert.rejects(taken, (error) => error === reason);
  // Nothing is prepared again for a run that stopped
  assert.equal(calls.length, 1);
});

test('take: drop after the head start was taken leaves the run alone', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const taken = headStart.take('a', run().signal);
  headStart.drop();
  assert.equal(calls[0].signal.aborted, false);
  calls[0].finish('captions of a');
  assert.equal(await taken, 'captions of a');
});

test('take: with a run already stopped, the head start stops too', async () => {
  const { calls, prepare } = recorder();
  const headStart = createHeadStart(prepare);
  headStart.begin('a');
  const controller = run();
  controller.abort(new Error('stopped'));
  await assert.rejects(headStart.take('a', controller.signal), /stopped/);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 1);
});

test('begin: a prepare that throws at once counts as a failed head start', async () => {
  let calls = 0;
  const headStart = createHeadStart<string>((_videoId, _signal, early) => {
    calls++;
    if (early) throw new Error('player not found');
    return Promise.resolve('captions of a');
  });
  headStart.begin('a');
  await tick();
  assert.equal(await headStart.take('a', run().signal), 'captions of a');
  assert.equal(calls, 2);
});
