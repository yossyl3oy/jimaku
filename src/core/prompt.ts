// The prompt that translates captions from the track's language into the chosen language, and parsing of its response.
// The prompt itself is written in Japanese whatever the languages; only the language names change. In a blind review
// of the model benchmark (2026-10-31), it read the most naturally with gpt-6.1-terra and gpt-6-sol, ahead of shorter
// English instructions and of asking for the source line to be copied first (see docs/development.md).
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
  const sourceName = languageName(languages.source, 'ja');
  const targetName = languageName(languages.target, 'ja');
  const before = context.before.length
    ? context.before
        .map(({ source, translation }) =>
          translation === undefined ? `- ${source}` : `- ${source}\n  → ${translation}`
        )
        .join('\n')
    : '(なし)';
  const after = context.after.length ? context.after.map((line) => `- ${line}`).join('\n') : '(なし)';

  return `あなたは YouTube 動画の${sourceName}字幕を${targetName}字幕に訳す翻訳者です。

## ルール
1. 「訳す行」の各行を${targetName}に訳す。行数は ${lines.length}。
2. 1行は画面に1つずつ出る字幕。行をまとめたり、別の行に言葉を移したりしない。
3. 自動生成字幕では1つの文が複数の行にまたがる。前後の行から文全体の意味をつかみ、その行が担う部分を自然な${targetName}にする。語順の都合で訳しにくければ、意味の切れ目で分けてよい。
4. 「直前の行」「直後の行」は文脈にだけ使う。人名・呼び方・口調をそろえる。直前の行の訳は変えない。
5. 字幕としてひと目で読める、短く自然な${targetName}にする。

## 動画タイトル
${context.title ?? '(不明)'}

## 直前の行（→ のあとは表示済みの訳）
${before}

## 訳す行（番号<TAB>${sourceName}）
${LINES_OPEN}
${lines.map((line, i) => numberedLine(i, line)).join('\n')}
${LINES_CLOSE}

## 直後の行
${after}

## 出力
訳す行と同じ番号を付け、「番号<TAB>訳」を1行ずつ、番号順に出す。説明やコードブロックは付けない。
1\t1行目の訳
2\t2行目の訳`;
};

// Reads "number<TAB>translation" lines as they arrive (or "number<TAB>source<TAB>translation", which an earlier prompt
// asked for). A stream chunk can end mid-line,
// so text is held until a newline arrives. After the number, ": ", ". " and the like are accepted besides TAB, and so is
// a TAB written out as "\t" (gpt-6-luna does that now and then, which lost the whole chunk).
// A TAB is always taken as the separator, and any symbols after it (".5 秒", "...", etc.) stay part of the translation.
// The translation follows the copied source, and a line without the copy ("number<TAB>translation") reads the same.
// A line that holds only the copied source has no translation, and is left missing (to be asked for again).
const LINE_RE = /^\s*(\d+)(?:\t|\\t|[ \u3000]*[:：.、)）][ \u3000]*|[ \u3000]+)(.*)$/;
// Characters no language uses: private use, and planes 4-13, where Unicode has assigned nothing (gpt-6-luna once left
// one in a line). Unassigned code points in general are kept: a browser with older Unicode data counts new emoji as such.
const NOT_TEXT = /[\p{Co}\u{40000}-\u{DFFFF}]/gu;

const SEPARATOR = /\t|\\t/;
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const pairsOf = (text: string) => Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));
// Whether a field is the copied source line: the same text, or nearly (the model doesn't always copy it exactly)
const isCopyOf = (field: string, source: string) => {
  const [copy, line] = [normalize(field), normalize(source)];
  if (copy === line) return true;
  const left = new Map<string, number>();
  for (const pair of pairsOf(line)) left.set(pair, (left.get(pair) ?? 0) + 1);
  let common = 0;
  for (const pair of pairsOf(copy)) {
    const n = left.get(pair) ?? 0;
    if (n) {
      common++;
      left.set(pair, n - 1);
    }
  }
  const total = pairsOf(copy).length + pairsOf(line).length;
  return total > 0 && (2 * common) / total >= 0.8;
};
// A line that comes back holding only the copied source has no translation. A short one can legitimately stay the
// same ("2026", "Elon."), so only lines this long count
const COPY_ONLY_LENGTH = 12;

// sources: the lines asked for, to tell the copied source from the translation (a count when they aren't known)
export const createLineParser = (
  sources: readonly string[] | number,
  onLine?: (index: number, translation: string) => void
) => {
  const count = typeof sources === 'number' ? sources : sources.length;
  const translations: (string | undefined)[] = new Array(count).fill(undefined);
  let buffer = '';

  const take = (raw: string) => {
    const match = raw.match(LINE_RE);
    if (!match) return;
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= count || translations[index] !== undefined) return;
    const source = typeof sources === 'number' ? undefined : sources[index];
    // Split at the first TAB only, and only when the field before it is the copied source, so a translation holding a
    // TAB or a "\t" of its own stays whole
    let rest = match[2];
    let copied = false;
    const separator = rest.match(SEPARATOR);
    if (separator?.index !== undefined && (source === undefined || isCopyOf(rest.slice(0, separator.index), source))) {
      rest = rest.slice(separator.index + separator[0].length);
      copied = true;
    }
    const text = rest.replace(NOT_TEXT, '').trim();
    if (!text) return;
    if (!copied && source !== undefined && normalize(source).length >= COPY_ONLY_LENGTH && normalize(text) === normalize(source)) return;
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
    const parser = createLineParser(lines, options.onLine);
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
