import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TARGET, languageName, sameLanguage, TARGET_LANGUAGES, targetLanguageOf } from '../src/core/languages.ts';

test('sameLanguage: same language and script, whatever the region', () => {
  assert.equal(sameLanguage('en-GB', 'en'), true);
  assert.equal(sameLanguage('pt-BR', 'pt'), true);
  assert.equal(sameLanguage('zh-TW', 'zh-Hant'), true);
  assert.equal(sameLanguage('zh-Hant', 'zh-Hans'), false);
  assert.equal(sameLanguage('zh', 'zh-Hans'), true);
  // YouTube still uses the old code for Hebrew
  assert.equal(sameLanguage('iw', 'he'), true);
  assert.equal(sameLanguage('ja', 'en'), false);
});

test('sameLanguage: a code Intl cannot read falls back to the language part', () => {
  assert.equal(sameLanguage('en-US-x', 'en'), true);
  assert.equal(sameLanguage('ja-!', 'en'), false);
});

test('languageName: in Japanese for the prompt, in the screen\'s language for the popup', () => {
  assert.equal(languageName('en', 'ja'), '英語');
  assert.equal(languageName('zh-Hant', 'ja'), '繁体中国語');
  assert.equal(languageName('ko', 'ko'), '한국어');
  assert.equal(languageName('not a code', 'ja'), 'not a code');
  // The popup's form keeps the script in parentheses, which is shorter in some languages
  assert.equal(languageName('zh-Hant', 'en', 'standard'), 'Chinese (Traditional)');
  assert.ok(languageName('zh-Hant', 'ru', 'standard').length < languageName('zh-Hant', 'ru').length);
});

test('targetLanguageOf: only offered languages, otherwise the default', () => {
  assert.equal(targetLanguageOf('ko'), 'ko');
  assert.equal(targetLanguageOf(undefined), DEFAULT_TARGET);
  assert.equal(targetLanguageOf('xx'), DEFAULT_TARGET);
  assert.equal(targetLanguageOf(42), DEFAULT_TARGET);
  assert.ok(TARGET_LANGUAGES.includes(DEFAULT_TARGET));
});
