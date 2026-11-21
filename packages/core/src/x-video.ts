// What jimaku needs from X's video player, as pure functions: which of a video's caption tracks to translate, the
// captions in its cues, the post text that stands in for a title, and the id its translations are cached under. The
// extension's src/x/ reads these from the page.
//
// X lists a video's caption tracks on its <video> element as text tracks (kind "subtitles"), and its player loads a
// track's whole WebVTT file once the track is no longer disabled, without drawing it while it is hidden (measured
// 2026-11-20: one file even for an 86-minute video, its 3124 cues there within about 100ms). While X's CC button is on,
// X copies the cues it shows into a track of its own (kind "captions", label "clone", no language) and shows that one.

import { trimOverlaps, type Caption } from './captions.ts';
import { sameLanguage } from './languages.ts';
import type { CaptionTrack } from './tracks.ts';

// What jimaku reads of a TextTrack
export type XTextTrack = { kind: string; label: string; language: string; mode: string };

// X names its auto-generated tracks "en (auto-generated)" and so on (whatever the page's language). A creator's own
// track gets the name of its file, or a language name
const AUTO_GENERATED = /\(auto-generated\)/i;

// A track's language as a BCP 47 code ("EN" becomes "en"). null when it has none, or none that reads as one
export const languageOf = (language: string): string | null => {
  const code = language.trim();
  if (!code) return null;
  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
};

// index is the track's place in the list given. track is what the translation cache and the prompt need of it, as for a
// YouTube track ('asr' for auto-generated)
export type PickedTrack = { index: number; track: Pick<CaptionTrack, 'languageCode' | 'kind'> };

// The track to translate into target: one of X's own (kind "subtitles", so never X's copy), with a language, and not
// already in target. The one X has loaded comes first, since that is the one X shows with CC on, then the creator's own
// before an auto-generated one. null when no track is left.
export const pickXTrack = (tracks: readonly XTextTrack[], target: string): PickedTrack | null => {
  const candidates = tracks.flatMap((track, index) => {
    const languageCode = track.kind === 'subtitles' ? languageOf(track.language) : null;
    if (!languageCode || sameLanguage(languageCode, target)) return [];
    return [{ index, languageCode, auto: AUTO_GENERATED.test(track.label), loaded: track.mode !== 'disabled' }];
  });
  const rank = ({ loaded, auto }: (typeof candidates)[number]) => (loaded ? 0 : 2) + (auto ? 1 : 0);
  const [best] = candidates.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  if (!best) return null;
  return { index: best.index, track: { languageCode: best.languageCode, ...(best.auto ? { kind: 'asr' } : {}) } };
};

// Whether X shows its captions now (its CC button is on): it shows them through a track in "showing" mode
export const xCaptionsShown = (tracks: readonly XTextTrack[]): boolean => tracks.some((track) => track.mode === 'showing');

export type Cue = { startTime: number; endTime: number; text: string };

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

const decodeEntity = (match: string, name: string): string => {
  const numeric = name.match(/^#(x[0-9a-f]+|\d+)$/i);
  if (!numeric) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
  const code = numeric[1][0].toLowerCase() === 'x' ? parseInt(numeric[1].slice(1), 16) : parseInt(numeric[1], 10);
  try {
    return String.fromCodePoint(code);
  } catch {
    return match;
  }
};

// A cue's text as it shows: without WebVTT's markup (<b>, <i>, <c.yellow>, <v Speaker>, timestamps, and the word
// timings X puts around auto-generated lines, <X-word-ms ms=... index=... character_ranges=...>), with its entities
// read, and with its lines joined into one
export const cueText = (text: string): string =>
  text
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();

// The captions in a track's cues, in order, one at a time (as for YouTube's). Cues that start after the video ends are
// dropped: some creators' files are timed from 01:00:00, and X shows nothing for those either (seen on an 87-second
// video whose cues start at 3601s), so a video with only such cues has nothing to translate. duration is the video's;
// while it is unknown (NaN), nothing is dropped for it.
export const captionsFromCues = (cues: readonly Cue[], duration: number): Caption[] =>
  trimOverlaps(
    cues
      .map((cue) => ({ startTime: cue.startTime, endTime: cue.endTime, text: cueText(cue.text) }))
      .filter((caption) => caption.text && caption.endTime > caption.startTime)
      .filter((caption) => !Number.isFinite(duration) || caption.startTime < duration)
      .sort((a, b) => a.startTime - b.startTime)
  );

// The media id in a video's poster (https://pbs.twimg.com/amplify_video_thumb/<id>/..., ext_tw_video_thumb/<id>/...,
// tweet_video_thumb/<id>...). A poster the creator chose (pbs.twimg.com/media/...) has none
const MEDIA_ID = /^https:\/\/pbs\.twimg\.com\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/(\d+)/;
// A post's id in a link to it (/<user>/status/<id>)
const POST_ID = /\/status\/(\d+)/;

// The id a video's translations are cached under: its media id, or else its post's. One post can hold several videos,
// but the cache starts an entry over when its lines differ, so their translations never mix. null when neither is known
export const xVideoId = (poster: string, postLink: string | null): string | null => {
  const media = poster.match(MEDIA_ID);
  if (media) return `x:${media[1]}`;
  const post = postLink?.match(POST_ID);
  return post ? `x:post:${post[1]}` : null;
};

// The post's text as the title the prompt gets: on one line, and cut to max characters
export const postTitle = (text: string | null | undefined, max = 200): string | undefined => {
  const line = text?.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  const characters = [...line];
  return characters.length > max ? `${characters.slice(0, max).join('')}…` : line;
};
