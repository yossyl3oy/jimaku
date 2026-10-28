// A session rule in the background redirects OpenAI's loopback sign-in callback to this page.
// It hands the query string to the background, which finishes the sign-in, then offers to save the sign-in
// behind a passkey (Windows Hello / Touch ID).

import { ProviderError } from '../core/errors.ts';
import { passkeyErrorText, setUpPasskey } from '../pages/passkey.ts';
import { unlockName } from '../pages/unlock-name.ts';
import { localizePage, t } from '../shared/i18n.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const search = location.search;
// Drop the authorization code from the address bar and history before anything else
history.replaceState(null, '', location.pathname);
localizePage();

const say = (text: string) => ($('status').textContent = text);
$('save-question').textContent = t('saveQuestion', unlockName());
$('save-explain').textContent = t('saveExplain', unlockName());

const closeTab = async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
};

const save = async (fresh: boolean) => {
  for (const id of ['save-yes', 'save-no', 'save-fresh']) $<HTMLButtonElement>(id).disabled = true;
  try {
    await setUpPasskey({ fresh });
    const response = await chrome.runtime.sendMessage({ type: 'saveToVault' });
    if (!response?.ok) throw new ProviderError(response?.code ?? 'error', response?.message ?? '');
    $('save').hidden = true;
    say(t('savedCloseTab'));
    await closeTab();
  } catch (error) {
    say(passkeyErrorText(error));
    // When the existing passkey cannot be used (deleted from the OS, etc.), a new one can be made instead
    $('save-fresh').hidden = fresh;
    for (const id of ['save-yes', 'save-no', 'save-fresh']) $<HTMLButtonElement>(id).disabled = false;
  }
};

const finish = async () => {
  const response = await chrome.runtime.sendMessage({ type: 'callback', search }).catch(() => undefined);
  if (!response?.ok) {
    say(t('signInFailed', response?.code ?? 'error'));
    return;
  }
  if (!response.accepted) {
    say(t('signInExpired'));
    return;
  }
  // Already unlocked in this browser session: the new tokens were sealed by the background
  if (response.status?.vault === 'unlocked') {
    say(t('signedInCloseTab'));
    await closeTab();
    return;
  }
  say(t('signedIn'));
  $('save').hidden = false;
};

$('save-yes').addEventListener('click', () => void save(false));
$('save-fresh').addEventListener('click', () => void save(true));
$('save-no').addEventListener('click', () => void closeTab());
void finish();
