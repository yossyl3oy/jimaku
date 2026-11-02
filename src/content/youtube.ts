// Fetches captions from the YouTube page (the only place that touches the DOM and fetch).
// Catching the player's timedtext request, and pressing the CC button twice to make it send one, come from
// src/lib/youtube.ts in rokrokss/shizue@c2ebc51.

import {
  PLAYER_REPLY_EVENT,
  REQUEST_PLAYER_EVENT,
  parseMessage,
  pickPlayerFields,
  type PlayerId,
  type PlayerReply,
  type PlayerRequest,
} from '../core/bridge.ts';
import { createCaptionUrls } from '../core/caption-urls.ts';
import { parseJson3, type Caption } from '../core/captions.ts';
import type { Edge } from '../core/layout.ts';
import { extractPlayerResponse, type PlayerResponse } from '../core/tracks.ts';
import type { VideoView } from '../core/video-page.ts';
import type { ButtonSlot } from './button.ts';

// Where the player and its buttons are on a watch page and on a Short. Shorts play in a player of their own
// (#movie_player stays in the page, hidden, and so does #shorts-player after a Short), with their own controls over it
// and YouTube's captions at the top
export type PlayerView = {
  // The player element's id
  player: PlayerId;
  // YouTube's CC button
  captionsButton: string;
  // jimaku's button goes just before `before`, with the class YouTube's buttons there have. In Shorts its icon also
  // gets the shadow YouTube's icons there have, since it sits over the video
  toggle: ButtonSlot;
  // The edge YouTube's captions sit at, and how far from it the translation sits with CC off (a share of the player's
  // height; on a watch page, the layout's default, where YouTube's captions sit)
  edge: Edge;
  floor?: number;
  // The control bar at that edge (its elements), which YouTube hides by giving the player hiddenClass. Shorts' controls
  // stay within the floor, so they aren't measured
  controls?: { selector: string; hiddenClass: string };
};

export const PLAYER_VIEWS: Record<VideoView, PlayerView> = {
  watch: {
    player: 'movie_player',
    captionsButton: '#movie_player .ytp-subtitles-button',
    toggle: { before: '#movie_player .ytp-subtitles-button', className: 'ytp-button', shadow: false },
    edge: 'bottom',
    // The progress bar reaches a little above the rest of the bar
    controls: { selector: '.ytp-chrome-bottom, .ytp-progress-bar-container', hiddenClass: 'ytp-autohide' },
  },
  // Measured: the controls take the top 10% of the player, and YouTube's captions start just under them
  shorts: {
    player: 'shorts-player',
    captionsButton: 'ytd-shorts-player-controls ytm-closed-captioning-button button',
    toggle: {
      before: 'ytd-shorts-player-controls #closed-captioning-button-container',
      className: 'ytmClosedCaptioningButtonButton',
      shadow: true,
    },
    edge: 'top',
    floor: 0.1,
  },
};

// The player's own timedtext requests carry the pot token and more, so remember the whole URL.
const playerCaptionUrls = createCaptionUrls();

export const watchPlayerCaptionRequests = () => {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
      // Skip our own fetches (the player uses XHR)
      if (!entry.name.includes('/api/timedtext') || entry.initiatorType === 'fetch') continue;
      playerCaptionUrls.record(entry.name);
    }
  });
  observer.observe({ type: 'resource', buffered: true });
  return () => observer.disconnect();
};

// Returns the caption URL the player fetched, if already known (the CC button was on, etc.)
export const freshCaptionUrl = (videoId: string): string | null => playerCaptionUrls.fresh(videoId);

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

// Wait until the ad (.ad-showing) ends, noticing it the moment the player's class changes
export const waitWhileAdShowing = (playerEl: HTMLElement, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (!playerEl.classList.contains('ad-showing')) return resolve();
    if (signal.aborted) return reject(signal.reason);
    const observer = new MutationObserver(() => {
      if (playerEl.classList.contains('ad-showing')) return;
      cleanup();
      resolve();
    });
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      observer.disconnect();
      signal.removeEventListener('abort', onAbort);
    };
    observer.observe(playerEl, { attributes: true, attributeFilter: ['class'] });
    signal.addEventListener('abort', onAbort, { once: true });
  });

// If there's no request yet, press the CC button (found with captionsButton) so the player sends one, and wait up to 5 seconds.
// The player opens the request inside the click handler, and pressing the button back ends it at once; the ended
// request still shows up in the resource timing with its whole URL (measured: about 10-20ms after the presses).
// So both presses go back to back and the native captions keep their on/off. If nothing shows up, try once more the
// old way, holding the captions on for 200ms. If we move to another video meanwhile (signal aborted), stop.
// Shorts' own CC button works the same way.
export const getPlayerCaptionUrl = async (
  videoId: string,
  captionsButton: string,
  signal: AbortSignal
): Promise<string | null> => {
  const known = freshCaptionUrl(videoId);
  if (known) return known;

  const button = document.querySelector<HTMLElement>(captionsButton);
  if (button) {
    // Moved to another video already: don't touch the button (it may be the new video's)
    signal.throwIfAborted();
    button.click();
    button.click();
    const url = await playerCaptionUrls.wait(videoId, 300, signal);
    if (url) return url;
    button.click();
    try {
      await sleep(200, signal);
    } finally {
      // Once pressed, always press it back, even if stopped midway, so the native captions return to their original on/off
      if (button.isConnected) button.click();
    }
  }
  return playerCaptionUrls.wait(videoId, 5000, signal);
};

// Asks the page-side script (src/page/player-bridge.ts) for the player info, once.
// null if there's no answer (not loaded yet) or it belongs to another video.
const askPage = (videoId: string, player: PlayerId, timeoutMs: number, signal: AbortSignal) =>
  new Promise<PlayerResponse | null>((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const onReply = (event: Event) => {
      const reply = parseMessage<PlayerReply>((event as CustomEvent).detail);
      if (reply?.id !== id) return;
      cleanup();
      // Any page-side script can send a reply, so check the video and caption URLs again on this side
      resolve(pickPlayerFields(reply.player, videoId));
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener(PLAYER_REPLY_EVENT, onReply);
      signal.removeEventListener('abort', onAbort);
    };
    window.addEventListener(PLAYER_REPLY_EVENT, onReply);
    signal.addEventListener('abort', onAbort, { once: true });
    const request: PlayerRequest = { id, videoId, player };
    window.dispatchEvent(new CustomEvent(REQUEST_PLAYER_EVENT, { detail: JSON.stringify(request) }));
  });

// Gets the player info. First read it straight from the page's player (the one shown, nearly instant);
// if that still fails after 2 seconds, read it from the watch page HTML (about 2MB, about 700ms).
export const fetchPlayerResponse = async (
  videoId: string,
  playerId: PlayerId,
  signal: AbortSignal
): Promise<PlayerResponse | null> => {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const player = await askPage(videoId, playerId, 100, signal);
    if (player) return player;
    await sleep(100, signal);
  }
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { signal });
  return extractPlayerResponse(await response.text());
};

export const fetchCaptions = async (url: string, signal: AbortSignal): Promise<Caption[]> => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`timedtext ${response.status}`);
  const text = await response.text();
  // Without enough of the pot token, it returns 200 with an empty body
  if (!text) throw new Error('timedtext returned an empty body');
  return parseJson3(JSON.parse(text));
};
