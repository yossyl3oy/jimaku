import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildExtension, VERSION } from '../scripts/extension-build.ts';
import { BROWSERS } from '../scripts/manifest.ts';

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();

// A file added to the extension has to be added here too, so nothing else slips into a release
for (const browser of BROWSERS) {
  test(`release build for ${browser}: only the files the extension loads, at the repository's version`, async () => {
    const outdir = mkdtempSync(join(tmpdir(), `jimaku-release-${browser}-`));
    try {
      await buildExtension({ browser, outdir, release: true, logLevel: 'silent' });
      const locales = readdirSync(new URL('../public/_locales', import.meta.url)).map((locale) => join('_locales', locale, 'messages.json'));
      const icons = [16, 32, 48, 128].map((size) => join('icons', `icon-${size}.png`));
      const expected = [
        'manifest.json',
        'background.js',
        'content.js',
        'page.js',
        'x.js',
        'page.css',
        'popup.html',
        'popup.js',
        'callback.html',
        'callback.js',
        'unlock.html',
        'unlock.js',
        ...icons,
        ...locales,
      ];
      assert.deepEqual(filesIn(outdir), expected.sort());
      assert.equal(JSON.parse(readFileSync(join(outdir, 'manifest.json'), 'utf8')).version, VERSION);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
}
