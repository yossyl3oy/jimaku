// Which video a YouTube page shows, from its URL: a watch page (/watch?v=ID) or a Short (/shorts/ID).
// Shorts play in a player of their own, with their own controls, so the content script also needs to know which.

export type VideoView = 'watch' | 'shorts';
export type VideoPage = { videoId: string; view: VideoView };

const SHORTS_PATH = /^\/shorts\/([\w-]+)\/?$/;

// null when the page shows no video (the home page, search results, a channel, ...)
export const videoPageOf = (url: string): VideoPage | null => {
  const { pathname, searchParams } = new URL(url);
  if (pathname === '/watch') {
    const videoId = searchParams.get('v');
    return videoId ? { videoId, view: 'watch' } : null;
  }
  const short = pathname.match(SHORTS_PATH);
  return short ? { videoId: short[1], view: 'shorts' } : null;
};
