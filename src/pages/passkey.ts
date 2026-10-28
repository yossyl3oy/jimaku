// The passkey (Windows Hello / Touch ID) whose WebAuthn PRF output unlocks the saved sign-in (src/core/vault.ts).
// WebAuthn needs a focused page, so this runs in an extension tab (not the popup, which closes when the OS prompt
// appears, and not the service worker, which has no navigator.credentials).
// The relying party is the extension itself (chrome-extension://<id>), so the passkey works only for jimaku.

import { fromBase64url, toBase64url, type Bytes } from '../core/base64url.ts';
import { ProviderError } from '../core/errors.ts';
import { createVault } from '../core/vault.ts';
import { localStore, sessionStore } from '../shared/chrome-store.ts';
import { t } from '../shared/i18n.ts';
import { unlockName } from './unlock-name.ts';

const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));

type PrfResults = { enabled?: boolean; results?: { first?: BufferSource } };
const prfOf = (credential: Credential | null): PrfResults | undefined =>
  (credential as PublicKeyCredential | null)?.getClientExtensionResults().prf as PrfResults | undefined;
const bytesOf = (source: BufferSource): Bytes =>
  source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);

// Turns the user cancelling the OS prompt into an error code the pages can show
const ceremony = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new ProviderError('passkey_cancelled', 'The passkey prompt was cancelled');
    }
    throw error;
  }
};

const evaluate = (credentialId: string, salt: Bytes) =>
  ceremony(async () => {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: fromBase64url(credentialId) }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const first = prfOf(credential)?.results?.first;
    if (!first) throw new ProviderError('prf_unsupported', 'This passkey cannot derive a key (WebAuthn PRF)');
    return bytesOf(first);
  });

const create = (salt: Bytes) =>
  ceremony(async () => {
    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'jimaku' },
        user: { id: random(16), name: 'jimaku', displayName: 'jimaku' },
        challenge: random(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        extensions: { prf: { eval: { first: salt } } },
      },
    });
    const prf = prfOf(credential);
    if (!credential || !prf?.enabled) throw new ProviderError('prf_unsupported', 'This device cannot derive a key (WebAuthn PRF)');
    const credentialId = toBase64url(new Uint8Array((credential as PublicKeyCredential).rawId));
    // Some authenticators return the PRF output only on a later assertion, which is a second prompt
    const output = prf.results?.first ? bytesOf(prf.results.first) : await evaluate(credentialId, salt);
    return { credentialId, output };
  });

const vault = () => createVault({ local: localStore(), session: sessionStore() });

// Makes the data key available in memory: unlocks the existing passkey, or sets up a new one.
// fresh skips the existing passkey (deleted from the OS, for example).
export const setUpPasskey = async ({ fresh = false } = {}): Promise<void> => {
  const meta = fresh ? undefined : await vault().meta();
  if (meta) {
    try {
      await vault().unlock(await evaluate(meta.credentialId, fromBase64url(meta.salt)));
      return;
    } catch (error) {
      // The passkey was deleted from the OS, or no longer matches: set up a new one below
      if (!(error instanceof ProviderError) || error.code === 'passkey_cancelled') throw error;
    }
  }
  const salt = random(32);
  const { credentialId, output } = await create(salt);
  await vault().enroll(credentialId, salt, output);
};

export const unlockPasskey = async (): Promise<void> => {
  const meta = await vault().meta();
  if (!meta) throw new ProviderError('vault_missing', 'No passkey is set up');
  await vault().unlock(await evaluate(meta.credentialId, fromBase64url(meta.salt)));
};

// What to tell the user when a passkey step fails
export const passkeyErrorText = (error: unknown): string => {
  const code = error instanceof ProviderError ? error.code : 'error';
  switch (code) {
    case 'passkey_cancelled':
      return t('passkeyCancelled');
    case 'prf_unsupported':
      return t('prfUnsupported', unlockName());
    case 'unlock_failed':
      return t('unlockFailed');
    case 'invalid_grant':
      return t('savedSignInExpired');
    default:
      return t('somethingWentWrong', code);
  }
};
