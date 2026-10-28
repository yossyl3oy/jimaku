// The extension's own text in the browser's language, from public/_locales/<locale>/messages.json (English when that
// language has none). The prompt sent to ChatGPT is not UI text and stays in src/core/prompt.ts.

export const t = (key: string, ...substitutions: string[]): string => chrome.i18n.getMessage(key, substitutions);

export const uiLanguage = (): string => chrome.i18n.getUILanguage();

// Pages mark their static text with a data-i18n attribute naming the message; the HTML holds the English text in case
// this doesn't run
export const localizePage = () => {
  document.documentElement.lang = uiLanguage();
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
};
