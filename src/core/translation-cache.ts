// Keeps the translations made in this tab, so turning jimaku off and on, or coming back to a video, reuses them instead
// of spending the ChatGPT plan's usage again. It lives only in the content script's memory: nothing is written to disk,
// and it is gone when the tab is closed or reloaded.

import type { CaptionTrack } from './tracks.ts';

export type TranslationLines = (string | undefined)[];

// One entry per video, caption track and target language
export const translationKey = (videoId: string, track: Pick<CaptionTrack, 'languageCode' | 'kind'>, target: string) =>
  [videoId, track.languageCode, track.kind ?? '', target].join('\n');

// limit: how many entries to keep; the one used longest ago goes first
export const createTranslationCache = (limit = 20) => {
  const entries = new Map<string, { sources: readonly string[]; translations: TranslationLines }>();

  return {
    // The translations of these caption lines, which the caller fills in place: the array kept from before when the
    // lines are the same, otherwise a new empty one (kept from now on). Comparing the lines keeps two tracks that share
    // a key, or captions that changed, from mixing.
    linesFor(key: string, sources: readonly string[]): TranslationLines {
      const kept = entries.get(key);
      entries.delete(key);
      const sameLines = kept?.sources.length === sources.length && kept.sources.every((line, i) => line === sources[i]);
      const translations = sameLines ? kept!.translations : new Array<string | undefined>(sources.length).fill(undefined);
      entries.set(key, { sources: [...sources], translations });
      for (const oldest of entries.keys()) {
        if (entries.size <= limit) break;
        entries.delete(oldest);
      }
      return translations;
    },
    size: () => entries.size,
  };
};
