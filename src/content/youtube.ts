// Fetches captions from the YouTube page (the only place that touches the DOM and fetch).
// Catching the player's timedtext request, and pressing the CC button twice to make it send one, come from
// src/lib/youtube.ts in rokrokss/shizue@c2ebc51.

import { PLAYER_REPLY_EVENT, REQUEST_PLAYER_EVENT, parseMessage, pickPlayerFields, type PlayerReply } from '../core/bridge.ts';
import { createCaptionUrls } from '../core/caption-urls.ts';
import { parseJson3, type Caption } from '../core/captions.ts';
import { extractPlayerResponse, type PlayerResponse } from '../core/tracks.ts';

export const getVideoId = (): string | null =>
  location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;

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

// If there's no request yet, press the CC button so the player sends one, and wait up to 5 seconds.
// The player opens the request inside the click handler, and pressing the button back ends it at once; the ended
// request still shows up in the resource timing with its whole URL (measured: about 10-20ms after the presses).
// So both presses go back to back and the native captions keep their on/off. If nothing shows up, try once more the
// old way, holding the captions on for 200ms. If we move to another video meanwhile (signal aborted), stop.
export const getPlayerCaptionUrl = async (videoId: string, signal: AbortSignal): Promise<string | null> => {
  const known = freshCaptionUrl(videoId);
  if (known) return known;

  const button = document.querySelector<HTMLElement>('.ytp-subtitles-button');
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
const askPage = (videoId: string, timeoutMs: number, signal: AbortSignal) =>
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
    window.dispatchEvent(new CustomEvent(REQUEST_PLAYER_EVENT, { detail: JSON.stringify({ id, videoId }) }));
  });

// Gets the player info. First read it straight from the page's player (nearly instant);
// if that still fails after 2 seconds, read it from the watch page HTML (about 2MB, about 700ms).
export const fetchPlayerResponse = async (
  videoId: string,
  signal: AbortSignal
): Promise<PlayerResponse | null> => {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const player = await askPage(videoId, 100, signal);
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
