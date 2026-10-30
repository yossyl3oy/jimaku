// mise exec -- pnpm build          The development build into dist/, with the model benchmark page when its captions are there
// mise exec -- pnpm build:release  Only what the extension loads (the release workflow and CI use it)

import { BENCH_CAPTIONS, buildExtension } from './extension-build.ts';

const release = process.argv.includes('--release');
const { bench } = await buildExtension({ outdir: 'dist', release });
if (!release) {
  console.log(bench ? 'With the model benchmark page (bench.html)' : `No ${BENCH_CAPTIONS}, so no model benchmark page`);
}
