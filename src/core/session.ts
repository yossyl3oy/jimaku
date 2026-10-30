// Translates the captions of one video in order, starting from the line being watched and staying about 5 minutes
// ahead of playback: the part before the playback position is translated only if playback goes back there, and the
// part further on as playback gets near it. It does not touch the DOM, and it reads the playback position through
// getCurrentTime, so tests can drive it by swapping the time.
//
// Rules for keeping TTFT short:
// - Each translated line goes into translations as soon as it arrives (no waiting for the whole chunk)
// - The range to translate starts at the line being watched (not aligned to fixed blocks)
// - When playback jumps to an untranslated part, cut off the chunk in flight and translate the new position first

import { findCaptionIndex, findCaptionIndexAtOrBefore, type Caption } from './captions.ts';
import { buildContext, nextRange, type Chunk } from './chunks.ts';
import { translateWithRetry } from './translate.ts';
import type { Translator } from './translator.ts';

export type SessionOptions = {
  captions: Caption[];
  translator: Translator;
  getCurrentTime: () => number;
  title?: string;
  chunkSize?: number;
  beforeLines?: number;
  afterLines?: number;
  onError?: (error: unknown) => void;
  // Errors that will fail every request the same way (not signed in, usage limit, ...). On these the session stops
  // instead of failing chunk after chunk; onError still gets the error.
  isFatal?: (error: unknown) => boolean;
  // The translations made earlier for these captions (one slot per caption), which the session fills in place, so the
  // caller can keep them for next time. Only the missing lines are requested; ones that failed before ('') are tried again.
  translations?: (string | undefined)[];
  // Called after each chunk ends (translated, failed or cut off), so the caller can keep the new lines
  onChunkEnd?: () => void;
  // How far ahead of playback to translate, in seconds (5 minutes by default): a chunk is requested while its first
  // line starts within it, so its last lines can run past it. Lines further on wait until playback gets near them, and
  // lines before the playback position until it goes back there, so a video watched for a few minutes uses the plan's
  // usage for about those minutes only
  aheadSeconds?: number;
  // How long to wait before looking again while there is nothing to translate yet (or until seek)
  idleMs?: number;
};

export type DisplayLines = {
  index: number;
  source: string;
  // undefined until translated
  translation: string | undefined;
};

export const createCaptionSession = (options: SessionOptions) => {
  const { captions, translator, getCurrentTime } = options;
  const sources = captions.map((caption) => caption.text);
  const translations = options.translations ?? new Array<string | undefined>(captions.length).fill(undefined);
  for (let i = 0; i < translations.length; i++) if (translations[i] === '') translations[i] = undefined;
  // Lines already requested (or being requested) from the translator
  const requested = captions.map((_, i) => translations[i] !== undefined);
  const chunkSize = options.chunkSize ?? 10;
  let inFlight: { range: Chunk; controller: AbortController } | null = null;

  const aheadSeconds = options.aheadSeconds ?? 300;
  const currentIndex = () => findCaptionIndexAtOrBefore(captions, getCurrentTime());

  // Waits idleMs, or less when playback jumps (seek) or the session stops
  let wake: (() => void) | null = null;
  const idle = (signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, options.idleMs ?? 1000);
      wake = done;
      signal?.addEventListener('abort', done, { once: true });
    });

  // The next chunk to translate: from the line being watched, while it starts within aheadSeconds of playback.
  // null when the next lines are further on, or when everything from here on is requested (nextRange would go back)
  const nextChunk = (): Chunk | null => {
    const from = currentIndex();
    const range = nextRange(requested, from, chunkSize);
    if (!range || range.start < from) return null;
    return captions[range.start].startTime <= getCurrentTime() + aheadSeconds ? range : null;
  };

  // Translates chunk by chunk, keeping aheadSeconds of playback translated, until every line is done or signal is
  // aborted. A failed chunk gets no translation (empty strings) and the session moves on, except on a fatal error,
  // which stops it.
  const run = async (signal?: AbortSignal) => {
    for (;;) {
      if (signal?.aborted) return;
      if (requested.every(Boolean)) return;
      const range = nextChunk();
      if (!range) {
        await idle(signal);
        continue;
      }
      for (let i = range.start; i < range.end; i++) requested[i] = true;

      // Each chunk has its own abort controller so that seek can cut it off
      const controller = new AbortController();
      const abortRequest = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abortRequest, { once: true });
      inFlight = { range, controller };

      const context = buildContext(sources, translations, range, {
        title: options.title,
        beforeLines: options.beforeLines ?? 6,
        afterLines: options.afterLines ?? 4,
      });
      try {
        const result = await translateWithRetry(translator, sources.slice(range.start, range.end), context, {
          signal: controller.signal,
          onLine: (i, translation) => {
            // Lines that arrive after the cut-off are not used (they get requested again)
            if (!controller.signal.aborted) translations[range.start + i] = translation;
          },
        });
        if (signal?.aborted) return;
        controller.signal.throwIfAborted();
        result.forEach((translation, i) => {
          translations[range.start + i] = translation;
        });
      } catch (error) {
        if (signal?.aborted) return;
        if (controller.signal.aborted) {
          // Cut off by seek. Put back the lines that never arrived so they can be requested again
          for (let i = range.start; i < range.end; i++) {
            if (translations[i] === undefined) requested[i] = false;
          }
        } else if (options.isFatal?.(error)) {
          options.onError?.(error);
          return;
        } else {
          options.onError?.(error);
          for (let i = range.start; i < range.end; i++) translations[i] ??= '';
        }
      } finally {
        signal?.removeEventListener('abort', abortRequest);
        inFlight = null;
        options.onChunkEnd?.();
      }
    }
  };

  // Call when playback jumps. If the target line is untranslated and not in the chunk being translated,
  // cut that chunk off (run requests again from the new position). A session waiting for playback looks again at once.
  const seek = () => {
    wake?.();
    if (!inFlight) return;
    const index = currentIndex();
    if (translations[index] !== undefined) return;
    if (index >= inFlight.range.start && index < inFlight.range.end) return;
    inFlight.controller.abort();
  };

  const linesAt = (time: number): DisplayLines | null => {
    const index = findCaptionIndex(captions, time);
    if (index === null) return null;
    return { index, source: sources[index], translation: translations[index] };
  };

  return { run, seek, linesAt };
};
