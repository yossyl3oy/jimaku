// Messages between the content script (isolated world) and the page-side script (MAIN world).
// Player info can be read directly from the page's #movie_player.getPlayerResponse() (#shorts-player's for a Short),
// so the watch page HTML (about 2MB) need not be fetched again (TTFT drops by about 700ms).
// A CustomEvent's detail can't cross worlds as an object, so it is passed as a JSON string.
// Same approach as src/entrypoints/youtube-player-hook.content.ts in rokrokss/shizue@c2ebc51.

import { isTimedtextUrl, type CaptionTrack, type PlayerResponse } from './tracks.ts';

export const REQUEST_PLAYER_EVENT = 'jimaku:request-player';
export const PLAYER_REPLY_EVENT = 'jimaku:player-reply';

// The players that can be asked: the watch page's and the Shorts'. Both can be in the page holding the same video (one
// of them hidden, and maybe stale), so the content script names the one it shows
export const PLAYER_IDS = ['movie_player', 'shorts-player'] as const;
export type PlayerId = (typeof PLAYER_IDS)[number];
// Any page-side script can send a request, so only these elements are read
export const isPlayerId = (value: unknown): value is PlayerId => PLAYER_IDS.some((id) => id === value);

export type PlayerRequest = { id: string; videoId: string; player: PlayerId };
export type PlayerReply = { id: string; player: PlayerResponse | null };

export const parseMessage = <T>(detail: unknown): T | null => {
  if (typeof detail !== 'string') return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null;
  }
};

// Keeps only the needed fields of the player info. null if it belongs to another video (mid-navigation or an ad).
export const pickPlayerFields = (raw: unknown, videoId: string): PlayerResponse | null => {
  const response = raw as {
    videoDetails?: { videoId?: unknown; title?: unknown };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } };
  } | null;
  if (!response || response.videoDetails?.videoId !== videoId) return null;

  const rawTracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  const tracks: CaptionTrack[] = (Array.isArray(rawTracks) ? rawTracks : [])
    // Only timedtext URLs for caption tracks, so the page side can't point somewhere else
    .filter((t) => isTimedtextUrl(t?.baseUrl) && typeof t?.languageCode === 'string')
    .map((t) => ({ baseUrl: t.baseUrl, languageCode: t.languageCode, ...(typeof t.kind === 'string' ? { kind: t.kind } : {}) }));

  return {
    videoDetails: {
      videoId,
      title: typeof response.videoDetails?.title === 'string' ? response.videoDetails.title : undefined,
    },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
  };
};
