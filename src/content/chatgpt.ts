// The ChatGPT plan translator seen from the content script. The request itself runs in the background service worker
// (src/background/main.ts), because CORS blocks the API from the content script; the text comes back over a port.

import { STORAGE_KEYS } from '../core/chatgpt-auth.ts';
import { ProviderError } from '../core/errors.ts';
import type { Languages } from '../core/languages.ts';
import { createPromptTranslator } from '../core/prompt.ts';
import { portStream, TRANSLATE_PORT } from '../core/port-stream.ts';
import type { Translator } from '../core/translator.ts';

// False once the extension is reloaded or updated: this script keeps running in the open tab, but it is cut off from
// the extension (chrome.runtime.id is gone) and chrome.runtime calls throw "Extension context invalidated"
export const extensionAlive = () => Boolean(chrome.runtime?.id);

// Wakes the service worker and refreshes the access token ahead of the first request
export const warmUpChatGPT = () => {
  if (extensionAlive()) chrome.runtime.sendMessage({ type: 'warmup' }).catch(() => {});
};

const connect = () => {
  // Fatal, so the session stops instead of failing chunk after chunk
  if (!extensionAlive()) throw new ProviderError('extension_reloaded', 'The extension was reloaded');
  return chrome.runtime.connect({ name: TRANSLATE_PORT });
};

export const createChatGPTTranslator = (languages: Languages): Translator =>
  createPromptTranslator(portStream(connect), languages, warmUpChatGPT);

export const watchSignIn = (onSignIn: () => void) => {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.signedInAt]?.newValue) onSignIn();
  });
};
