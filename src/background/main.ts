// Background service worker: signs in to ChatGPT, keeps the tokens, and runs the translation requests for the content script.
// Every listener is registered at the top level, so a worker woken by an event finds them.

import { API, chatGPTStream } from '../core/chatgpt-responses.ts';
import { createChatGPTService } from '../core/chatgpt-service.ts';
import { ProviderError } from '../core/errors.ts';
import { servePort, TRANSLATE_PORT } from '../core/port-stream.ts';
import { cacheLoadRequest, cacheSaveRequest, createTranslationStore } from '../core/translation-cache.ts';
import { localStore, sessionStore } from '../shared/chrome-store.ts';

const service = createChatGPTService({ local: localStore(), session: sessionStore() });
// The translations every tab shares (see translation-cache.ts)
const translations = createTranslationStore(sessionStore());

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === TRANSLATE_PORT) servePort(port, chatGPTStream(() => service.accessToken()));
});

// OpenAI's flow returns to http://127.0.0.1:<port>/auth/callback. Nothing listens there: a session rule redirects that
// navigation to the extension's callback page before Chrome connects, and the page sends the query string here.
// Only the port may vary between sign-ins. The sign-in in progress is kept in session storage, so a worker that
// stopped while the user was signing in can still finish it. (Rewritten from rokrokss/shizue@c2ebc51
// src/services/background/chatgpt.ts.)
const CALLBACK_RULE_ID = 1;

const signIn = async () => {
  const port = 49152 + (crypto.getRandomValues(new Uint16Array(1))[0] % 16384);
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CALLBACK_RULE_ID],
    addRules: [
      {
        id: CALLBACK_RULE_ID,
        priority: 1,
        condition: { urlFilter: `|${redirectUri}`, resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME] },
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect: { transform: { scheme: 'chrome-extension', host: chrome.runtime.id, port: '', path: '/callback.html' } },
        },
      },
    ],
  });
  await chrome.tabs.create({ url: await service.beginSignIn(redirectUri) });
};

// The rule is removed only by the sign-in it was made for: a callback with another state (an old tab, or a page that
// opened callback.html itself) returns false and leaves it in place.
const finishSignIn = async (search: string) => {
  const removeRule = () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [CALLBACK_RULE_ID] });
  let accepted;
  try {
    accepted = await service.completeSignIn(new URL(`http://127.0.0.1/auth/callback${search}`));
  } catch (error) {
    await removeRule();
    throw error;
  }
  if (accepted) await removeRule();
  return accepted;
};

// Opens the connection to the API while the content script is still getting the captions, so the first translation
// request skips the TLS handshake (the worker's own fetches share one connection pool; a page's preconnect would not
// help). It sends no credentials and only gets a 401 back. At most once every 30 seconds.
let warmedAt = 0;
const warmConnection = () => {
  if (Date.now() - warmedAt < 30_000) return;
  warmedAt = Date.now();
  fetch(`${API}/models`, { method: 'HEAD' }).catch(() => {});
};

type Message =
  | { type: 'status' | 'warmup' | 'signIn' | 'signOut' | 'saveToVault' | 'unlock' }
  | { type: 'callback'; search: string }
  | { type: 'cacheLoad'; key?: unknown; sources?: unknown }
  | { type: 'cacheSave'; key?: unknown; generation?: unknown; updates?: unknown };

// Everything but warmup and the translation cache comes only from the extension's own pages (popup, callback, unlock),
// not from content scripts
const fromExtensionPage = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')) === true;

const handle = async (message: Message, sender: chrome.runtime.MessageSender): Promise<object> => {
  if (message.type === 'warmup') {
    warmConnection();
    await service.accessToken().catch(() => {});
    return {};
  }
  // The content scripts read and add translations only through these, never the storage itself (it holds the tokens)
  if (message.type === 'cacheLoad') {
    const request = cacheLoadRequest(message);
    if (!request) throw new ProviderError('invalid_message', 'Invalid cache request');
    const { generation, translations: lines } = await translations.load(request.key, request.sources);
    // Sent as null where there is none, since a message can't carry undefined in an array
    return { generation, translations: lines.map((line) => line ?? null) };
  }
  if (message.type === 'cacheSave') {
    const request = cacheSaveRequest(message);
    if (!request) throw new ProviderError('invalid_message', 'Invalid cache request');
    await translations.save(request.key, request.generation, request.updates);
    return {};
  }
  if (!fromExtensionPage(sender)) throw new ProviderError('forbidden', 'Not allowed from this page');
  switch (message.type) {
    case 'status':
      return { status: await service.status() };
    case 'signIn':
      await signIn();
      return {};
    case 'signOut':
      await service.signOut();
      return { status: await service.status() };
    case 'callback': {
      if (typeof message.search !== 'string' || !message.search.startsWith('?')) return { accepted: false };
      const accepted = await finishSignIn(message.search);
      return { accepted, status: await service.status() };
    }
    case 'saveToVault':
      await service.saveToVault();
      return { status: await service.status() };
    case 'unlock':
      await service.unlock();
      return { status: await service.status() };
  }
  throw new ProviderError('unknown_message', 'Unknown message');
};

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handle(message, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) =>
      sendResponse({
        ok: false,
        code: error instanceof ProviderError ? error.code : 'error',
        message: error instanceof Error ? error.message : String(error),
      })
  );
  return true;
});
