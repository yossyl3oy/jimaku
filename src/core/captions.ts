// Pure functions for YouTube captions (timedtext in json3 format).
// How json3 is read and how endTime is trimmed come from src/lib/captionInjector.tsx in rokrokss/shizue@c2ebc51.

export type Caption = {
  startTime: number;
  endTime: number;
  text: string;
};

type Json3Seg = { utf8?: string };
type Json3Event = { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] };
export type Json3 = { events?: Json3Event[] };

export const parseJson3 = (data: Json3): Caption[] => {
  const captions = (data.events ?? [])
    .filter((event) => event.segs && event.tStartMs !== undefined)
    .map((event) => ({
      startTime: event.tStartMs! / 1000,
      endTime: (event.tStartMs! + (event.dDurationMs ?? 0)) / 1000,
      text: event
        .segs!.map((seg) => seg.utf8 ?? '')
        .join('')
        .replace(/\s*\n\s*/g, ' ')
        .trim(),
    }))
    .filter((caption) => caption.text.length > 0);

  // Auto-generated captions overlap the next line in time, so a line disappears once the next one appears.
  return captions.map((caption, i) => {
    const next = captions[i + 1];
    return next ? { ...caption, endTime: Math.min(caption.endTime, next.startTime) } : caption;
  });
};

// Index of the caption shown at time, or null if none. Assumes captions are sorted by startTime.
export const findCaptionIndex = (captions: Caption[], time: number): number | null => {
  let lo = 0;
  let hi = captions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const caption = captions[mid];
    if (time < caption.startTime) hi = mid - 1;
    else if (time >= caption.endTime) lo = mid + 1;
    else return mid;
  }
  return null;
};

// Index of the last caption that started at or before time. Used to prioritize translating the seek target.
export const findCaptionIndexAtOrBefore = (captions: Caption[], time: number): number => {
  let lo = 0;
  let hi = captions.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (captions[mid].startTime <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};
