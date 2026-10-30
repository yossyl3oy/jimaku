import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORAGE_KEYS, type Account } from '../src/core/chatgpt-auth.ts';
import { createChatGPTService } from '../src/core/chatgpt-service.ts';
import { isFatalError, ProviderError } from '../src/core/errors.ts';
import { createVault } from '../src/core/vault.ts';
import { authorizeWith, fakeOpenAI, memoryStore } from './fakes.ts';

const prf = new Uint8Array(32).fill(7);
const salt = new Uint8Array(32).fill(1);

const setup = () => {
  let time = 1_000_000_000_000;
  const now = () => time;
  const local = memoryStore();
  let session = memoryStore();
  const openai = fakeOpenAI(now);
  const make = () => createChatGPTService({ local: local.store, session: session.store, fetch: openai.fetch, now });
  let service = make();
  // What the extension page does with the passkey (WebAuthn PRF is not available here)
  const vault = () => createVault({ local: local.store, session: session.store });
  const restartBrowser = () => {
    session = memoryStore();
    service = make();
  };
  return {
    local,
    openai,
    vault,
    restartBrowser,
    service: () => service,
    signIn: async () => service.completeSignIn((await authorizeWith(service, openai)).callback),
    advance: (ms: number) => (time += ms),
  };
};

test('service: without a passkey, a browser restart needs a new sign-in (login_required)', async () => {
  const t = setup();
  await t.signIn();
  assert.equal(await t.service().accessToken(), 'access-1');
  t.restartBrowser();
  await assert.rejects(t.service().accessToken(), (e: ProviderError) => e.code === 'login_required');
  assert.deepEqual(await t.service().status(), { signedIn: false, vault: 'none' });
});

test('service: with a passkey, a browser restart is locked, and unlocking signs in from the saved token', async () => {
  const t = setup();
  await t.signIn();
  await t.vault().enroll('cred-1', salt, prf);
  await t.service().saveToVault();
  assert.equal((await t.service().status()).vault, 'unlocked');

  t.restartBrowser();
  await assert.rejects(t.service().accessToken(), (e: ProviderError) => e.code === 'locked');
  assert.deepEqual(await t.service().status(), { signedIn: false, vault: 'locked' });

  await t.vault().unlock(prf);
  await t.service().unlock();
  assert.equal(await t.service().accessToken(), 'access-2');
  const refresh = t.openai.state.requests.findLast((r) => r.body?.get('grant_type') === 'refresh_token')!;
  assert.equal(refresh.body!.get('refresh_token'), 'refresh-1');
});

test('service: a refresh that rotates the token keeps the sealed copy current', async () => {
  const t = setup();
  await t.signIn();
  await t.vault().enroll('cred-1', salt, prf);
  await t.service().saveToVault();
  t.advance(3600_000);
  await t.service().accessToken();
  assert.equal(await t.vault().open(), 'refresh-2');
});

test('service: signing in again while locked drops the old sealed token but keeps the passkey', async () => {
  const t = setup();
  await t.signIn();
  await t.vault().enroll('cred-1', salt, prf);
  await t.service().saveToVault();
  t.restartBrowser();
  await t.signIn();
  assert.deepEqual(await t.service().status(), { signedIn: true, label: 'cat@example.com', modelAvailable: true, vault: 'none' });
  assert.equal((await t.vault().meta())?.credentialId, 'cred-1');
  // Unlocking the kept passkey seals the new sign-in
  await t.vault().unlock(prf);
  await t.service().saveToVault();
  assert.equal(await t.vault().open(), 'refresh-2');
});

test('service: sign-in announces itself for open videos; sign-out forgets the sealed token', async () => {
  const t = setup();
  await t.signIn();
  assert.ok(t.local.data.get(STORAGE_KEYS.signedInAt));
  await t.vault().enroll('cred-1', salt, prf);
  await t.service().saveToVault();
  await t.service().signOut();
  assert.equal(t.local.data.has(STORAGE_KEYS.signedInAt), false);
  t.restartBrowser();
  assert.deepEqual(await t.service().status(), { signedIn: false, vault: 'none' });
});

test('service: a saved token that no longer works is forgotten on unlock (invalid_grant)', async () => {
  const t = setup();
  await t.signIn();
  await t.vault().enroll('cred-1', salt, prf);
  await t.service().saveToVault();
  t.restartBrowser();
  await t.vault().unlock(prf);
  t.openai.state.refreshError = 'invalid_grant';
  await assert.rejects(t.service().unlock(), (e: ProviderError) => e.code === 'invalid_grant');
  t.restartBrowser();
  assert.equal((await t.service().status()).vault, 'none');
});

test('service: two unlocks at once spend the saved token once and both succeed', async () => {
  const t = setup();
  await t.signIn();
  await t.vault().enroll('cred-1', salt, prf);
  await t.service().saveToVault();
  t.restartBrowser();
  await t.vault().unlock(prf);
  await Promise.all([t.service().unlock(), t.service().unlock()]);
  const refreshes = t.openai.state.requests.filter((r) => r.body?.get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.equal((await t.service().status()).signedIn, true);
  assert.equal(await t.vault().open(), 'refresh-2');
});

test('service: when the sign-in found the fixed model missing, translation stops with model_unavailable (fatal)', async () => {
  const t = setup();
  t.openai.state.models = [{ slug: 'other', visibility: 'list' }];
  await t.signIn();
  await assert.rejects(t.service().accessToken(), (e: ProviderError) => e.code === 'model_unavailable' && isFatalError(e));
});

test('service: a model check made for another model (before an update changed it) is not used', async () => {
  const t = setup();
  await t.signIn();
  const account = (await t.local.store.get<Account>(STORAGE_KEYS.account))!;
  // Signed in when an older version checked another model, which was missing
  await t.local.store.set(STORAGE_KEYS.account, { ...account, modelAvailable: false, checkedModel: 'old-model' } satisfies Account);
  assert.equal(await t.service().accessToken(), 'access-1');
  assert.equal((await t.service().status()).modelAvailable, undefined);
  // The same without a recorded model (a sign-in from before it was recorded)
  await t.local.store.set(STORAGE_KEYS.account, { ...account, modelAvailable: false, checkedModel: undefined } satisfies Account);
  assert.equal(await t.service().accessToken(), 'access-1');
});
