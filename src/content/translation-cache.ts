// The content script's side of the translation cache every tab shares (src/core/translation-cache.ts). The background
// keeps it, so this asks the background for the lines kept from before and tells it about new ones.

import { createUpdateTracker, type TranslationLines } from '../core/translation-cache.ts';
import { extensionAlive } from './chatgpt.ts';

export type CachedTranslations = { generation: string; translations: TranslationLines };

const empty = (count: number): CachedTranslations => ({
  generation: '',
  translations: new Array<string | undefined>(count).fill(undefined),
});

// The translations kept for these caption lines, or empty slots when there are none (or the extension was reloaded).
// The generation goes back with each save, so lines meant for other captions are refused.
export const loadTranslations = async (key: string, sources: readonly string[]): Promise<CachedTranslations> => {
  if (!extensionAlive()) return empty(sources.length);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'cacheLoad', key, sources });
    const kept: unknown = response?.ok ? response.translations : undefined;
    if (Array.isArray(kept) && kept.length === sources.length && typeof response.generation === 'string') {
      return {
        generation: response.generation,
        translations: kept.map((line) => (typeof line === 'string' && line ? line : undefined)),
      };
    }
  } catch {
    // Translate without the cache
  }
  return empty(sources.length);
};

// A function that sends the lines translated since its last call (the session fills translations in place)
export const translationSaver = (key: string, { generation, translations }: CachedTranslations) => {
  const takeUpdates = createUpdateTracker(translations);
  return () => {
    const updates = takeUpdates();
    if (!generation || !updates.length || !extensionAlive()) return;
    try {
      chrome.runtime.sendMessage({ type: 'cacheSave', key, generation, updates }).catch(() => {});
    } catch {
      // The extension was reloaded meanwhile
    }
  };
};
