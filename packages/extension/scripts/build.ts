// mise exec -- pnpm build          The development builds into dist/chrome and dist/firefox, with the model benchmark
//                                  page when its captions are there
// mise exec -- pnpm build:release  Only what the extension loads (the release workflow and CI use it)

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH_CAPTIONS, buildExtension, ROOT } from './extension-build.ts';
import { BROWSERS } from './manifest.ts';

const release = process.argv.includes('--release');
// dist/ holds one folder per browser and nothing else: whatever an earlier build left there goes first
// (up to v0.8.3 the Chrome build was written into dist/ itself)
const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
let withBench = false;
for (const browser of BROWSERS) {
  const { bench } = await buildExtension({ browser, outdir: join(dist, browser), release });
  withBench ||= bench;
}
if (!release) {
  console.log(withBench ? 'With the model benchmark page (bench.html)' : `No ${BENCH_CAPTIONS}, so no model benchmark page`);
}
