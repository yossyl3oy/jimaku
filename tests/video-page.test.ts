import assert from 'node:assert/strict';
import { test } from 'node:test';
import { videoPageOf } from '../src/core/video-page.ts';

test('videoPageOf: a watch page, with or without other parameters', () => {
  assert.deepEqual(videoPageOf('https://www.youtube.com/watch?v=abc123'), { videoId: 'abc123', view: 'watch' });
  assert.deepEqual(videoPageOf('https://www.youtube.com/watch?list=PL1&v=x2LTvDuJrXM&t=42s'), {
    videoId: 'x2LTvDuJrXM',
    view: 'watch',
  });
});

test('videoPageOf: a Short', () => {
  assert.deepEqual(videoPageOf('https://www.youtube.com/shorts/x2LTvDuJrXM'), { videoId: 'x2LTvDuJrXM', view: 'shorts' });
  assert.deepEqual(videoPageOf('https://www.youtube.com/shorts/7r5J84Jn-_Q/?feature=share'), {
    videoId: '7r5J84Jn-_Q',
    view: 'shorts',
  });
});

test('videoPageOf: no video on other pages', () => {
  for (const url of [
    'https://www.youtube.com/',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/shorts',
    'https://www.youtube.com/shorts/',
    'https://www.youtube.com/results?search_query=shorts',
    'https://www.youtube.com/@channel/shorts',
  ]) {
    assert.equal(videoPageOf(url), null, url);
  }
});
