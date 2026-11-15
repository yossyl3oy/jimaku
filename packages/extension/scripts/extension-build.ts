// Builds the extension for one browser into outdir. A release build holds only what the extension loads. A development
// build adds the model benchmark page (src/bench/) when its captions are there (bench-data/captions.json, kept out of git).

import { build } from 'esbuild';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestFor, type Browser } from './manifest.ts';

// Paths are taken from this file, so the build works from the repository's root and from the package alike
const PACKAGE = join(import.meta.dirname, '..');
export const ROOT = join(PACKAGE, '../..');
const inPackage = (path: string) => join(PACKAGE, path);

// At the repository's root, next to the other things kept out of git
export const BENCH_CAPTIONS = 'bench-data/captions.json';

// The one version of everything: the repository's package.json
export const VERSION: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// The oldest browsers the code is written for (Firefox: the manifest's strict_min_version)
const TARGETS: Record<Browser, string> = { chrome: 'chrome120', firefox: 'firefox128' };

export type BuildOptions = { browser: Browser; outdir: string; release: boolean; logLevel?: 'info' | 'silent' };

export const buildExtension = async ({ browser, outdir, release, logLevel = 'info' }: BuildOptions) => {
  const bench = !release && existsSync(join(ROOT, BENCH_CAPTIONS));
  rmSync(outdir, { recursive: true, force: true });
  cpSync(inPackage('public'), outdir, { recursive: true });
  writeFileSync(join(outdir, 'manifest.json'), `${JSON.stringify(manifestFor(browser, VERSION), null, 2)}\n`);
  if (bench) {
    cpSync(inPackage('src/bench/bench.html'), join(outdir, 'bench.html'));
    cpSync(join(ROOT, BENCH_CAPTIONS), join(outdir, 'bench-captions.json'));
  }
  await build({
    entryPoints: {
      content: inPackage('src/content/main.ts'),
      page: inPackage('src/page/player-bridge.ts'),
      background: inPackage('src/background/main.ts'),
      popup: inPackage('src/popup/main.ts'),
      callback: inPackage('src/callback/main.ts'),
      unlock: inPackage('src/unlock/main.ts'),
      ...(bench ? { bench: inPackage('src/bench/main.ts') } : {}),
    },
    outdir,
    bundle: true,
    format: 'iife',
    target: TARGETS[browser],
    logLevel,
  });
  return { bench };
};
