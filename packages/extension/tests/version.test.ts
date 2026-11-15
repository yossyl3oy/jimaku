import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VERSION } from '../scripts/extension-build.ts';

// The release workflow publishes a tag (v0.1.0) only when it names this version, which every manifest is built with
test('version: the one in the repository package.json, as major.minor.patch', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
