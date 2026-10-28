import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildCaptionUrl, extractPlayerResponse, isCaptionUrlFresh, pickSourceTrack } from '../src/core/tracks.ts';

const player = JSON.parse(readFileSync(new URL('./fixtures/player-response.json', import.meta.url), 'utf8'));

test('extractPlayerResponse: extracts the player info from the watch page HTML', () => {
  const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = document.createElement('meta');</script></html>`;
  assert.equal(extractPlayerResponse(html)?.videoDetails?.title, 'How Transformers Work');
  assert.equal(extractPlayerResponse('<html></html>'), null);
});

const playerWith = (...captionTracks: { languageCode: string; kind?: string }[]) => ({
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: captionTracks.map((t) => ({ baseUrl: `https://www.youtube.com/api/timedtext?lang=${t.languageCode}`, ...t })),
    },
  },
});
const pick = (target: string, ...tracks: { languageCode: string; kind?: string }[]) => {
  const track = pickSourceTrack(playerWith(...tracks), target);
  return track && `${track.languageCode}${track.kind === 'asr' ? ' asr' : ''}`;
};

test('pickSourceTrack: into Japanese, prefers human-written English captions over auto-generated ones', () => {
  assert.equal(pickSourceTrack(player, 'ja')?.languageCode, 'en-GB');
});

test('pickSourceTrack: uses auto-generated English when that is all there is besides the target', () => {
  const tracks = player.captions.playerCaptionsTracklistRenderer.captionTracks.filter(
    (t: { languageCode: string }) => t.languageCode !== 'en-GB'
  );
  const track = pickSourceTrack({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }, 'ja');
  assert.equal(track?.languageCode, 'en');
  assert.equal(track?.kind, 'asr');
});

test('pickSourceTrack: into English, skips every English track', () => {
  assert.equal(pickSourceTrack(player, 'en')?.languageCode, 'ja');
  assert.equal(pick('en', { languageCode: 'en-GB' }, { languageCode: 'en', kind: 'asr' }), null);
});

test('pickSourceTrack: human-written captions in the spoken language come first', () => {
  assert.equal(pick('ja', { languageCode: 'en' }, { languageCode: 'ko' }, { languageCode: 'ko', kind: 'asr' }), 'ko');
});

test('pickSourceTrack: the auto-generated track beats human-written captions in a third language', () => {
  // An English talk with fan-made Spanish captions: translate the English, not the Spanish translation
  assert.equal(pick('ja', { languageCode: 'es' }, { languageCode: 'en', kind: 'asr' }), 'en asr');
  // Without any auto-generated track, any human-written captions will do
  assert.equal(pick('ja', { languageCode: 'es' }), 'es');
});

test('pickSourceTrack: compares language and script, not the whole code', () => {
  assert.equal(pick('zh-Hans', { languageCode: 'zh-Hant' }), 'zh-Hant');
  assert.equal(pick('zh-Hant', { languageCode: 'zh-TW' }), null);
  assert.equal(pick('ja', { languageCode: 'ja-JP' }), null);
});

test('pickSourceTrack: null without captions', () => {
  assert.equal(pickSourceTrack({}, 'ja'), null);
});

test("buildCaptionUrl: swaps only the track parameters when the player's request is known", () => {
  const playerUrl = 'https://www.youtube.com/api/timedtext?v=abc123&lang=ja&kind=asr&pot=TOKEN&fmt=srv3';
  const url = new URL(
    buildCaptionUrl('https://www.youtube.com/api/timedtext?v=abc123&lang=en-GB&name=English', playerUrl)
  );
  assert.equal(url.searchParams.get('pot'), 'TOKEN');
  assert.equal(url.searchParams.get('lang'), 'en-GB');
  assert.equal(url.searchParams.get('name'), 'English');
  assert.equal(url.searchParams.has('kind'), false);
  assert.equal(url.searchParams.get('fmt'), 'json3');
});

test("buildCaptionUrl: adds json3 to the track URL when the player's request is unknown", () => {
  const url = new URL(buildCaptionUrl('https://www.youtube.com/api/timedtext?v=abc123&lang=en', null));
  assert.equal(url.searchParams.get('fmt'), 'json3');
  assert.equal(url.searchParams.get('c'), 'WEB');
});

test('isCaptionUrlFresh: treats the URL as expired a little before expire', () => {
  const url = 'https://www.youtube.com/api/timedtext?v=abc123&expire=1000';
  assert.equal(isCaptionUrlFresh(url, 939_000), true);
  assert.equal(isCaptionUrlFresh(url, 940_000), false);
  assert.equal(isCaptionUrlFresh(url, 2_000_000), false);
  assert.equal(isCaptionUrlFresh('https://www.youtube.com/api/timedtext?v=abc123', 2_000_000), true);
});
