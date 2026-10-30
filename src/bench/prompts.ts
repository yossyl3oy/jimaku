// The prompts the benchmark compares. "current" is the one jimaku sends (src/core/prompt.ts); the others are earlier
// ones, kept to compare against, and the place for new candidates. One that wins moves into prompt.ts.

import { languageName, type Languages } from '../core/languages.ts';
import { buildPrompt, LINES_CLOSE, LINES_OPEN, numberedLine } from '../core/prompt.ts';
import type { TranslationContext } from '../core/translator.ts';

// The prompt up to v0.2.0, with its instructions in Japanese
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

// The prompt before the benchmark of 2026-10-31 for gpt-6-luna: the same layout with fewer rules, and
// "number<TAB>translation" lines without the copied source
const english = (lines: readonly string[], context: TranslationContext, languages: Languages): string => {
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

export const PROMPTS = {
  current: buildPrompt,
  english,
  japanese,
} satisfies Record<string, (lines: readonly string[], context: TranslationContext, languages: Languages) => string>;

export type PromptName = keyof typeof PROMPTS;
