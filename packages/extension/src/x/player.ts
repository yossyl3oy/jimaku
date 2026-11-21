// What X's page looks like to jimaku: its video players, their CC buttons and control bars, the posts they are in, and
// the caption tracks on their <video> elements. The only place in src/x/ that knows X's markup (measured on x.com on
// 2026-11-20); the decisions on what it reads are in the core package's x-video.ts.

import type { Cue, XTextTrack } from '@jimaku/core/x-video.ts';

// A player (in the timeline, a post, the media viewer). Its control bar (the scrubber and a row of buttons with the CC
// button in it) is in the page only while it shows: X builds it when the pointer comes and takes it away a few seconds
// after it stops. X's CC button is there only when the video has caption tracks
const PLAYER = '[data-testid="videoPlayer"]';
const CAPTIONS_BUTTON = '[data-testid="captions"]';
const SCRUBBER = '[data-testid="scrubber"]';
const POST = 'article';
const POST_TEXT = '[data-testid="tweetText"]';

export type CaptionsSlot = { player: HTMLElement; captionsButton: HTMLElement };

// Every player whose CC button shows now. Each button sits in a wrapper of its own in the row
export const captionSlots = (): CaptionsSlot[] =>
  [...document.querySelectorAll<HTMLElement>(CAPTIONS_BUTTON)].flatMap((captionsButton) => {
    const player = captionsButton.closest<HTMLElement>(PLAYER);
    return player && captionsButton.parentElement?.parentElement ? [{ player, captionsButton }] : [];
  });

export const videoOf = (player: HTMLElement) => player.querySelector('video');

// The control bar while it shows (the scrubber's top to the player's bottom), null while it is hidden
export const readControls = (player: HTMLElement) => {
  const scrubber = player.querySelector(SCRUBBER)?.getBoundingClientRect();
  if (!scrubber || scrubber.height === 0) return null;
  return { top: scrubber.top, bottom: player.getBoundingClientRect().bottom };
};

// The post the player is in: its text, and the link to it (the one around its time stamp). Neither is there in the
// media viewer
export const postOf = (player: HTMLElement) => {
  const post = player.closest(POST);
  return {
    text: post?.querySelector(POST_TEXT)?.textContent ?? null,
    link: post?.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') ?? null,
  };
};

export const textTracksOf = (video: HTMLVideoElement): TextTrack[] => [...video.textTracks];

export const trackInfo = (track: TextTrack): XTextTrack => ({
  kind: track.kind,
  label: track.label,
  language: track.language,
  mode: track.mode,
});

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

// The cues of a track, all of them (X's player loads each track's WebVTT file whole). A disabled track has none, so it
// is set to hidden for X's player to load it: that draws nothing, and X doesn't take it for its CC button being on.
// Afterwards it goes back to disabled, unless X has started showing its captions meanwhile (from that track or
// another one). Only a track jimaku set to hidden is ever touched. The cues are read once their count holds for a moment.
export const loadCues = async (video: HTMLVideoElement, track: TextTrack, signal: AbortSignal, timeoutMs = 5000): Promise<Cue[]> => {
  const changed = track.mode === 'disabled';
  if (changed) track.mode = 'hidden';
  try {
    const deadline = performance.now() + timeoutMs;
    let count = -1;
    while (performance.now() < deadline) {
      const cues = track.cues;
      if (cues && cues.length > 0 && cues.length === count) {
        return [...cues].map((cue) => ({ startTime: cue.startTime, endTime: cue.endTime, text: (cue as VTTCue).text ?? '' }));
      }
      count = cues?.length ?? -1;
      await sleep(50, signal);
    }
    throw new Error('the captions did not load');
  } finally {
    const showing = textTracksOf(video).some((t) => t.mode === 'showing');
    if (changed && track.mode === 'hidden' && !showing) track.mode = 'disabled';
  }
};

// X's own captions are drawn by the browser from a track, where they can't be measured or moved. While jimaku shows a
// video's translation, the overlay shows the source line itself and X's are hidden (only on that video)
const HIDE_ATTRIBUTE = 'data-jimaku-hides-captions';
const HIDE_STYLE_ID = 'jimaku-x-captions';
const HIDE_STYLE = `video[${HIDE_ATTRIBUTE}]::cue { visibility: hidden; color: transparent; background: transparent; text-shadow: none; }`;

export const hideXCaptions = (video: HTMLVideoElement) => {
  if (!document.getElementById(HIDE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = HIDE_STYLE_ID;
    style.textContent = HIDE_STYLE;
    document.head.append(style);
  }
  video.setAttribute(HIDE_ATTRIBUTE, '');
  return () => video.removeAttribute(HIDE_ATTRIBUTE);
};
