// Keeps the refresh token on disk only in encrypted form, so a browser restart needs Windows Hello / Touch ID
// instead of a new sign-in. Without chrome.* or the DOM; the passkey part (WebAuthn PRF) is in src/pages/passkey.ts.
//
// Keys:
// - The data key encrypts the refresh token. It is random, and outside memory it exists only wrapped.
// - The wrapping key is derived from the passkey's PRF output, which the authenticator returns only after the user
//   passes Windows Hello / Touch ID. It is never stored.
// Stored in local: the passkey's ID, the PRF salt, the wrapped data key and the encrypted refresh token.
// Stored in session (memory, cleared on browser restart): the data key, so a rotated refresh token can be sealed again
// without asking the user.

import { fromBase64url, toBase64url, type Bytes } from './base64url.ts';
import type { KeyValueStore } from './chatgpt-auth.ts';
import { ProviderError } from './errors.ts';

export const VAULT_KEYS = { meta: 'vault', sealed: 'vaultToken', dataKey: 'vaultKey' } as const;
const INFO = new TextEncoder().encode('jimaku token vault v1');

type Sealed = { iv: string; data: string };

export type VaultMeta = {
  credentialId: string;
  salt: string;
  wrappedKey: Sealed;
};

// 'none': no passkey set up. 'locked': a sealed token waits for the passkey. 'unlocked': the data key is in memory.
export type VaultState = 'none' | 'locked' | 'unlocked';

const wrappingKey = async (prfOutput: Bytes) => {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: INFO },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

const encrypt = async (key: CryptoKey, plain: Bytes): Promise<Sealed> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv: toBase64url(iv), data: toBase64url(data) };
};

const decrypt = async (key: CryptoKey, sealed: Sealed) =>
  new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(sealed.iv) }, key, fromBase64url(sealed.data)));

const importDataKey = (raw: Bytes) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export const createVault = ({ local, session }: { local: KeyValueStore; session: KeyValueStore }) => {
  const dataKey = async () => {
    const raw = await session.get<string>(VAULT_KEYS.dataKey);
    return raw ? importDataKey(fromBase64url(raw)) : undefined;
  };

  return {
    async state(): Promise<VaultState> {
      if (await session.get(VAULT_KEYS.dataKey)) return 'unlocked';
      const [meta, sealed] = await Promise.all([local.get(VAULT_KEYS.meta), local.get(VAULT_KEYS.sealed)]);
      return meta && sealed ? 'locked' : 'none';
    },

    meta: () => local.get<VaultMeta>(VAULT_KEYS.meta),

    // Sets up a new passkey: a fresh data key, wrapped with the key from its PRF output
    async enroll(credentialId: string, salt: Bytes, prfOutput: Bytes): Promise<void> {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const wrappedKey = await encrypt(await wrappingKey(prfOutput), raw);
      await local.remove(VAULT_KEYS.sealed);
      await local.set(VAULT_KEYS.meta, { credentialId, salt: toBase64url(salt), wrappedKey } satisfies VaultMeta);
      await session.set(VAULT_KEYS.dataKey, toBase64url(raw));
    },

    // Unwraps the data key with the passkey's PRF output and keeps it in memory
    async unlock(prfOutput: Bytes): Promise<void> {
      const meta = await local.get<VaultMeta>(VAULT_KEYS.meta);
      if (!meta) throw new ProviderError('vault_missing', 'No passkey is set up');
      let raw: Bytes;
      try {
        raw = await decrypt(await wrappingKey(prfOutput), meta.wrappedKey);
      } catch {
        throw new ProviderError('unlock_failed', 'The passkey did not unlock the saved sign-in');
      }
      await session.set(VAULT_KEYS.dataKey, toBase64url(raw));
    },

    // Encrypts the refresh token to disk. Does nothing while locked or without a passkey
    async seal(refreshToken: string): Promise<void> {
      const key = await dataKey();
      if (!key) return;
      await local.set(VAULT_KEYS.sealed, await encrypt(key, new TextEncoder().encode(refreshToken)));
    },

    // The saved refresh token (needs the vault unlocked)
    async open(): Promise<string> {
      const [key, sealed] = await Promise.all([dataKey(), local.get<Sealed>(VAULT_KEYS.sealed)]);
      if (!key || !sealed) throw new ProviderError('login_required', 'No saved sign-in to open');
      try {
        return new TextDecoder().decode(await decrypt(key, sealed));
      } catch {
        throw new ProviderError('unlock_failed', 'The saved sign-in could not be decrypted');
      }
    },

    // Forgets the saved refresh token (signed out or no longer valid). The passkey stays for the next sign-in.
    clearToken: () => local.remove(VAULT_KEYS.sealed),
  };
};

export type Vault = ReturnType<typeof createVault>;
