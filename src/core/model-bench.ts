// Pure parts of the model benchmark (src/bench/): the translation requests cut from real captions, and the summary of
// how each model did. Without chrome.* or fetch, so they are testable.

import type { ReasoningEffort, Usage } from './chatgpt-responses.ts';
import type { TranslationContext } from './translator.ts';

// bench-data/captions.json: windows of real captions (kept out of git, since they belong to the video's owner).
// Each window holds the lines before the chunk, the chunk and the lines after it; start is the chunk's first line in
// the whole track and offset the window's. ref is the human translation of the line, where the tracks line up.
export type FixtureLine = { s: number; t: string; ref?: string | null };
export type FixtureWindow = { track: string; start: number; offset: number; lines: FixtureLine[] };
export type Fixture = { video: string; title: string; windows: FixtureWindow[] };

export type BenchCase = {
  id: string;
  lines: string[];
  // The human translation of each line to translate (null where none lines up)
  refs: (string | null)[];
  context: TranslationContext;
};

// The requests the session would send for these windows: the chunk, with the lines before it (carrying the human
// translation, as if already shown) and after it as context
export const benchCases = (fixture: Fixture, { chunkSize = 10, afterLines = 4 } = {}): BenchCase[] =>
  fixture.windows.map((window) => {
    const at = window.start - window.offset;
    const chunk = window.lines.slice(at, at + chunkSize);
    return {
      id: `${window.track}@${window.start}`,
      lines: chunk.map((line) => line.t),
      refs: chunk.map((line) => line.ref ?? null),
      context: {
        title: fixture.title,
        before: window.lines.slice(0, at).map((line) => ({ source: line.t, translation: line.ref ?? undefined })),
        after: window.lines.slice(at + chunkSize, at + chunkSize + afterLines).map((line) => line.t),
      },
    };
  });

// The lowest reasoning effort first: the first one a model accepts is the one it is measured with
export const EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low'];

export type RunResult = {
  model: string;
  effort: ReasoningEffort;
  // Which prompt was sent (src/bench/prompts.ts)
  prompt: string;
  caseId: string;
  ok: boolean;
  error?: string;
  // The HTTP status when the request was refused (400: an unsupported effort, for example)
  status?: number;
  // From sending the request until the response headers, the first text and the first parsed line
  headersMs?: number;
  firstTextMs?: number;
  firstLineMs?: number;
  totalMs?: number;
  usage?: Usage;
  translations?: (string | undefined)[];
  // The whole response text, to see how a model strayed from the format
  text?: string;
};

export const median = (values: readonly number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const mean = (values: readonly number[]): number | undefined =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;

export type ModelSummary = {
  model: string;
  effort: ReasoningEffort;
  prompt: string;
  runs: number;
  failures: number;
  firstLineMs?: number;
  totalMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  // All tokens over the lines translated, in the successful runs that reported their tokens
  tokensPerLine?: number;
  // Translated lines over requested lines, in the successful runs
  coverage?: number;
};

// One row per model, effort and prompt, in the order they first appear. Times are medians, token counts means per request.
export const summarize = (results: readonly RunResult[], linesPerCase: (caseId: string) => number): ModelSummary[] => {
  const groups = new Map<string, RunResult[]>();
  for (const result of results) {
    const key = `${result.model}\u0000${result.effort}\u0000${result.prompt}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].map((runs) => {
    const ok = runs.filter((run) => run.ok);
    const numbers = (pick: (run: RunResult) => number | undefined) =>
      ok.map(pick).filter((value): value is number => value !== undefined);
    const translatedIn = (some: RunResult[]) =>
      some.reduce((sum, run) => sum + (run.translations?.filter((line) => line).length ?? 0), 0);
    const translated = translatedIn(ok);
    const requested = ok.reduce((sum, run) => sum + linesPerCase(run.caseId), 0);
    const counted = ok.filter((run) => tokensOf(run) !== undefined);
    const tokens = counted.reduce((sum, run) => sum + tokensOf(run)!, 0);
    const countedLines = translatedIn(counted);
    return {
      model: runs[0].model,
      effort: runs[0].effort,
      prompt: runs[0].prompt,
      runs: runs.length,
      failures: runs.length - ok.length,
      firstLineMs: median(numbers((run) => run.firstLineMs)),
      totalMs: median(numbers((run) => run.totalMs)),
      inputTokens: mean(numbers((run) => run.usage?.input_tokens)),
      outputTokens: mean(numbers((run) => run.usage?.output_tokens)),
      reasoningTokens: mean(numbers((run) => run.usage?.output_tokens_details?.reasoning_tokens)),
      tokensPerLine: countedLines ? tokens / countedLines : undefined,
      coverage: requested ? translated / requested : undefined,
    };
  });
};

const tokensOf = ({ usage }: RunResult) =>
  usage?.total_tokens ??
  (usage?.input_tokens !== undefined && usage.output_tokens !== undefined ? usage.input_tokens + usage.output_tokens : undefined);
