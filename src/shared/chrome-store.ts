// chrome.storage areas in the shape the core code expects

import type { KeyValueStore } from '../core/chatgpt-auth.ts';

export const storeOf = (area: chrome.storage.StorageArea): KeyValueStore => ({
  get: async <T>(key: string) => (await area.get(key))[key] as T | undefined,
  set: (key, value) => area.set({ [key]: value }),
  remove: (key) => area.remove(key),
});

export const localStore = () => storeOf(chrome.storage.local);
export const sessionStore = () => storeOf(chrome.storage.session);
