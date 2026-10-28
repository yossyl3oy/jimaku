// The caption (timedtext) URLs the player requested, by video. They carry per-session parameters such as the pot token,
// which our own caption request needs. Whoever waits for a video's URL gets it as soon as the player's request is seen.

import { isCaptionUrlFresh } from './tracks.ts';

export const createCaptionUrls = (now: () => number = Date.now) => {
  const urls = new Map<string, string>();
  const waiters = new Map<string, Set<(url: string) => void>>();

  const fresh = (videoId: string): string | null => {
    const url = urls.get(videoId);
    if (!url) return null;
    if (isCaptionUrlFresh(url, now())) return url;
    urls.delete(videoId);
    return null;
  };

  return {
    // A timedtext URL the player requested (one without a video, or one about to expire, is ignored)
    record(url: string) {
      const videoId = new URL(url).searchParams.get('v');
      if (!videoId || !isCaptionUrlFresh(url, now())) return;
      urls.set(videoId, url);
      const waiting = waiters.get(videoId);
      waiters.delete(videoId);
      waiting?.forEach((resolve) => resolve(url));
    },
    // The video's URL if one is known and not about to expire
    fresh,
    // The video's URL as soon as there is one (at once if a fresh one is known), or null after timeoutMs
    wait(videoId: string, timeoutMs: number, signal: AbortSignal): Promise<string | null> {
      const known = fresh(videoId);
      if (known) return Promise.resolve(known);
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const waiting = waiters.get(videoId) ?? new Set();
        waiters.set(videoId, waiting);
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          waiting.delete(onUrl);
          if (waiting.size === 0 && waiters.get(videoId) === waiting) waiters.delete(videoId);
        };
        const onUrl = (url: string) => {
          cleanup();
          resolve(url);
        };
        const onAbort = () => {
          cleanup();
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutMs);
        waiting.add(onUrl);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
};
