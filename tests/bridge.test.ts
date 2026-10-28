import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMessage, pickPlayerFields } from '../src/core/bridge.ts';

const player = JSON.parse(readFileSync(new URL('./fixtures/player-response.json', import.meta.url), 'utf8'));

test('pickPlayerFields: keeps only the title and caption tracks when the video matches', () => {
  const picked = pickPlayerFields(player, 'abc123');
  assert.equal(picked?.videoDetails?.title, 'How Transformers Work');
  assert.deepEqual(
    picked?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map((t) => [t.languageCode, t.kind]),
    [
      ['ja', 'asr'],
      ['en', 'asr'],
      ['en-GB', undefined],
    ]
  );
});

test('pickPlayerFields: null for player info of another video (mid-navigation or an ad)', () => {
  assert.equal(pickPlayerFields(player, 'other'), null);
  assert.equal(pickPlayerFields(null, 'abc123'), null);
  assert.equal(pickPlayerFields({}, 'abc123'), null);
});

test('pickPlayerFields: drops tracks that point anywhere but timedtext', () => {
  const tampered = {
    videoDetails: { videoId: 'abc123' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: 'https://evil.example/api/timedtext?lang=en', languageCode: 'en' },
          { baseUrl: 'https://www.youtube.com/other?lang=en', languageCode: 'en' },
          { baseUrl: 'not a url', languageCode: 'en' },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123&lang=en', languageCode: 'en' },
        ],
      },
    },
  };
  const tracks = pickPlayerFields(tampered, 'abc123')?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  assert.equal(tracks?.length, 1);
});

test('pickPlayerFields: returns an empty track list for a video without captions', () => {
  const picked = pickPlayerFields({ videoDetails: { videoId: 'abc123' } }, 'abc123');
  assert.deepEqual(picked?.captions?.playerCaptionsTracklistRenderer?.captionTracks, []);
});

test('parseMessage: reads only JSON strings', () => {
  assert.deepEqual(parseMessage('{"id":"1"}'), { id: '1' });
  assert.equal(parseMessage('{oops'), null);
  assert.equal(parseMessage({ id: '1' }), null);
});

test('pickPlayerFields: picking the result again gives the same result (the content script re-check)', () => {
  const picked = pickPlayerFields(player, 'abc123');
  assert.equal(picked?.videoDetails?.videoId, 'abc123');
  assert.deepEqual(pickPlayerFields(picked, 'abc123'), picked);
});
