import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TARGET_LANGUAGES } from '../src/core/languages.ts';
import { PREVIEW_SAMPLES, previewLines } from '../src/core/preview.ts';

test('previewLines: below puts the translation under the source, above over it', () => {
  assert.deepEqual(previewLines('ja', 'below'), [
    { role: 'source', lang: 'en', text: 'Hello, world.' },
    { role: 'translation', lang: 'ja', text: 'こんにちは、世界。' },
  ]);
  assert.deepEqual(
    previewLines('ja', 'above').map((line) => line.role),
    ['translation', 'source']
  );
});

test('previewLines: translating into English shows a Japanese source', () => {
  assert.deepEqual(previewLines('en', 'below'), [
    { role: 'source', lang: 'ja', text: 'こんにちは、世界。' },
    { role: 'translation', lang: 'en', text: 'Hello, world.' },
  ]);
});

test('PREVIEW_SAMPLES: a sample for every target language', () => {
  for (const code of TARGET_LANGUAGES) assert.ok(PREVIEW_SAMPLES[code], code);
});
