import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unlockMethodName } from '../src/core/unlock-name.ts';

test('unlockMethodName: Windows Hello on Windows, Touch ID on macOS, from either platform value', () => {
  assert.equal(unlockMethodName('Windows'), 'Windows Hello');
  assert.equal(unlockMethodName('Win32'), 'Windows Hello');
  assert.equal(unlockMethodName('macOS'), 'Touch ID');
  assert.equal(unlockMethodName('MacIntel'), 'Touch ID');
});

test('unlockMethodName: none elsewhere, or when the platform is unknown (the screens say "passkey")', () => {
  for (const platform of ['Linux', 'Linux x86_64', 'Chrome OS', '', undefined]) {
    assert.equal(unlockMethodName(platform), null, String(platform));
  }
});
