// The toolbar popup: sign in with ChatGPT, see the account, sign out, and choose the language to translate into and
// where the translation goes. Sign-in only sends messages (the background does the work); the settings are saved directly.

import type { ServiceStatus } from '../core/chatgpt-service.ts';
import { languageName, TARGET_LANGUAGES } from '../core/languages.ts';
import { positionOf } from '../core/layout.ts';
import { previewLines } from '../core/preview.ts';
import { unlockName } from '../pages/unlock-name.ts';
import { localizePage, t, uiLanguage } from '../shared/i18n.ts';
import { loadPosition, loadTargetLanguage, savePosition, saveTargetLanguage } from '../shared/settings.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = ['gpt-sign-in', 'gpt-locked', 'gpt-signed-in'] as const;

const show = (screen: (typeof screens)[number]) => {
  for (const id of screens) $(id).hidden = id !== screen;
};

localizePage();
$('unlock').textContent = t('unlockWith', unlockName());

const showError = (text: string | null) => {
  $('error').hidden = text === null;
  $('error').textContent = text ?? '';
};

const send = async (type: string) => {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response?.ok) throw new Error(response?.code ?? 'error');
  return response as { status?: ServiceStatus };
};

const render = (status: ServiceStatus) => {
  if (!status.signedIn) return show(status.vault === 'locked' ? 'gpt-locked' : 'gpt-sign-in');
  $('account').textContent = status.label ?? '';
  $('saved').textContent =
    status.vault === 'unlocked'
      ? t('savedWith', unlockName())
      : t('signedOutOnClose');
  $('model-warning').hidden = status.modelAvailable !== false;
  show('gpt-signed-in');
};

const signIn = async () => {
  showError(null);
  try {
    // The sign-in opens in a new tab, which closes this popup
    await send('signIn');
  } catch (error) {
    showError(t('errSignInStart', (error as Error).message));
  }
};
$('sign-in').addEventListener('click', signIn);
$('sign-in-again').addEventListener('click', signIn);
// The passkey prompt would close the popup, so unlocking happens in a tab
$('unlock').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('unlock.html') }));

$('sign-out').addEventListener('click', async () => {
  showError(null);
  try {
    const { status } = await send('signOut');
    if (status) render(status);
  } catch (error) {
    showError(t('errSignOut', (error as Error).message));
  }
});

// Each language is listed by its name in the screen's language (Japanese, English, Korean, ... in English)
const target = $<HTMLSelectElement>('target');
const ui = uiLanguage();
for (const code of TARGET_LANGUAGES) {
  const name = languageName(code, ui, 'standard');
  target.add(new Option(name.charAt(0).toLocaleUpperCase(ui) + name.slice(1), code));
}
const position = $<HTMLSelectElement>('position');

// The preview shows a sample line and its translation in the chosen order, and the position icon follows the choice
const showPreview = () => {
  const chosen = positionOf(position.value);
  $('position-select').dataset.position = chosen;
  const lines = previewLines(target.value, chosen);
  (['preview-top', 'preview-bottom'] as const).forEach((id, i) => {
    const el = $(id);
    el.textContent = lines[i].text;
    el.lang = lines[i].lang;
    el.className = lines[i].role;
  });
};
showPreview();

// The selects stay off until the saved settings arrive, so a choice made meanwhile isn't overwritten by them
target.disabled = position.disabled = true;
Promise.all([loadTargetLanguage(), loadPosition()])
  .then(([code, value]) => {
    target.value = code;
    position.value = value;
  })
  .finally(() => {
    target.disabled = position.disabled = false;
    showPreview();
  });
// Open videos start over in the new language (the content script watches this setting)
target.addEventListener('change', () => {
  showError(null);
  showPreview();
  saveTargetLanguage(target.value).catch((error) => showError(t('errSaveTarget', (error as Error).message)));
});
// Under or over YouTube's captions; open videos move it right away (the content script watches this setting)
position.addEventListener('change', () => {
  showError(null);
  showPreview();
  savePosition(positionOf(position.value)).catch((error) => showError(t('errSavePosition', (error as Error).message)));
});

send('status')
  .then(({ status }) => render(status ?? { signedIn: false, vault: 'none' }))
  .catch((error) => {
    show('gpt-sign-in');
    showError(t('errStatus', (error as Error).message));
  });
