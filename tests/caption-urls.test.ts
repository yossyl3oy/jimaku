import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaptionUrls } from '../src/core/caption-urls.ts';

const url = (videoId: string, expire = 1000) => `https://www.youtube.com/api/timedtext?v=${videoId}&pot=x&expire=${expire}`;
const never = new AbortController().signal;

test('fresh: the URL the player requested for the video, until it is about to expire', () => {
  let now = 0;
  const urls = createCaptionUrls(() => now);
  urls.record(url('a'));
  assert.equal(urls.fresh('a'), url('a'));
  assert.equal(urls.fresh('b'), null);
  now = 2_000_000;
  assert.equal(urls.fresh('a'), null);
});

test('wait: answers at once with a fresh URL already seen', async () => {
  const urls = createCaptionUrls(() => 0);
  urls.record(url('a'));
  assert.equal(await urls.wait('a', 1000, never), url('a'));
});

test('wait: answers as soon as the player requests one for that video, not for another', async () => {
  const urls = createCaptionUrls(() => 0);
  const started = Date.now();
  const waiting = urls.wait('a', 1000, never);
  urls.record(url('b'));
  urls.record('https://www.youtube.com/api/timedtext?lang=en');
  setTimeout(() => urls.record(url('a')), 10);
  assert.equal(await waiting, url('a'));
  assert.ok(Date.now() - started < 500);
});

test('wait: null when nothing comes in time', async () => {
  const urls = createCaptionUrls(() => 0);
  assert.equal(await urls.wait('a', 20, never), null);
  // A URL that comes later is still kept for the next one
  urls.record(url('a'));
  assert.equal(await urls.wait('a', 20, never), url('a'));
});

test('wait: rejects when stopped (moved to another video)', async () => {
  const urls = createCaptionUrls(() => 0);
  const controller = new AbortController();
  const waiting = urls.wait('a', 1000, controller.signal);
  controller.abort(new Error('navigated'));
  await assert.rejects(waiting, /navigated/);
  await assert.rejects(urls.wait('a', 1000, controller.signal), /navigated/);
});

test('record: a URL about to expire is neither kept nor handed to whoever waits', async () => {
  const urls = createCaptionUrls(() => 950_000);
  const waiting = urls.wait('a', 30, never);
  urls.record(url('a', 1000));
  assert.equal(await waiting, null);
  assert.equal(urls.fresh('a'), null);
  urls.record(url('a', 5000));
  assert.equal(urls.fresh('a'), url('a', 5000));
});
