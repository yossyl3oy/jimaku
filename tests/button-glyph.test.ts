import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonGlyphOf } from '../src/core/button-glyph.ts';
import { DEFAULT_TARGET, TARGET_LANGUAGES } from '../src/core/languages.ts';

test('buttonGlyphOf: 訳 for Japanese, its own character or the language code for the others', () => {
  assert.equal(buttonGlyphOf('ja').text, '訳');
  assert.equal(buttonGlyphOf('ko').text, '역');
  assert.equal(buttonGlyphOf('zh-Hans').text, '中');
  assert.equal(buttonGlyphOf('zh-Hant').text, '中');
  assert.equal(buttonGlyphOf('ru').text, 'П');
  assert.equal(buttonGlyphOf('en').text, 'EN');
  assert.equal(buttonGlyphOf('th').text, 'TH');
});

test('buttonGlyphOf: every offered language has a glyph of its own', () => {
  // A language left out would fall back to the default's 訳
  assert.deepEqual(
    TARGET_LANGUAGES.filter((code) => buttonGlyphOf(code) === buttonGlyphOf(DEFAULT_TARGET)),
    [DEFAULT_TARGET]
  );
});

test('buttonGlyphOf: Simplified and Traditional Chinese share 中 but not the font', () => {
  assert.notEqual(buttonGlyphOf('zh-Hans').fontFamily, buttonGlyphOf('zh-Hant').fontFamily);
});

test('buttonGlyphOf: a language not offered gets the default glyph', () => {
  assert.equal(buttonGlyphOf('xx'), buttonGlyphOf(DEFAULT_TARGET));
});
