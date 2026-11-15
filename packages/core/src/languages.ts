// The languages jimaku translates between. Codes are BCP 47 tags, as in YouTube's caption tracks ('en', 'en-GB', 'zh-Hant', ...).
// The source language comes from the caption track; the target is chosen in the popup.

export type Languages = { source: string; target: string };

// Offered in the popup, in this order
export const TARGET_LANGUAGES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th', 'id'];
export const DEFAULT_TARGET = 'ja';

// A stored value as a target language (anything else, such as nothing stored yet, is the default)
export const targetLanguageOf = (value: unknown): string =>
  typeof value === 'string' && TARGET_LANGUAGES.includes(value) ? value : DEFAULT_TARGET;

const maximized = (code: string) => {
  try {
    return new Intl.Locale(code).maximize();
  } catch {
    return undefined;
  }
};

// Same language and script: 'en-GB' and 'en' are the same, 'zh-Hant' and 'zh-Hans' are not, 'zh-TW' is 'zh-Hant'
export const sameLanguage = (a: string, b: string): boolean => {
  const [x, y] = [maximized(a), maximized(b)];
  if (!x || !y) return a.split('-')[0].toLowerCase() === b.split('-')[0].toLowerCase();
  return x.language === y.language && x.script === y.script;
};

// The language's name written in the given language: in Japanese for the prompt ('en' → 英語, 'zh-Hant' → 繁体中国語).
// standard puts the script or region in parentheses ('zh-Hant' → 中国語 (繁体字)), which keeps names short enough for
// the popup in every language (Russian's default for Chinese is long)
export const languageName = (code: string, inLanguage: string, display: 'dialect' | 'standard' = 'dialect'): string => {
  try {
    return new Intl.DisplayNames(inLanguage, { type: 'language', languageDisplay: display }).of(code) ?? code;
  } catch {
    return code;
  }
};
