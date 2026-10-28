// What the background service worker offers: ChatGPT sign-in (chatgpt-auth.ts) plus the passkey-encrypted copy of
// the refresh token (vault.ts). Without chrome.*, so the combination is testable.

import { createChatGPTAuth, STORAGE_KEYS, type Account, type AuthOptions, type AuthStatus } from './chatgpt-auth.ts';
import { ProviderError } from './errors.ts';
import { createVault, type VaultState } from './vault.ts';

export type ServiceStatus = AuthStatus & { vault: VaultState };

export const createChatGPTService = (options: Omit<AuthOptions, 'onTokens'>) => {
  const { local, session } = options;
  const now = options.now ?? Date.now;
  const vault = createVault({ local, session });
  // Every token change is mirrored into the vault: sealed while it is unlocked, forgotten when signed out
  const auth = createChatGPTAuth({
    ...options,
    onTokens: (tokens) => (tokens ? vault.seal(tokens.refreshToken) : vault.clearToken()),
  });
  // Lets open videos start again (the content script watches this key)
  const announceSignIn = () => local.set(STORAGE_KEYS.signedInAt, now());

  return {
    beginSignIn: auth.beginSignIn,

    async completeSignIn(callback: URL): Promise<boolean> {
      const accepted = await auth.completeSignIn(callback);
      if (!accepted) return false;
      // Still locked means the new tokens could not be sealed, so the sealed token is from before this sign-in: drop it.
      // (If another tab unlocked meanwhile, its restore sealed the new tokens and the vault is no longer locked.)
      // The passkey stays; the callback page offers to unlock it and seal the new tokens.
      if ((await vault.state()) === 'locked') await vault.clearToken();
      await announceSignIn();
      return true;
    },

    // Throws locked (instead of login_required) when a saved sign-in only needs Windows Hello / Touch ID,
    // and model_unavailable when the sign-in found the fixed model missing from the account's catalog
    async accessToken(): Promise<string> {
      if ((await local.get<Account>(STORAGE_KEYS.account))?.modelAvailable === false) {
        throw new ProviderError('model_unavailable', 'The translation model is not available for this account');
      }
      try {
        return await auth.accessToken();
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'login_required' && (await vault.state()) === 'locked') {
          throw new ProviderError('locked', 'Unlock jimaku with your passkey');
        }
        throw error;
      }
    },

    async status(): Promise<ServiceStatus> {
      return { ...(await auth.status()), vault: await vault.state() };
    },

    // After an extension page set up or unlocked the passkey (the data key is now in session storage):
    // seals the current tokens
    saveToVault: () => auth.resave(),

    // After an extension page unlocked the passkey on a fresh browser: signs in from the saved refresh token
    async unlock(): Promise<void> {
      await auth.restore(() => vault.open());
      await announceSignIn();
    },

    async signOut(): Promise<void> {
      await auth.signOut();
      await local.remove(STORAGE_KEYS.signedInAt);
    },
  };
};

export type ChatGPTService = ReturnType<typeof createChatGPTService>;
