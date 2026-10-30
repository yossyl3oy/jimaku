// Opened from the popup after a browser restart: unlocks the saved sign-in with the passkey (Windows Hello / Touch ID).

import { ProviderError } from '../core/errors.ts';
import { passkeyErrorText, unlockPasskey } from '../pages/passkey.ts';
import { unlockName } from '../pages/unlock-name.ts';
import { START_HASH } from '../pages/unlock-start.ts';
import { localizePage, t } from '../shared/i18n.ts';

localizePage();

const page = document.querySelector('main')!;
const status = document.getElementById('status')!;
status.textContent = t('unlockBody', unlockName());
const button = document.getElementById('unlock') as HTMLButtonElement;

// False if the tab couldn't be closed
const closeTab = async (): Promise<boolean> => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) return false;
    await chrome.tabs.remove(tab.id);
    return true;
  } catch {
    return false;
  }
};

// started: opened by the popup's unlock button. Then the page stays blank behind the OS prompt and closes with it,
// and shows itself only when there is something to tell (an error other than cancelling the prompt)
const unlock = async (started = false) => {
  // Already prompting (the button and the automatic start can't overlap)
  if (button.disabled) return;
  button.disabled = true;
  try {
    await unlockPasskey();
    const response = await chrome.runtime.sendMessage({ type: 'unlock' });
    if (!response?.ok) throw new ProviderError(response?.code ?? 'error', response?.message ?? '');
    status.textContent = t('unlockedCloseTab');
    if (!(await closeTab())) page.hidden = false;
  } catch (error) {
    const cancelled = error instanceof ProviderError && error.code === 'passkey_cancelled';
    if (started && cancelled && (await closeTab())) return;
    status.textContent = passkeyErrorText(error);
    button.disabled = false;
    page.hidden = false;
  }
};
button.addEventListener('click', () => void unlock());

// Opened by the popup's unlock button: prompt right away, so that one click is enough (see START_HASH)
if (location.hash === START_HASH) {
  history.replaceState(null, '', location.pathname);
  // WebAuthn needs the page to have focus, which it gets once the popup has closed
  if (document.hasFocus()) void unlock(true);
  else window.addEventListener('focus', () => void unlock(true), { once: true });
} else {
  page.hidden = false;
}
