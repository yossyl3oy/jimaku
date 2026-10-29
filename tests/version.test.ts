import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

// The release workflow publishes a tag (v0.1.0) only when both say the same version
test('version: package.json and the manifest agree, as major.minor.patch', () => {
  const version = read('package.json').version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(read('public/manifest.json').version, version);
});
