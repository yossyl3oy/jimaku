// Pure functions that split captions into translation requests and build the context passed with each one.

import type { TranslationContext } from './translator.ts';

// Translate captions[start, end) together
export type Chunk = { start: number; end: number };

// The next range to translate: size lines starting at the first unrequested line at or after the watched line (from).
// Stops early at an already requested line. If everything after is requested, goes back to the first unrequested line.
// Because it starts at the watched line rather than at fixed blocks (0-9, 10-19, ...),
// a jump still gets that line's translation first (the stream returns lines in order from the first one).
export const nextRange = (requested: readonly boolean[], from: number, size: number): Chunk | null => {
  if (size < 1) throw new RangeError(`chunk size must be >= 1: ${size}`);
  const firstFrom = (i: number) => {
    for (; i < requested.length; i++) if (!requested[i]) return i;
    return -1;
  };
  let start = firstFrom(Math.max(0, from));
  if (start === -1) start = firstFrom(0);
  if (start === -1) return null;
  let end = start;
  while (end < requested.length && end - start < size && !requested[end]) end++;
  return { start, end };
};

export type ContextOptions = {
  title?: string;
  beforeLines: number;
  afterLines: number;
};

// sources holds the source text of every caption; translations is filled only for lines translated so far.
export const buildContext = (
  sources: readonly string[],
  translations: readonly (string | undefined)[],
  chunk: Chunk,
  options: ContextOptions
): TranslationContext => {
  const beforeStart = Math.max(0, chunk.start - options.beforeLines);
  return {
    title: options.title,
    before: sources
      .slice(beforeStart, chunk.start)
      .map((source, i) => ({ source, translation: translations[beforeStart + i] })),
    after: sources.slice(chunk.end, chunk.end + options.afterLines),
  };
};
