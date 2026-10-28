import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AUTH, createChatGPTAuth, STORAGE_KEYS, type Tokens } from '../src/core/chatgpt-auth.ts';
import { isFatalError, ProviderError } from '../src/core/errors.ts';
import { authorizeWith, fakeOpenAI, memoryStore, REDIRECT, signIdToken } from './fakes.ts';

const setup = () => {
  let time = 1_000_000_000_000;
  const now = () => time;
  const local = memoryStore();
  const session = memoryStore();
  const openai = fakeOpenAI(now);
  const auth = createChatGPTAuth({ local: local.store, session: session.store, fetch: openai.fetch, now });
  const authorize = (params: Record<string, string> = {}) => authorizeWith(auth, openai, params);
  return { auth, local, session, openai, authorize, advance: (ms: number) => (time += ms) };
};

test('beginSignIn: the first sign-in registers with dynamic_agent_client and a PKCE S256 challenge', async () => {
  const { auth, local, session } = setup();
  const url = new URL(await auth.beginSignIn(REDIRECT));
  assert.equal(url.origin + url.pathname, `${AUTH}/api/accounts/authorize`);
  const p = url.searchParams;
  assert.equal(p.get('client_id'), 'dynamic_agent_client');
  assert.equal(p.get('agent_name_hint'), 'jimaku');
  assert.equal(p.get('redirect_uri'), REDIRECT);
  assert.equal(p.get('resource'), 'https://api.openai.com/v1');
  assert.equal(p.get('scope'), 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct');
  assert.equal(p.get('code_challenge_method'), 'S256');
  const pending = session.data.get(STORAGE_KEYS.pending) as { verifier: string; state: string };
  assert.equal(p.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(p.get('state'), pending.state);
  // The host ID is made once and kept
  const hostId = p.get('ext_agent_host_id');
  assert.match(hostId!, /^urn:uuid:/);
  const again = new URL(await auth.beginSignIn(REDIRECT));
  assert.equal(again.searchParams.get('ext_agent_host_id'), hostId);
  assert.notEqual(again.searchParams.get('state'), p.get('state'));
  assert.equal((local.data.get(STORAGE_KEYS.account) as { hostId: string }).hostId, hostId);
});

test('completeSignIn: exchanges the code, keeps tokens only in session storage, and remembers the client ID', async () => {
  const { auth, local, session, openai, authorize } = setup();
  const { callback } = await authorize();
  assert.equal(await auth.completeSignIn(callback), true);

  const exchange = openai.state.requests.find((r) => r.body?.get('grant_type') === 'authorization_code')!;
  assert.equal(exchange.body!.get('client_id'), 'client-abc');
  assert.equal(exchange.body!.get('redirect_uri'), REDIRECT);
  assert.equal(exchange.body!.get('code'), 'code-1');
  assert.ok(exchange.body!.get('code_verifier'));

  assert.deepEqual(await auth.status(), { signedIn: true, label: 'cat@example.com', modelAvailable: true });
  assert.equal((session.data.get(STORAGE_KEYS.tokens) as Tokens).refreshToken, 'refresh-1');
  assert.equal(session.data.has(STORAGE_KEYS.pending), false);
  assert.doesNotMatch(JSON.stringify([...local.data]), /access-|refresh-/);
  assert.equal((local.data.get(STORAGE_KEYS.account) as { clientId: string }).clientId, 'client-abc');
});

test('beginSignIn: later sign-ins reuse the issued client ID, without agent_name_hint', async () => {
  const { auth, authorize } = setup();
  await auth.completeSignIn((await authorize()).callback);
  const url = new URL(await auth.beginSignIn(REDIRECT));
  assert.equal(url.searchParams.get('client_id'), 'client-abc');
  assert.equal(url.searchParams.has('agent_name_hint'), false);
});

test('completeSignIn: ignores a callback from another sign-in, and accepts each sign-in only once', async () => {
  const { auth, authorize } = setup();
  const { callback } = await authorize();
  const stale = new URL(callback);
  stale.searchParams.set('state', 'other');
  assert.equal(await auth.completeSignIn(stale), false);
  assert.equal(await auth.completeSignIn(callback), true);
  assert.equal(await auth.completeSignIn(callback), false);
});

test('completeSignIn: rejects a declined sign-in, a wrong nonce, missing plan scope and a stale sign-in', async () => {
  {
    const { auth, authorize } = setup();
    const { callback } = await authorize({ error: 'access_denied' });
    await assert.rejects(auth.completeSignIn(callback), (e: ProviderError) => e.code === 'access_denied');
  }
  {
    const { auth, openai, authorize } = setup();
    const { callback } = await authorize();
    openai.state.nonce = 'tampered';
    await assert.rejects(auth.completeSignIn(callback), (e: ProviderError) => e.code === 'invalid_id_token');
    assert.deepEqual(await auth.status(), { signedIn: false });
  }
  {
    const { auth, openai, authorize } = setup();
    openai.state.scope = 'openid offline_access';
    await assert.rejects(auth.completeSignIn((await authorize()).callback), (e: ProviderError) => e.code === 'missing_plan_scope');
  }
  {
    const { auth, authorize, advance } = setup();
    const { callback } = await authorize();
    advance(11 * 60_000);
    await assert.rejects(auth.completeSignIn(callback), (e: ProviderError) => e.code === 'login_timeout');
  }
});

test('completeSignIn: records when the fixed model is not in the account catalog', async () => {
  const { auth, openai, authorize } = setup();
  openai.state.models = [{ slug: 'other', visibility: 'list' }];
  await auth.completeSignIn((await authorize()).callback);
  assert.equal((await auth.status()).modelAvailable, false);
});

test('completeSignIn: signing in with a different account than before is refused', async () => {
  const { auth, openai, authorize } = setup();
  await auth.completeSignIn((await authorize()).callback);
  openai.state.subject = 'user-2';
  await assert.rejects(auth.completeSignIn((await authorize()).callback), (e: ProviderError) => e.code === 'account_changed');
});

test('accessToken: login_required (fatal) before signing in', async () => {
  const { auth } = setup();
  await assert.rejects(auth.accessToken(), (e: ProviderError) => e.code === 'login_required' && isFatalError(e));
});

test('accessToken: refreshes once near expiry, even with concurrent callers, and keeps the rotated refresh token', async () => {
  const { auth, session, openai, authorize, advance } = setup();
  await auth.completeSignIn((await authorize()).callback);
  assert.equal(await auth.accessToken(), 'access-1');
  advance(3600_000 - 30_000);
  const tokens = await Promise.all([auth.accessToken(), auth.accessToken()]);
  assert.deepEqual(tokens, ['access-2', 'access-2']);
  const refreshes = openai.state.requests.filter((r) => r.body?.get('grant_type') === 'refresh_token');
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].body!.get('refresh_token'), 'refresh-1');
  assert.equal((session.data.get(STORAGE_KEYS.tokens) as Tokens).refreshToken, 'refresh-2');
});

test('accessToken: a refresh token that no longer works forgets the tokens (fatal invalid_grant)', async () => {
  const { auth, openai, authorize, advance } = setup();
  await auth.completeSignIn((await authorize()).callback);
  advance(3600_000);
  openai.state.refreshError = 'invalid_grant';
  await assert.rejects(auth.accessToken(), (e: ProviderError) => e.code === 'invalid_grant' && isFatalError(e));
  assert.deepEqual(await auth.status(), { signedIn: false });
});

test('signOut: forgets the tokens, revokes the refresh token and keeps the registration', async () => {
  const { auth, local, openai, authorize } = setup();
  await auth.completeSignIn((await authorize()).callback);
  await auth.signOut();
  assert.deepEqual(await auth.status(), { signedIn: false });
  const revoke = openai.state.requests.find((r) => r.url === `${AUTH}/oauth/revoke`)!;
  assert.equal(revoke.body!.get('token'), 'refresh-1');
  assert.equal(revoke.body!.get('client_id'), 'client-abc');
  assert.equal((local.data.get(STORAGE_KEYS.account) as { clientId: string }).clientId, 'client-abc');
});

test('onTokens: sees every saved token (sign-in, refresh) and the forgetting (sign-out)', async () => {
  let time = 1_000_000_000_000;
  const local = memoryStore();
  const session = memoryStore();
  const openai = fakeOpenAI(() => time);
  const seen: (string | undefined)[] = [];
  const auth = createChatGPTAuth({
    local: local.store,
    session: session.store,
    fetch: openai.fetch,
    now: () => time,
    onTokens: async (tokens) => void seen.push(tokens?.refreshToken),
  });
  await auth.completeSignIn((await authorizeWith(auth, openai)).callback);
  time += 3600_000;
  await auth.accessToken();
  await auth.signOut();
  assert.deepEqual(seen, ['refresh-1', 'refresh-2', undefined]);
});

test('restore: signs in again from a saved refresh token', async () => {
  const { auth, session, openai, authorize } = setup();
  await auth.completeSignIn((await authorize()).callback);
  // A browser restart clears session storage
  session.data.clear();
  assert.deepEqual(await auth.status(), { signedIn: false });
  await auth.restore(async () => 'refresh-1');
  assert.equal((await auth.status()).signedIn, true);
  assert.equal(await auth.accessToken(), 'access-2');
  const refresh = openai.state.requests.findLast((r) => r.body?.get('grant_type') === 'refresh_token')!;
  assert.equal(refresh.body!.get('refresh_token'), 'refresh-1');
});

test('completeSignIn: an ID token whose signature does not verify is refused', async () => {
  {
    const { auth, openai, authorize } = setup();
    // Same header and signature, claims changed to another account
    openai.state.tamper = (token) => {
      const [header, payload, signature] = token.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return [header, Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url'), signature].join('.');
    };
    await assert.rejects(auth.completeSignIn((await authorize()).callback), (e: ProviderError) => e.code === 'invalid_id_token');
    assert.deepEqual(await auth.status(), { signedIn: false });
  }
  {
    // Signed by a key OpenAI does not publish
    const { auth, openai, authorize } = setup();
    const forged = await signIdToken({}, 'unknown-key');
    openai.state.tamper = () => forged;
    await assert.rejects(auth.completeSignIn((await authorize()).callback), (e: ProviderError) => e.code === 'invalid_id_token');
  }
});

for (const code of ['refresh_token_expired', 'refresh_token_reused', 'invalid_refresh_token']) {
  test(`accessToken: ${code} forgets the tokens and stops (fatal)`, async () => {
    const { auth, openai, authorize, advance } = setup();
    await auth.completeSignIn((await authorize()).callback);
    advance(3600_000);
    openai.state.refreshError = code;
    await assert.rejects(auth.accessToken(), (e: ProviderError) => e.code === code && isFatalError(e));
    assert.deepEqual(await auth.status(), { signedIn: false });
  });
}

test('signOut: a sign-in that was already exchanging its code does not save tokens afterwards', async () => {
  const { auth, openai, authorize } = setup();
  const { callback } = await authorize();
  let release!: () => void;
  openai.state.exchangeGate = new Promise((resolve) => (release = resolve));
  const signingIn = auth.completeSignIn(callback);
  await new Promise((resolve) => setImmediate(resolve));
  await auth.signOut();
  release();
  await assert.rejects(signingIn, (e: ProviderError) => e.code === 'cancelled');
  assert.deepEqual(await auth.status(), { signedIn: false });
});

test('completeSignIn: a failing model catalog does not lose the sign-in', async () => {
  const { auth, local, openai, authorize } = setup();
  openai.state.modelsStatus = 503;
  assert.equal(await auth.completeSignIn((await authorize()).callback), true);
  assert.deepEqual(await auth.status(), { signedIn: true, label: 'cat@example.com', modelAvailable: undefined });
  assert.equal((local.data.get(STORAGE_KEYS.account) as { clientId: string }).clientId, 'client-abc');
});

test('signOut: called right after a sign-in starts, before it reads anything, still cancels it', async () => {
  const { auth, authorize } = setup();
  const { callback } = await authorize();
  const signingIn = auth.completeSignIn(callback);
  await auth.signOut();
  await assert.rejects(signingIn, (e: ProviderError) => e.code === 'cancelled');
  assert.deepEqual(await auth.status(), { signedIn: false });
});

test('completeSignIn: the same callback twice at once exchanges the code once', async () => {
  const { auth, openai, authorize } = setup();
  const { callback } = await authorize();
  const results = await Promise.all([auth.completeSignIn(callback), auth.completeSignIn(callback)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(openai.state.requests.filter((r) => r.body?.get('grant_type') === 'authorization_code').length, 1);
});

test('restore: when already signed in, passes the current tokens to onTokens instead of spending the saved one', async () => {
  const local = memoryStore();
  const session = memoryStore();
  const openai = fakeOpenAI(() => 1_000_000_000_000);
  const seen: (string | undefined)[] = [];
  const auth = createChatGPTAuth({
    local: local.store,
    session: session.store,
    fetch: openai.fetch,
    now: () => 1_000_000_000_000,
    onTokens: async (tokens) => void seen.push(tokens?.refreshToken),
  });
  await auth.completeSignIn((await authorizeWith(auth, openai)).callback);
  await auth.restore(async () => assert.fail('the saved token is not read'));
  assert.deepEqual(seen, ['refresh-1', 'refresh-1']);
  assert.equal(openai.state.requests.filter((r) => r.body?.get('grant_type') === 'refresh_token').length, 0);
});
