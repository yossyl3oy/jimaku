import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslationCache, translationKey } from '../src/core/translation-cache.ts';

const sources = ['a', 'b', 'c'];

test('linesFor: the same key and lines get the same array back, with what was filled in', () => {
  const cache = createTranslationCache();
  const key = translationKey('video', { languageCode: 'en' }, 'ja');
  const first = cache.linesFor(key, sources);
  assert.equal(first.length, 3);
  assert.equal(first.filter((translation) => translation !== undefined).length, 0);
  first[1] = '訳b';
  const again = cache.linesFor(key, [...sources]);
  assert.equal(again, first);
  assert.deepEqual(again, [undefined, '訳b', undefined]);
});

test('linesFor: different lines under the same key start empty', () => {
  const cache = createTranslationCache();
  const key = translationKey('video', { languageCode: 'en' }, 'ja');
  cache.linesFor(key, sources)[0] = '訳a';
  assert.deepEqual(cache.linesFor(key, ['a', 'b', 'x']), [undefined, undefined, undefined]);
  assert.deepEqual(cache.linesFor(key, ['a', 'b']), [undefined, undefined]);
});

test('translationKey: the video, the track (language and auto-generated or not) and the target each make a new entry', () => {
  const keys = [
    translationKey('video', { languageCode: 'en' }, 'ja'),
    translationKey('other', { languageCode: 'en' }, 'ja'),
    translationKey('video', { languageCode: 'en', kind: 'asr' }, 'ja'),
    translationKey('video', { languageCode: 'en-GB' }, 'ja'),
    translationKey('video', { languageCode: 'en' }, 'ko'),
  ];
  assert.equal(new Set(keys).size, keys.length);
  const cache = createTranslationCache();
  cache.linesFor(keys[0], sources)[0] = '訳a';
  for (const key of keys.slice(1)) assert.equal(cache.linesFor(key, sources)[0], undefined);
  assert.equal(cache.linesFor(keys[0], sources)[0], '訳a');
});

test('linesFor: keeps at most limit entries, dropping the one used longest ago', () => {
  const cache = createTranslationCache(2);
  cache.linesFor('one', sources)[0] = '1';
  cache.linesFor('two', sources)[0] = '2';
  // Using "one" again makes "two" the oldest
  cache.linesFor('one', sources);
  cache.linesFor('three', sources)[0] = '3';
  assert.equal(cache.size(), 2);
  assert.equal(cache.linesFor('one', sources)[0], '1');
  assert.equal(cache.linesFor('two', sources)[0], undefined);
});
