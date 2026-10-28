// Fakes shared by the ChatGPT tests: in-memory storage and a fake OpenAI

import { AUTH, type KeyValueStore } from '../src/core/chatgpt-auth.ts';
import { MODEL } from '../src/core/chatgpt-responses.ts';

export const REDIRECT = 'http://127.0.0.1:50000/auth/callback';

export const memoryStore = () => {
  const data = new Map<string, unknown>();
  const store: KeyValueStore = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    set: async (key, value) => void data.set(key, structuredClone(value)),
    remove: async (key) => void data.delete(key),
  };
  return { store, data };
};

const b64url = (value: string | Uint8Array) => Buffer.from(value).toString('base64url');

// OpenAI's ID token signing key, as published in its JWKS
const signing = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', signing.publicKey)), kid: 'key-1', use: 'sig' };

export const signIdToken = async (claims: object, kid = 'key-1') => {
  const input = `${b64url(JSON.stringify({ alg: 'RS256', kid }))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
};

// A fake OpenAI: answers the discovery, JWKS, token, models and revocation endpoints and records the requests
export const fakeOpenAI = (now: () => number) => {
  const requests: { url: string; body: URLSearchParams | null }[] = [];
  let tokenNumber = 0;
  const state = {
    requests,
    clientId: 'client-abc',
    subject: 'user-1',
    nonce: '',
    scope: 'openid offline_access resource.invoke chatgpt.tokens.use.direct',
    models: [{ slug: MODEL, visibility: 'list' }],
    refreshError: undefined as string | undefined,
    modelsStatus: 200,
    // Changes the ID token after signing (to test the signature check)
    tamper: undefined as ((idToken: string) => string) | undefined,
    // Waits before answering the code exchange (to test what happens meanwhile)
    exchangeGate: undefined as Promise<void> | undefined,
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    requests.push({ url, body });
    if (url === `${AUTH}/api/accounts/oauth/token`) {
      if (body?.get('grant_type') === 'refresh_token' && state.refreshError) return json({ error: state.refreshError }, 400);
      if (body?.get('grant_type') === 'authorization_code') await state.exchangeGate;
      tokenNumber++;
      const idToken = await signIdToken({
        iss: AUTH,
        aud: [state.clientId],
        sub: state.subject,
        exp: Math.floor(now() / 1000) + 3600,
        email: 'cat@example.com',
        ...(body?.get('grant_type') === 'authorization_code' ? { nonce: state.nonce } : {}),
      });
      return json({
        access_token: `access-${tokenNumber}`,
        refresh_token: `refresh-${tokenNumber}`,
        expires_in: 3600,
        scope: state.scope,
        id_token: state.tamper ? state.tamper(idToken) : idToken,
      });
    }
    if (url === 'https://api.openai.com/v1/models') return json({ models: state.models }, state.modelsStatus);
    if (url === `${AUTH}/.well-known/openid-configuration`) {
      return json({ issuer: AUTH, jwks_uri: `${AUTH}/.well-known/jwks.json`, revocation_endpoint: `${AUTH}/oauth/revoke` });
    }
    if (url === `${AUTH}/.well-known/jwks.json`) return json({ keys: [publicJwk] });
    if (url === `${AUTH}/oauth/revoke`) return json({});
    return json({ error: 'not_found' }, 404);
  }) as typeof fetch;
  return { state, fetch: fakeFetch };
};

// Plays the authorization server: reads the authorize URL and builds the redirect back
export const authorizeWith = async (
  auth: { beginSignIn(redirectUri: string): Promise<string> },
  openai: ReturnType<typeof fakeOpenAI>,
  params: Record<string, string> = {}
) => {
  const url = new URL(await auth.beginSignIn(REDIRECT));
  openai.state.nonce = url.searchParams.get('nonce')!;
  const callback = new URL(REDIRECT);
  callback.search = new URLSearchParams({
    state: url.searchParams.get('state')!,
    code: 'code-1',
    client_id: openai.state.clientId,
    ...params,
  }).toString();
  return { url, callback };
};
