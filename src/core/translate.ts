// Translates one chunk. Only the lines missing from the response (the model merged two lines, stopped partway, etc.)
// are requested once more, with the translations so far as context. Lines that still do not come back become empty strings.
// (Replaces the rokrokss/shizue@c2ebc51 approach of splitting in half and retrying on a line-count mismatch, using numbered lines.)

import type { TranslateOptions, TranslationContext, Translator } from './translator.ts';

export const translateWithRetry = async (
  translator: Translator,
  lines: string[],
  context: TranslationContext,
  options: TranslateOptions = {}
): Promise<string[]> => {
  const { onLine, signal } = options;
  signal?.throwIfAborted();
  const first = await translator.translate(lines, context, { onLine, signal });

  const missing = lines.map((_, i) => i).filter((i) => first[i] === undefined);
  if (missing.length === 0) return first as string[];
  signal?.throwIfAborted();

  // Lines translated before the first missing line are added as preceding context
  const firstMissing = missing[0];
  const retry = await translator.translate(
    missing.map((i) => lines[i]),
    {
      ...context,
      before: [
        ...context.before,
        ...lines.slice(0, firstMissing).map((source, i) => ({ source, translation: first[i] })),
      ],
    },
    { onLine: (j, translation) => onLine?.(missing[j], translation), signal }
  );

  return lines.map((_, i) => {
    const j = missing.indexOf(i);
    return (j === -1 ? first[i] : retry[j]) ?? '';
  });
};
