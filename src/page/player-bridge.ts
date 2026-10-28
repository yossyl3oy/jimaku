// Runs on the page side (MAIN world). When the content script asks, it returns only
// what the player holds (the title and the caption tracks).

import { PLAYER_REPLY_EVENT, REQUEST_PLAYER_EVENT, parseMessage, pickPlayerFields, type PlayerRequest } from '../core/bridge.ts';

type MoviePlayer = HTMLElement & { getPlayerResponse?: () => unknown };

window.addEventListener(REQUEST_PLAYER_EVENT, (event) => {
  const request = parseMessage<PlayerRequest>((event as CustomEvent).detail);
  if (!request) return;
  let player = null;
  try {
    const moviePlayer = document.getElementById('movie_player') as MoviePlayer | null;
    player = pickPlayerFields(moviePlayer?.getPlayerResponse?.(), request.videoId);
  } catch {
    // If the player's internals have changed, the content script falls back to reading the HTML
  }
  window.dispatchEvent(
    new CustomEvent(PLAYER_REPLY_EVENT, { detail: JSON.stringify({ id: request.id, player }) })
  );
});
