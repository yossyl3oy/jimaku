import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { TARGET_LANGUAGES } from '../src/core/languages.ts';

type Message = { message: string; placeholders?: Record<string, { content: string }> };

const root = new URL('..', import.meta.url).pathname;
const localesDir = join(root, 'public/_locales');
const locales = readdirSync(localesDir);
const messagesOf = (locale: string): Record<string, Message> =>
  JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));
const english = messagesOf('en');

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
const sources = [...filesUnder(join(root, 'src')), ...filesUnder(join(root, 'public')).filter((path) => /\.(html|json)$/.test(path))]
  .filter((path) => !path.includes('_locales'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

test('locales: one for each language offered as a target, in Chrome folder names', () => {
  // zh-Hans / zh-Hant are zh_CN / zh_TW, and Chrome has no plain pt (pt_BR is used)
  const folder = (code: string) => ({ 'zh-Hans': 'zh_CN', 'zh-Hant': 'zh_TW', pt: 'pt_BR' })[code] ?? code;
  assert.deepEqual([...locales].sort(), TARGET_LANGUAGES.map(folder).sort());
});

test('locales: every locale has the same keys and placeholders as English', () => {
  for (const locale of locales) {
    const messages = messagesOf(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, { message, placeholders = {} }] of Object.entries(messages)) {
      assert.ok(message.trim(), `${locale}.${key} is empty`);
      const used = [...message.matchAll(/\$(\w+)\$/g)].map((match) => match[1].toLowerCase()).sort();
      assert.deepEqual(used, Object.keys(placeholders).sort(), `${locale}.${key} placeholders`);
      assert.deepEqual(Object.keys(placeholders).sort(), Object.keys(english[key].placeholders ?? {}).sort(), `${locale}.${key}`);
    }
  }
});

test('locales: the extension description fits in 132 characters (Chrome rejects longer ones)', () => {
  for (const locale of locales) assert.ok(messagesOf(locale).extDescription.message.length <= 132, locale);
});

test('locales: every key the code uses exists, and every key is used', () => {
  const used = new Set(
    [...sources.matchAll(/\bt\(\s*'(\w+)'|data-i18n="(\w+)"|__MSG_(\w+)__|\bkey: '(\w+)'/g)].map((match) => match.slice(1).find(Boolean)!)
  );
  for (const key of used) assert.ok(key in english, `missing message: ${key}`);
  for (const key of Object.keys(english)) assert.ok(used.has(key), `unused message: ${key}`);
});
