import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KeyValueStore } from '../src/core/chatgpt-auth.ts';
import {
  cacheLoadRequest,
  cacheSaveRequest,
  createTranslationStore,
  createUpdateTracker,
  translationKey,
} from '../src/core/translation-cache.ts';
import { memoryStore } from './fakes.ts';

const sources = ['a', 'b', 'c'];
const key = translationKey('video', { languageCode: 'en' }, 'ja');

test('load: nothing kept yet gives one empty slot per line; saved lines come back, also to another tab', async () => {
  const { store } = memoryStore();
  const firstTab = createTranslationStore(store);
  const first = await firstTab.load(key, sources);
  assert.deepEqual(first.translations, [undefined, undefined, undefined]);
  await firstTab.save(key, first.generation, [[1, '訳b']]);

  // Another tab talks to the same background, so it shares the storage
  const anotherTab = createTranslationStore(store);
  const again = await anotherTab.load(key, [...sources]);
  assert.deepEqual(again.translations, [undefined, '訳b', undefined]);
  assert.equal(again.generation, first.generation);
});

test('load: other lines under the same key start over, so two tracks or changed captions never mix', async () => {
  const cache = createTranslationStore(memoryStore().store);
  const { generation } = await cache.load(key, sources);
  await cache.save(key, generation, [[0, '訳a']]);
  const other = await cache.load(key, ['a', 'b', 'x']);
  assert.deepEqual(other.translations, [undefined, undefined, undefined]);
  assert.notEqual(other.generation, generation);
  assert.deepEqual((await cache.load(key, sources)).translations, [undefined, undefined, undefined]);
});

test('save: a tab still on the earlier captions adds nothing to the entry another tab started over', async () => {
  const cache = createTranslationStore(memoryStore().store);
  const stale = await cache.load(key, sources);
  // Another tab got changed captions under the same key
  const fresh = await cache.load(key, ['x', 'y', 'z']);
  await cache.save(key, stale.generation, [[0, 'translation of a']]);
  await cache.save(key, fresh.generation, [[1, 'translation of y']]);
  assert.deepEqual((await cache.load(key, ['x', 'y', 'z'])).translations, [undefined, 'translation of y', undefined]);
});

test('save: keeps lines already there, ignores empty ones and indexes out of range, and needs the entry load made', async () => {
  const cache = createTranslationStore(memoryStore().store);
  await cache.save(key, 'no entry yet', [[0, 'before load']]);
  const { generation, translations } = await cache.load(key, sources);
  assert.deepEqual(translations, [undefined, undefined, undefined]);

  await cache.save(key, generation, [[0, '訳a'], [1, ''], [5, 'x'], [-1, 'x'], [1.5, 'x']]);
  // Another tab translated line 0 too: the first one stays
  await cache.save(key, generation, [[0, 'other'], [2, '訳c']]);
  assert.deepEqual((await cache.load(key, sources)).translations, ['訳a', undefined, '訳c']);
});

test('save: two tabs saving at once both keep their lines', async () => {
  const cache = createTranslationStore(memoryStore().store);
  const { generation } = await cache.load(key, sources);
  await Promise.all([cache.save(key, generation, [[0, '訳a']]), cache.save(key, generation, [[2, '訳c']])]);
  assert.deepEqual((await cache.load(key, sources)).translations, ['訳a', undefined, '訳c']);
});

test('translationKey: the video, the track (language and auto-generated or not) and the target each make a new entry', async () => {
  const keys = [
    translationKey('video', { languageCode: 'en' }, 'ja'),
    translationKey('other', { languageCode: 'en' }, 'ja'),
    translationKey('video', { languageCode: 'en', kind: 'asr' }, 'ja'),
    translationKey('video', { languageCode: 'en-GB' }, 'ja'),
    translationKey('video', { languageCode: 'en' }, 'ko'),
  ];
  assert.equal(new Set(keys).size, keys.length);
  const cache = createTranslationStore(memoryStore().store);
  await cache.save(keys[0], (await cache.load(keys[0], sources)).generation, [[0, '訳a']]);
  for (const other of keys.slice(1)) assert.equal((await cache.load(other, sources)).translations[0], undefined);
  assert.equal((await cache.load(keys[0], sources)).translations[0], '訳a');
});

test('load: keeps at most limit entries, dropping the one used longest ago', async () => {
  const { store, data } = memoryStore();
  const cache = createTranslationStore(store, { limit: 2 });
  for (const name of ['one', 'two']) await cache.save(name, (await cache.load(name, sources)).generation, [[0, name]]);
  // Using "one" again makes "two" the oldest
  await cache.load('one', sources);
  await cache.load('three', sources);
  assert.deepEqual(
    (data.get('translationIndex') as { key: string }[]).map((item) => item.key),
    ['one', 'three']
  );
  assert.equal(data.has('translations:two'), false);
  assert.equal((await cache.load('one', sources)).translations[0], 'one');
  assert.equal((await cache.load('two', sources)).translations[0], undefined);
});

test('budget: entries go, oldest first, once they take more bytes than allowed; one too big is not kept', async () => {
  const { store, data } = memoryStore();
  const long = Array.from({ length: 50 }, (_, i) => `caption line number ${i}`);
  const entryBytes = new TextEncoder().encode(
    JSON.stringify({ generation: 'g', sources: long, translations: new Array(long.length).fill(null) })
  ).length;
  // Room for two entries, not three
  const cache = createTranslationStore(store, { budget: entryBytes * 2 + 10, newGeneration: () => 'g' });
  for (const name of ['one', 'two', 'three']) await cache.load(name, long);
  assert.deepEqual(
    (data.get('translationIndex') as { key: string }[]).map((item) => item.key),
    ['two', 'three']
  );

  const huge = Array.from({ length: 200 }, (_, i) => `caption line number ${i}`);
  const tooBig = await cache.load('huge', huge);
  assert.equal(tooBig.generation, '');
  assert.equal(data.has('translations:huge'), false);
  await cache.save('huge', tooBig.generation, [[0, 'x']]);
  assert.equal(data.has('translations:huge'), false);
});

test('storage full: writing an entry drops the oldest other entries until it fits', async () => {
  const { store, data } = memoryStore();
  // Room for two entries only
  const full: KeyValueStore = {
    ...store,
    set: async (name, value) => {
      const others = [...data.keys()].filter((kept) => kept.startsWith('translations:') && kept !== name).length;
      if (name.startsWith('translations:') && others >= 2) throw new Error('QUOTA_BYTES quota exceeded');
      await store.set(name, value);
    },
  };
  const cache = createTranslationStore(full);
  for (const name of ['one', 'two', 'three']) await cache.load(name, sources);
  assert.deepEqual(
    (data.get('translationIndex') as { key: string }[]).map((item) => item.key),
    ['two', 'three']
  );
  assert.equal(data.has('translations:one'), false);
  const three = await cache.load('three', sources);
  await cache.save('three', three.generation, [[0, '3']]);
  assert.equal((await cache.load('three', sources)).translations[0], '3');
});

test('storage full: writing the index drops the oldest other entries too', async () => {
  const { store, data } = memoryStore();
  // The index is refused once, while two entries are stored
  let refused = false;
  const full: KeyValueStore = {
    ...store,
    set: async (name, value) => {
      const entries = [...data.keys()].filter((kept) => kept.startsWith('translations:')).length;
      if (name === 'translationIndex' && entries >= 2 && !refused) {
        refused = true;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      await store.set(name, value);
    },
  };
  const cache = createTranslationStore(full);
  for (const name of ['one', 'two']) await cache.load(name, sources);
  assert.equal(refused, true);
  assert.deepEqual(
    (data.get('translationIndex') as { key: string }[]).map((item) => item.key),
    ['two']
  );
  assert.equal(data.has('translations:one'), false);
  assert.equal(data.has('translations:two'), true);
});

test('createUpdateTracker: hands over each newly translated line once, never the cached or failed ones', () => {
  const translations: (string | undefined)[] = ['cached', undefined, undefined, undefined];
  const updates = createUpdateTracker(translations);
  assert.deepEqual(updates(), []);
  translations[1] = '訳1';
  translations[2] = '';
  assert.deepEqual(updates(), [[1, '訳1']]);
  translations[3] = '訳3';
  assert.deepEqual(updates(), [[3, '訳3']]);
  assert.deepEqual(updates(), []);
});

test('cacheLoadRequest / cacheSaveRequest: only well-formed messages of a sane size get through', () => {
  assert.deepEqual(cacheLoadRequest({ key, sources }), { key, sources });
  assert.equal(cacheLoadRequest({ key, sources: [1] }), null);
  assert.equal(cacheLoadRequest({ key: 'x'.repeat(301), sources }), null);
  assert.equal(cacheLoadRequest({ key, sources: ['x'.repeat(2001)] }), null);
  assert.equal(cacheLoadRequest({ key }), null);

  const generation = 'g-1';
  assert.deepEqual(cacheSaveRequest({ key, generation, updates: [[0, '訳']] }), { key, generation, updates: [[0, '訳']] });
  assert.equal(cacheSaveRequest({ key, updates: [[0, '訳']] }), null);
  assert.equal(cacheSaveRequest({ key, generation, updates: [[0.5, '訳']] }), null);
  assert.equal(cacheSaveRequest({ key, generation, updates: [['0', '訳']] }), null);
  assert.equal(cacheSaveRequest({ key, generation, updates: [[0, '訳', 'extra']] }), null);
  assert.equal(cacheSaveRequest({ key, generation, updates: new Array(20_001).fill([0, '訳']) }), null);
});
