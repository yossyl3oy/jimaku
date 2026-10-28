// The popup's preview of where the translation goes: a sample source line and its translation, in the chosen order.

import { sameLanguage } from './languages.ts';
import type { Position } from './layout.ts';

// "Hello, world." in each language offered as a target
export const PREVIEW_SAMPLES: Record<string, string> = {
  ja: 'こんにちは、世界。',
  en: 'Hello, world.',
  ko: '안녕하세요, 세계.',
  'zh-Hans': '你好，世界。',
  'zh-Hant': '你好，世界。',
  es: 'Hola, mundo.',
  fr: 'Bonjour le monde.',
  de: 'Hallo, Welt.',
  pt: 'Olá, mundo.',
  it: 'Ciao, mondo.',
  ru: 'Привет, мир.',
  vi: 'Xin chào, thế giới.',
  th: 'สวัสดีชาวโลก',
  id: 'Halo, dunia.',
};

export type PreviewLine = { role: 'source' | 'translation'; lang: string; text: string };

// The two lines from top to bottom. The source is English, or Japanese when translating into English.
export const previewLines = (target: string, position: Position): PreviewLine[] => {
  const sourceLang = sameLanguage(target, 'en') ? 'ja' : 'en';
  const source: PreviewLine = { role: 'source', lang: sourceLang, text: PREVIEW_SAMPLES[sourceLang] };
  const translation: PreviewLine = { role: 'translation', lang: target, text: PREVIEW_SAMPLES[target] ?? PREVIEW_SAMPLES.en };
  return position === 'below' ? [source, translation] : [translation, source];
};
