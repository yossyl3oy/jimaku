// The prompts the benchmark compares. "current" is the one jimaku sends (src/core/prompt.ts); the others are earlier
// ones, kept to compare against, and the place for new candidates. One that wins moves into prompt.ts.

import { languageName, type Languages } from '../core/languages.ts';
import { buildPrompt, LINES_CLOSE, LINES_OPEN, numberedLine } from '../core/prompt.ts';
import type { TranslationContext } from '../core/translator.ts';

// The prompt of v0.3.0 to v0.5.0: short English instructions, and "number<TAB>translation" lines
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

// The prompt of v0.6.0 for gpt-6-luna: English instructions with rules for fragments, speaker labels and tone, and each
// source line copied before its translation
const echo = (lines: readonly string[], context: TranslationContext, languages: Languages): string => {
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
- Auto-generated captions split sentences across lines. Understand the whole sentence from the nearby lines, but translate only the words of this line: if it ends mid-sentence, end the translation mid-sentence too (with a comma or a connecting word) and leave the rest to the next line.
- Before/After are context only: keep names, terms and tone consistent with them.
- Speaker labels such as "CA:" are initials: write the speaker's name instead, as in the translations before or as the lines name them. Use the title and the context to translate names, terms and wordplay by their meaning.
- Keep each speaker's register (polite or casual) the same as in the translations before; when there are none, use a polite spoken style.
- Short, natural subtitles that read at a glance.
Output one line per numbered line, in order: the number, a TAB, the source line copied exactly, a TAB, then its translation. Nothing else.

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
  echo,
} satisfies Record<string, (lines: readonly string[], context: TranslationContext, languages: Languages) => string>;

export type PromptName = keyof typeof PROMPTS;
