// Pure functions that pick the caption track to translate from the video page info and build the URL to fetch it.
// The player-info regex, the track choice and the URL building come from
// src/lib/youtube.ts in rokrokss/shizue@c2ebc51.

import { sameLanguage } from './languages.ts';

export type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  // 'asr' is YouTube's auto-generated captions
  kind?: string;
};

export type PlayerResponse = {
  videoDetails?: { videoId?: string; title?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
};

const PLAYER_RESPONSE_RE =
  /ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+(?:meta|head)|<\/script|\n)/;

export const extractPlayerResponse = (html: string): PlayerResponse | null => {
  const match = html.match(PLAYER_RESPONSE_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

const isEnglish = (track: CaptionTrack) => sameLanguage(track.languageCode, 'en');

// The track to translate into target. Tracks already in target are skipped. The auto-generated track is in the spoken
// language, so prefer, in order: human-written captions in the spoken language, human-written English, the
// auto-generated track, any other human-written captions. null if every track is already in target (or there are none).
export const pickSourceTrack = (player: PlayerResponse, target: string): CaptionTrack | null => {
  const tracks = (player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).filter(
    (track) => !sameLanguage(track.languageCode, target)
  );
  const generated = tracks.filter((track) => track.kind === 'asr');
  const human = tracks.filter((track) => track.kind !== 'asr');
  const spoken = (track: CaptionTrack) => generated.some((asr) => sameLanguage(asr.languageCode, track.languageCode));
  return human.find(spoken) ?? human.find(isEnglish) ?? generated[0] ?? human[0] ?? null;
};

// timedtext URLs are signed and stop working after expire (UNIX seconds). Drop them a little before they expire.
export const isCaptionUrlFresh = (url: string, nowMs: number, marginSec = 60): boolean => {
  const expire = Number(new URL(url).searchParams.get('expire'));
  if (!expire) return true;
  return nowMs / 1000 < expire - marginSec;
};

// timedtext needs per-session parameters such as the pot token, so start from the player's own request
// (playerCaptionUrl) and swap in only the track parameters.
const TRACK_PARAMS = ['lang', 'kind', 'variant', 'name', 'tlang'];

export const buildCaptionUrl = (trackBaseUrl: string, playerCaptionUrl: string | null): string => {
  if (!playerCaptionUrl) {
    const url = new URL(trackBaseUrl);
    url.searchParams.set('c', 'WEB');
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('cplatform', 'DESKTOP');
    return url.toString();
  }

  const url = new URL(playerCaptionUrl);
  const trackParams = new URL(trackBaseUrl).searchParams;
  for (const key of TRACK_PARAMS) {
    const value = trackParams.get(key);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  url.searchParams.set('fmt', 'json3');
  return url.toString();
};
