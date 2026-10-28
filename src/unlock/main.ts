// Opened from the popup after a browser restart: unlocks the saved sign-in with the passkey (Windows Hello / Touch ID).

import { ProviderError } from '../core/errors.ts';
import { passkeyErrorText, unlockPasskey } from '../pages/passkey.ts';
import { unlockName } from '../pages/unlock-name.ts';
import { localizePage, t } from '../shared/i18n.ts';

localizePage();

const status = document.getElementById('status')!;
status.textContent = t('unlockBody', unlockName());
const button = document.getElementById('unlock') as HTMLButtonElement;

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await unlockPasskey();
    const response = await chrome.runtime.sendMessage({ type: 'unlock' });
    if (!response?.ok) throw new ProviderError(response?.code ?? 'error', response?.message ?? '');
    status.textContent = t('unlockedCloseTab');
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  } catch (error) {
    status.textContent = passkeyErrorText(error);
    button.disabled = false;
  }
});
