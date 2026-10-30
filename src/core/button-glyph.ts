// The character on jimaku's button, chosen by the language translated into: 訳 for Japanese, a character of its own
// for Korean, Chinese and Russian, and the language code for the others.
// Sizes and baselines fit each one inside the button's 24x24 icon (the frame drawn while off leaves an 18x14 inside):
// one character at 13px, two letters at 11px so the widest code (TH) stays clear of the frame.

import { DEFAULT_TARGET } from './languages.ts';

export type ButtonGlyph = { text: string; fontSize: number; y: number; fontFamily: string };

// Fonts on macOS, then Windows, then the Noto ones elsewhere. Roboto is the one YouTube loads for its own page
const FONTS = {
  ja: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
  ko: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
  zhHans: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  zhHant: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif',
  latin: 'Roboto, Arial, sans-serif',
};

// The baselines center each glyph's ink on the icon's middle (y = 12)
const character = (text: string, fontFamily: string, y = 16.8): ButtonGlyph => ({ text, fontSize: 13, y, fontFamily });
const code = (text: string): ButtonGlyph => ({ text, fontSize: 11, y: 15.9, fontFamily: FONTS.latin });

const GLYPHS: Record<string, ButtonGlyph> = {
  ja: character('訳', FONTS.ja),
  en: code('EN'),
  ko: character('역', FONTS.ko),
  'zh-Hans': character('中', FONTS.zhHans),
  'zh-Hant': character('中', FONTS.zhHant),
  es: code('ES'),
  fr: code('FR'),
  de: code('DE'),
  pt: code('PT'),
  it: code('IT'),
  // Capitals sit on the baseline with nothing below it, so it goes a little higher than the CJK ones
  ru: character('П', FONTS.latin, 16.7),
  vi: code('VI'),
  th: code('TH'),
  id: code('ID'),
};

export const buttonGlyphOf = (target: string): ButtonGlyph => GLYPHS[target] ?? GLYPHS[DEFAULT_TARGET];
