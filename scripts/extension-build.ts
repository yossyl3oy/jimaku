// Builds the extension into outdir. A release build holds only what the extension loads. A development build adds the
// model benchmark page (src/bench/) when its captions are there (bench-data/captions.json, kept out of git).

import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const BENCH_CAPTIONS = 'bench-data/captions.json';

export type BuildOptions = { outdir: string; release: boolean; logLevel?: 'info' | 'silent' };

export const buildExtension = async ({ outdir, release, logLevel = 'info' }: BuildOptions) => {
  const bench = !release && existsSync(BENCH_CAPTIONS);
  rmSync(outdir, { recursive: true, force: true });
  cpSync('public', outdir, { recursive: true });
  if (bench) {
    cpSync('src/bench/bench.html', join(outdir, 'bench.html'));
    cpSync(BENCH_CAPTIONS, join(outdir, 'bench-captions.json'));
  }
  await build({
    entryPoints: {
      content: 'src/content/main.ts',
      page: 'src/page/player-bridge.ts',
      background: 'src/background/main.ts',
      popup: 'src/popup/main.ts',
      callback: 'src/callback/main.ts',
      unlock: 'src/unlock/main.ts',
      ...(bench ? { bench: 'src/bench/main.ts' } : {}),
    },
    outdir,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    logLevel,
  });
  return { bench };
};
