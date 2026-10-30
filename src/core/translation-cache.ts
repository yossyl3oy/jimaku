// Keeps the translations made in any tab, so turning jimaku on again, coming back to a video or opening it in another
// tab reuses them instead of spending the ChatGPT plan's usage again. The background keeps them in
// chrome.storage.session: in memory only, never written to disk, and gone when the browser closes, so no record of
// the videos watched is left. The content scripts can't read that storage (it holds the sign-in tokens too), so they
// ask the background. Without chrome.*: the storage comes in from outside, so this is testable.

import type { KeyValueStore } from './chatgpt-auth.ts';
import type { CaptionTrack } from './tracks.ts';

export type TranslationLines = (string | undefined)[];
// [line index, translation]
export type TranslationUpdate = [number, string];

// One entry per video, caption track and target language
export const translationKey = (videoId: string, track: Pick<CaptionTrack, 'languageCode' | 'kind'>, target: string) =>
  [videoId, track.languageCode, track.kind ?? '', target].join('\n');

// Each entry is stored under its own key. The index lists the entries and their sizes, the one used longest ago first.
const INDEX_KEY = 'translationIndex';
const entryKey = (key: string) => `translations:${key}`;
type IndexItem = { key: string; bytes: number };

// generation: made anew whenever the entry starts over for other caption lines, so lines translated for the earlier
// ones are refused. translations: null where not translated (JSON has no undefined).
type Entry = { generation: string; sources: string[]; translations: (string | null)[] };

export type CacheOptions = {
  // How many entries to keep, and how many bytes they may take in all. chrome.storage.session holds 10 MB, shared with
  // the sign-in, so the cache leaves half of it free.
  limit?: number;
  budget?: number;
  newGeneration?: () => string;
};

const sameLines = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((line, i) => line === b[i]);
const sizeOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export const createTranslationStore = (
  store: KeyValueStore,
  { limit = 20, budget = 5 * 1024 * 1024, newGeneration = () => crypto.randomUUID() }: CacheOptions = {}
) => {
  // Two tabs can save at once: one change at a time, so neither overwrites the other's lines
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  const readIndex = async () => (await store.get<IndexItem[]>(INDEX_KEY)) ?? [];

  // Writes the index, and the entry when given, as the most recently used one. Older entries go while there are more
  // than limit or they take more than budget, and also while the storage refuses a write for want of room.
  // False when the entry can't be kept at all (bigger than budget).
  const commit = async (key: string, entry?: Entry): Promise<boolean> => {
    let index = await readIndex();
    const bytes = entry ? sizeOf(entry) : (index.find((item) => item.key === key)?.bytes ?? 0);
    if (bytes > budget) return false;
    index = [...index.filter((item) => item.key !== key), { key, bytes }];
    const total = () => index.reduce((sum, item) => sum + item.bytes, 0);
    const dropOldest = async () => {
      const [oldest] = index;
      if (oldest.key === key) return false;
      index = index.slice(1);
      await store.remove(entryKey(oldest.key));
      return true;
    };
    while (index.length > limit || total() > budget) if (!(await dropOldest())) break;
    for (;;) {
      try {
        if (entry) await store.set(entryKey(key), entry);
        await store.set(INDEX_KEY, index);
        return true;
      } catch (error) {
        if (!(await dropOldest())) throw error;
      }
    }
  };

  return {
    // The translations kept for these caption lines (undefined where there are none), and the entry's generation for
    // saving. An entry for other lines under the same key (another track sharing it, or captions that changed) starts
    // over, so the two never mix.
    load: (key: string, sources: readonly string[]): Promise<{ generation: string; translations: TranslationLines }> =>
      serialized(async () => {
        const kept = await store.get<Entry>(entryKey(key));
        if (kept && sameLines(kept.sources, sources)) {
          await commit(key);
          return { generation: kept.generation, translations: kept.translations.map((line) => line ?? undefined) };
        }
        const entry: Entry = { generation: newGeneration(), sources: [...sources], translations: new Array(sources.length).fill(null) };
        const stored = await commit(key, entry);
        const empty = new Array<string | undefined>(sources.length).fill(undefined);
        // Too big to keep: saving takes nothing
        return { generation: stored ? entry.generation : '', translations: empty };
      }),

    // Adds translated lines to the entry load made. A line already kept stays as it is. Nothing is taken when the entry
    // started over for other lines since (its generation changed) or was dropped meanwhile.
    save: (key: string, generation: string, updates: readonly TranslationUpdate[]): Promise<void> =>
      serialized(async () => {
        const kept = await store.get<Entry>(entryKey(key));
        if (!kept || kept.generation !== generation) return;
        let changed = false;
        for (const [index, translation] of updates) {
          if (!Number.isInteger(index) || index < 0 || index >= kept.translations.length || !translation) continue;
          if (kept.translations[index]) continue;
          kept.translations[index] = translation;
          changed = true;
        }
        if (changed) await commit(key, kept);
      }),
  };
};

// The lines translated since the last call, for sending to the shared cache. Lines that were already there when the
// session started, and failed ones (''), are never sent.
export const createUpdateTracker = (translations: TranslationLines) => {
  const sent = new Set(translations.flatMap((translation, i) => (translation ? [i] : [])));
  return (): TranslationUpdate[] => {
    const updates: TranslationUpdate[] = [];
    translations.forEach((translation, i) => {
      if (!translation || sent.has(i)) return;
      sent.add(i);
      updates.push([i, translation]);
    });
    return updates;
  };
};

// The background checks what the content scripts send before touching the storage
const MAX_LINES = 20_000;
const MAX_TEXT = 2_000;
const isText = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length <= max;

export const cacheLoadRequest = (message: { key?: unknown; sources?: unknown }) =>
  isText(message.key, 300) &&
  Array.isArray(message.sources) &&
  message.sources.length <= MAX_LINES &&
  message.sources.every((line) => isText(line))
    ? { key: message.key, sources: message.sources as string[] }
    : null;

export const cacheSaveRequest = (message: { key?: unknown; generation?: unknown; updates?: unknown }) =>
  isText(message.key, 300) &&
  isText(message.generation, 100) &&
  Array.isArray(message.updates) &&
  message.updates.length <= MAX_LINES &&
  message.updates.every(
    (update) => Array.isArray(update) && update.length === 2 && Number.isInteger(update[0]) && isText(update[1])
  )
    ? { key: message.key, generation: message.generation, updates: message.updates as TranslationUpdate[] }
    : null;
