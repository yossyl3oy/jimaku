// Mock used instead of a real API. Like the real one, it builds the prompt and streams the response one line at a time,
// so the prompt -> stream parsing -> missing-line retry flow runs with the mock too.

import { createPromptTranslator, LINES_CLOSE, LINES_OPEN, numberedLine, type StreamFn } from './prompt.ts';
import type { Translator } from './translator.ts';

export type MockOptions = {
  // Delays that look like a real LLM: the wait until the first character (TTFT) and the wait per line written
  ttftMs?: number;
  perLineMs?: number;
  // For requests with this many lines, drop the last line (to exercise the missing-line retry)
  dropLineWhenCount?: number;
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

// The lines to translate are "number<TAB>source" lines between a line of just "<lines>" and a line of just "</lines>".
// Since they are numbered, a source line containing "</lines>" is never mistaken for the closing line.
// Only the title, which comes before them, can be a tag-only line, so read from the last "<lines>" line.
const readLines = (prompt: string): string[] => {
  const promptLines = prompt.split('\n');
  const open = promptLines.lastIndexOf(LINES_OPEN);
  const close = promptLines.indexOf(LINES_CLOSE, open + 1);
  if (open === -1 || close === -1) throw new Error('no lines in prompt');
  return promptLines.slice(open + 1, close).map((line) => line.slice(line.indexOf('\t') + 1));
};

export const mockStream =
  (options: MockOptions = {}): StreamFn =>
  async function* (prompt, signal) {
    const lines = readLines(prompt);
    await wait(options.ttftMs ?? 0, signal);
    for (const [i, line] of lines.entries()) {
      if (i > 0) await wait(options.perLineMs ?? 0, signal);
      if (options.dropLineWhenCount === lines.length && i === lines.length - 1) continue;
      yield numberedLine(i, `【訳】${line}`) + '\n';
    }
  };

export const createMockTranslator = (options: MockOptions = {}): Translator =>
  createPromptTranslator(mockStream(options), { source: 'en', target: 'ja' }, () => {});
