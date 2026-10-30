import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';

// --bench adds the model benchmark page (src/bench/) and its captions, which releases leave out
const bench = process.argv.includes('--bench');
const CAPTIONS = 'bench-data/captions.json';
if (bench && !existsSync(CAPTIONS)) {
  console.error(`${CAPTIONS} is missing: the benchmark needs real captions (see docs/development.md)`);
  process.exit(1);
}

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
if (bench) {
  cpSync('src/bench/bench.html', 'dist/bench.html');
  cpSync(CAPTIONS, 'dist/bench-captions.json');
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
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
});
