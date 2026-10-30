import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildExtension } from '../scripts/extension-build.ts';

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();

// A file added to the extension has to be added here too, so nothing else slips into a release
test('release build: only the files the extension loads', async () => {
  const outdir = mkdtempSync(join(tmpdir(), 'jimaku-release-'));
  try {
    await buildExtension({ outdir, release: true, logLevel: 'silent' });
    const locales = readdirSync('public/_locales').map((locale) => join('_locales', locale, 'messages.json'));
    const icons = [16, 32, 48, 128].map((size) => join('icons', `icon-${size}.png`));
    const expected = [
      'manifest.json',
      'background.js',
      'content.js',
      'page.js',
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
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
});
