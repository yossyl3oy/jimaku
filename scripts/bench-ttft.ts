// Measures the TTFT of the translated captions (from the "…" placeholder appearing until the translation shows) with the mock translator, under the same conditions every time.
// In the browser, video loading and ads make the numbers jumpy, so only the way translation proceeds is compared here.
//   mise exec -- pnpm bench

import type { Caption } from '../src/core/captions.ts';
import { createMockTranslator } from '../src/core/mock.ts';
import { createCaptionSession } from '../src/core/session.ts';

// The same mock delays as main.ts
const MOCK = { ttftMs: 400, perLineMs: 60 };

// One line every 4 seconds, 300 lines (about a 20-minute video)
const captions: Caption[] = Array.from({ length: 300 }, (_, i) => ({
  startTime: i * 4,
  endTime: i * 4 + 4,
  text: `line ${i}`,
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the session, jumps to targetLine after seekAfterMs, and measures the time until that line is translated
const measure = async (targetLine: number, seekAfterMs: number) => {
  let time = 0;
  const session = createCaptionSession({
    captions,
    translator: createMockTranslator(MOCK),
    getCurrentTime: () => time,
  });
  const target = captions[targetLine].startTime + 0.5;
  // Cases that start watching begin with the video opened at that position
  if (seekAfterMs === 0) time = target;
  const controller = new AbortController();
  void session.run(controller.signal);

  await sleep(seekAfterMs);
  time = target;
  // main.ts calls seek() on the video's seeking event
  if (seekAfterMs > 0) session.seek();
  const seekedAt = performance.now();
  while (session.linesAt(time)?.translation === undefined) await sleep(5);
  const waited = performance.now() - seekedAt;
  controller.abort();
  return Math.round(waited);
};

const scenarios: [string, number, number][] = [
  ['Watch from the start (line 0)', 0, 0],
  ['Open the video at a later time (line 3)', 3, 0],
  ['Jump to the middle, chunk start (line 150)', 150, 1500],
  ['Jump to the middle, mid-chunk (line 155)', 155, 1500],
];

console.log(`Mock: ${MOCK.ttftMs}ms to the first character, ${MOCK.perLineMs}ms per line\n`);
for (const [label, line, seekAfter] of scenarios) {
  const runs = [await measure(line, seekAfter), await measure(line, seekAfter), await measure(line, seekAfter)];
  console.log(`${label.padEnd(44)} ${Math.min(...runs)}-${Math.max(...runs)}ms`);
}
