import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../src/core/errors.ts';
import { createVault, VAULT_KEYS } from '../src/core/vault.ts';
import { memoryStore } from './fakes.ts';

// What the passkey's PRF returns for our salt (the same every time for the same passkey)
const prf = new Uint8Array(32).fill(7);
const salt = new Uint8Array(32).fill(1);

const setup = () => {
  const local = memoryStore();
  let session = memoryStore();
  const vault = () => createVault({ local: local.store, session: session.store });
  // A browser restart clears session storage
  const restart = () => (session = memoryStore());
  return { local, vault, restart };
};

test('vault: seal and open round-trip, and only ciphertext reaches local storage', async () => {
  const { local, vault } = setup();
  assert.equal(await vault().state(), 'none');
  await vault().enroll('cred-1', salt, prf);
  await vault().seal('refresh-secret');
  assert.equal(await vault().state(), 'unlocked');
  assert.equal(await vault().open(), 'refresh-secret');
  assert.doesNotMatch(JSON.stringify([...local.data]), /refresh-secret/);
  assert.equal((await vault().meta())?.credentialId, 'cred-1');
});

test('vault: after a browser restart it is locked until the same passkey unlocks it', async () => {
  const { vault, restart } = setup();
  await vault().enroll('cred-1', salt, prf);
  await vault().seal('refresh-1');
  restart();
  assert.equal(await vault().state(), 'locked');
  await assert.rejects(vault().open(), (e: ProviderError) => e.code === 'login_required');
  await assert.rejects(vault().unlock(new Uint8Array(32).fill(8)), (e: ProviderError) => e.code === 'unlock_failed');
  await vault().unlock(prf);
  assert.equal(await vault().state(), 'unlocked');
  assert.equal(await vault().open(), 'refresh-1');
});

test('vault: a rotated token is sealed again without the passkey while unlocked; nothing is sealed while locked', async () => {
  const { local, vault, restart } = setup();
  await vault().enroll('cred-1', salt, prf);
  await vault().seal('refresh-1');
  await vault().seal('refresh-2');
  assert.equal(await vault().open(), 'refresh-2');
  restart();
  const before = local.data.get(VAULT_KEYS.sealed);
  await vault().seal('refresh-3');
  assert.deepEqual(local.data.get(VAULT_KEYS.sealed), before);
});

test('vault: clearToken forgets the sealed token but keeps the passkey for the next sign-in', async () => {
  const { vault, restart } = setup();
  await vault().enroll('cred-1', salt, prf);
  await vault().seal('refresh-1');
  await vault().clearToken();
  restart();
  assert.equal(await vault().state(), 'none');
  assert.equal((await vault().meta())?.credentialId, 'cred-1');
  // Unlocking with the kept passkey lets the next sign-in be sealed under the same data key
  await vault().unlock(prf);
  await vault().seal('refresh-2');
  assert.equal(await vault().open(), 'refresh-2');
});
