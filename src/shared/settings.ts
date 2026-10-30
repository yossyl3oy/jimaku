// Remembers jimaku's on/off, the language to translate into and where the translation goes. They live in the extension's
// chrome.storage, so YouTube's own storage stays untouched. The content script reads them; the popup sets the last two.

import { enabledOf } from '../core/controller.ts';
import { targetLanguageOf } from '../core/languages.ts';
import { positionOf, type Position } from '../core/layout.ts';

const KEY = 'enabled';
const TARGET_KEY = 'targetLanguage';
const POSITION_KEY = 'translationPosition';

// Off until it is turned on (see DEFAULT_ENABLED)
export const loadEnabled = async (): Promise<boolean> => enabledOf((await chrome.storage.local.get(KEY))[KEY]);

export const saveEnabled = (enabled: boolean): Promise<void> => chrome.storage.local.set({ [KEY]: enabled });

// Stay in sync when it is switched in another tab
export const watchEnabled = (onChange: (enabled: boolean) => void) => {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) onChange(enabledOf(changes[KEY].newValue));
  });
};

export const loadTargetLanguage = async (): Promise<string> =>
  targetLanguageOf((await chrome.storage.local.get(TARGET_KEY))[TARGET_KEY]);

export const saveTargetLanguage = (code: string): Promise<void> => chrome.storage.local.set({ [TARGET_KEY]: code });

export const watchTargetLanguage = (onChange: (code: string) => void) => {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && TARGET_KEY in changes) onChange(targetLanguageOf(changes[TARGET_KEY].newValue));
  });
};

// Under or over YouTube's captions (under by default)
export const loadPosition = async (): Promise<Position> =>
  positionOf((await chrome.storage.local.get(POSITION_KEY))[POSITION_KEY]);

export const savePosition = (position: Position): Promise<void> => chrome.storage.local.set({ [POSITION_KEY]: position });

export const watchPosition = (onChange: (position: Position) => void) => {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && POSITION_KEY in changes) onChange(positionOf(changes[POSITION_KEY].newValue));
  });
};
