import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('public', 'dist', { recursive: true });
await build({
  entryPoints: {
    content: 'src/content/main.ts',
    page: 'src/page/player-bridge.ts',
    background: 'src/background/main.ts',
    popup: 'src/popup/main.ts',
    callback: 'src/callback/main.ts',
    unlock: 'src/unlock/main.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
});
