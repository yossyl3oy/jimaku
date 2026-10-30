// The prompts the benchmark compares. "current" is the one jimaku sends (src/core/prompt.ts); the others are
// alternatives that ask for the same "number<TAB>translation" lines. One that wins moves into prompt.ts.

import { languageName, type Languages } from '../core/languages.ts';
import { buildPrompt, LINES_CLOSE, LINES_OPEN, numberedLine } from '../core/prompt.ts';
import type { TranslationContext } from '../core/translator.ts';

// The earlier prompt, with its instructions in Japanese (about a third more input tokens than "current")
const japanese = (lines: readonly string[], context: TranslationContext, languages: Languages): string => {
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

export const PROMPTS = {
  current: buildPrompt,
  // Half the context: the 3 lines before and 2 after. It saved another 15% of the input tokens, but without the
  // earlier lines the speaker names fell back to "CA:" / "EM:"
  'compact-short': (lines: readonly string[], context: TranslationContext, languages: Languages) =>
    buildPrompt(lines, { ...context, before: context.before.slice(-3), after: context.after.slice(0, 2) }, languages),
  japanese,
} satisfies Record<string, (lines: readonly string[], context: TranslationContext, languages: Languages) => string>;

export type PromptName = keyof typeof PROMPTS;
