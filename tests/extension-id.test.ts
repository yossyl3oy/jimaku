import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The ID Chrome gives the extension: the SHA-256 of the manifest's key (a public key), its first 32 hex digits
// written with the letters a-p
const extensionIdOf = (key: string) =>
  createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/./g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));

// With the key, the ID is the same whatever folder the extension is loaded from. A new key would change it, which loses
// the saved sign-in and the passkey, and adds another "Jimaku" to ChatGPT's app usage settings
test('manifest key: the extension ID stays bineloccjadloiohooadhfclifcfdbai', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  assert.equal(extensionIdOf(manifest.key), 'bineloccjadloiohooadhfclifcfdbai');
});
