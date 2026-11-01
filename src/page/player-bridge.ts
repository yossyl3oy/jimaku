// Runs on the page side (MAIN world). When the content script asks, it returns only
// what the player holds (the title and the caption tracks).

import {
  PLAYER_REPLY_EVENT,
  REQUEST_PLAYER_EVENT,
  isPlayerId,
  parseMessage,
  pickPlayerFields,
  type PlayerRequest,
} from '../core/bridge.ts';

type MoviePlayer = HTMLElement & { getPlayerResponse?: () => unknown };

// The request names the player to read: the watch page's (#movie_player) or the Shorts' (#shorts-player)
window.addEventListener(REQUEST_PLAYER_EVENT, (event) => {
  const request = parseMessage<PlayerRequest>((event as CustomEvent).detail);
  if (!request || !isPlayerId(request.player)) return;
  let player = null;
  try {
    const moviePlayer = document.getElementById(request.player) as MoviePlayer | null;
    player = pickPlayerFields(moviePlayer?.getPlayerResponse?.(), request.videoId);
  } catch {
    // If the player's internals have changed, the content script falls back to reading the HTML
  }
  window.dispatchEvent(
    new CustomEvent(PLAYER_REPLY_EVENT, { detail: JSON.stringify({ id: request.id, player }) })
  );
});
