// The prompt that translates captions from the track's language into the chosen language, and parsing of its response.
// The instructions are in English whatever the languages (they took about a third fewer tokens than the earlier
// Japanese ones, with translations as good in the model benchmark); only the language names change.
// Shizue's YouTube prompt passed no surrounding lines and said "don't merge lines into sentences",
// so translations of auto-generated captions came out fragmented. Here, as in its Netflix prompt, surrounding lines are passed as context.
//
// The response comes back as "number<TAB>translation" lines rather than JSON. JSON cannot be read until it closes,
// but lines can be shown as each one arrives (shorter TTFT). The numbers also reveal missing lines.

import { languageName, type Languages } from './languages.ts';
import type { TranslateOptions, TranslationContext, Translator } from './translator.ts';

// The lines to translate are wrapped in lines holding only these tags (the mock reads the lines back from here)
export const LINES_OPEN = '<lines>';
export const LINES_CLOSE = '</lines>';

// One line to translate. Numbers start at 1
export const numberedLine = (index: number, text: string) => `${index + 1}\t${text}`;

export const buildPrompt = (lines: readonly string[], context: TranslationContext, languages: Languages): string => {
  const source = languageName(languages.source, 'en');
  const target = languageName(languages.target, 'en');
  const before = context.before.length
    ? context.before
        .map(({ source: line, translation }) => (translation === undefined ? `- ${line}` : `- ${line} → ${translation}`))
        .join('\n')
    : '(none)';
  const after = context.after.length ? context.after.map((line) => `- ${line}`).join('\n') : '(none)';
  return `Translate ${source} YouTube captions into ${target} subtitles.
- Translate each of the ${lines.length} numbered lines on its own. Each is shown alone on screen: never merge lines or move words between them.
- Auto-generated captions split sentences across lines: get the whole sentence from the nearby lines, then translate naturally the part this line carries.
- Before/After are context only: keep names, terms and tone consistent with them.
- Short, natural subtitles that read at a glance.
Output only "number<TAB>translation" lines, in order.

Title: ${context.title ?? '(unknown)'}
Before (→ translation shown):
${before}
${LINES_OPEN}
${lines.map((line, i) => numberedLine(i, line)).join('\n')}
${LINES_CLOSE}
After:
${after}`;
};

// Reads "number<TAB>translation" lines as they arrive. A stream chunk can end mid-line,
// so text is held until a newline arrives. After the number, ": ", ". " and the like are accepted besides TAB.
// A TAB is always taken as the separator, and any symbols after it (".5 秒", "...", etc.) stay part of the translation.
const LINE_RE = /^\s*(\d+)(?:\t|[ \u3000]*[:：.、)）][ \u3000]*|[ \u3000]+)(.*)$/;

export const createLineParser = (count: number, onLine?: (index: number, translation: string) => void) => {
  const translations: (string | undefined)[] = new Array(count).fill(undefined);
  let buffer = '';

  const take = (raw: string) => {
    const match = raw.match(LINE_RE);
    if (!match) return;
    const index = Number(match[1]) - 1;
    const text = match[2].trim();
    if (index < 0 || index >= count || translations[index] !== undefined || !text) return;
    translations[index] = text;
    onLine?.(index, text);
  };

  return {
    feed(chunk: string) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        take(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    },
    // Call when the stream ends. Also reads a last line that does not end with a newline
    end(): (string | undefined)[] {
      take(buffer);
      buffer = '';
      return translations;
    },
  };
};

// A stream that sends the prompt and returns the response text a little at a time
export type StreamFn = (prompt: string, signal?: AbortSignal) => AsyncIterable<string>;

// Any stream becomes a Translator into one language pair. The ChatGPT plan implements this stream (and the mock does).
export const createPromptTranslator = (stream: StreamFn, languages: Languages, warmup?: () => void): Translator => ({
  async translate(lines: string[], context: TranslationContext, options: TranslateOptions = {}) {
    const parser = createLineParser(lines.length, options.onLine);
    for await (const chunk of stream(buildPrompt(lines, context, languages), options.signal)) {
      options.signal?.throwIfAborted();
      parser.feed(chunk);
    }
    // An aborted stream may end normally instead of throwing, so do not use partial lines as translations
    options.signal?.throwIfAborted();
    return parser.end();
  },
  warmup,
});
