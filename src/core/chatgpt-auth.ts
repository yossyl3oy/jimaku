// Sign in with ChatGPT (OpenAI's flow for open-source and locally hosted apps), without chrome.* or the DOM.
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in
// Storage, fetch and the clock come in from outside, so tests drive it with fakes.
// (Rewritten from rokrokss/shizue@c2ebc51 src/lib/chatgptAuth.ts.)
//
// Where things are kept:
// - local: what is not secret (the host ID, the issued client ID, who signed in). Reusing them on every sign-in
//   keeps the registrations in the user's ChatGPT settings from multiplying.
// - session: the tokens and the sign-in in progress. In the extension this is chrome.storage.session, which stays in memory
//   and is cleared when the browser restarts (SIWC: "Keep tokens out of browser storage").

import { fromBase64url, toBase64url } from './base64url.ts';
import { API, MODEL, readJSON, requireOK, visibleModels } from './chatgpt-responses.ts';
import { ProviderError } from './errors.ts';

export const AUTH = 'https://auth.openai.com';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const FIRST_CLIENT_ID = 'dynamic_agent_client';
// The name ChatGPT suggests for the app when it is first connected (the user can change it there)
const APP_NAME = 'Jimaku';
// A sign-in left open longer than this is not accepted
const SIGN_IN_TTL_MS = 10 * 60_000;
// Refresh this long before the access token expires
const REFRESH_MARGIN_MS = 60_000;
// Refresh errors after which the refresh token will never work again: forget it and sign in again
// (https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
export const TERMINAL_REFRESH_ERRORS = [
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
];

export type KeyValueStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

export type Account = {
  // ext_agent_host_id: made once and kept
  hostId: string;
  // Issued at the first sign-in
  clientId?: string;
  subject?: string;
  label?: string;
  // Whether checkedModel was in the account's catalog at the last sign-in (undefined when the catalog could not be read)
  modelAvailable?: boolean;
  checkedModel?: string;
};

// What the last sign-in found out about MODEL. A check made for another model (before an update changed MODEL, or
// before the checked model was recorded) says nothing about it, so it counts as unknown until the next sign-in.
export const modelAvailableNow = (account: Account | undefined): boolean | undefined =>
  account?.checkedModel === MODEL ? account.modelAvailable : undefined;

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type PendingSignIn = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
};

export type AuthStatus = {
  signedIn: boolean;
  label?: string;
  modelAvailable?: boolean;
};

export const STORAGE_KEYS = {
  account: 'chatgptAccount',
  tokens: 'chatgptTokens',
  pending: 'chatgptSignIn',
  // In local storage: the time of the last successful sign-in, so open videos can start again
  signedInAt: 'chatgptSignedInAt',
} as const;

export type AuthOptions = {
  local: KeyValueStore;
  session: KeyValueStore;
  fetch?: typeof fetch;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  // Called after the tokens are saved (the new tokens) or forgotten (undefined), to keep an encrypted copy in step
  onTokens?: (tokens: Tokens | undefined) => Promise<void>;
};

const sha256 = async (value: string) =>
  toBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

const hasPlanScope = (scope: unknown) => typeof scope === 'string' && scope.split(/\s+/).includes(PLAN_SCOPE);

const invalidIdToken = () => new ProviderError('invalid_id_token', 'ChatGPT returned an invalid ID token');

const decodePart = (part: string | undefined): Record<string, any> => {
  if (!part) throw invalidIdToken();
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(part)));
  } catch {
    throw invalidIdToken();
  }
};

// The ID token signature algorithms accepted, as Web Crypto parameters
const ALGORITHMS: Record<string, { importAs: RsaHashedImportParams | EcKeyImportParams; verifyAs: AlgorithmIdentifier | EcdsaParams }> = {
  RS256: { importAs: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAs: 'RSASSA-PKCS1-v1_5' },
  ES256: { importAs: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAs: { name: 'ECDSA', hash: 'SHA-256' } },
};

// Checks the authorization server's redirect and returns the code and the client ID to use
export const readCallback = (url: URL, pending: { state: string }, savedClientId?: string) => {
  if (url.searchParams.get('state') !== pending.state) throw new ProviderError('invalid_state', 'This sign-in has expired');
  const error = url.searchParams.get('error');
  if (error) throw new ProviderError(error, 'ChatGPT sign-in was declined');
  const clientId = url.searchParams.get('client_id') || savedClientId;
  if (!clientId || clientId === FIRST_CLIENT_ID) throw new ProviderError('missing_client_id', 'ChatGPT did not issue a client ID');
  if (savedClientId && clientId !== savedClientId) {
    throw new ProviderError('client_id_changed', 'ChatGPT returned a different client ID');
  }
  const code = url.searchParams.get('code');
  if (!code) throw new ProviderError('missing_code', 'ChatGPT did not return an authorization code');
  return { code, clientId };
};

export const createChatGPTAuth = (options: AuthOptions) => {
  const { local, session } = options;
  // Browsers reject fetch called with another `this`
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((length) => crypto.getRandomValues(new Uint8Array(length)));
  const random = () => toBase64url(randomBytes(32));
  const onTokens = options.onTokens ?? (async () => {});

  // Refresh tokens rotate, so reading and writing the tokens is done one at a time
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };
  // Bumped by signOut, so a sign-in that was already exchanging its code does not save tokens afterwards
  let generation = 0;

  const loadAccount = async (): Promise<Account> => {
    const stored = await local.get<Account>(STORAGE_KEYS.account);
    if (stored?.hostId) return stored;
    const account = { hostId: `urn:uuid:${crypto.randomUUID()}` };
    await local.set(STORAGE_KEYS.account, account);
    return account;
  };

  const getJSON = async (url: string, init?: RequestInit) =>
    readJSON(await requireOK(await fetchFn(url, { signal: AbortSignal.timeout(20_000), ...init })));

  const tokenRequest = (parameters: Record<string, string>) =>
    getJSON(`${AUTH}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, resource: API }),
      signal: AbortSignal.timeout(25_000),
    });

  // OpenID discovery and the signing keys, read once per worker (the keys again when a token names an unknown key)
  let discovery: Promise<{ jwks_uri: string; revocation_endpoint?: string }> | undefined;
  let jwks: Promise<{ keys: JsonWebKey[] }> | undefined;
  const config = () =>
    (discovery ??= getJSON(`${AUTH}/.well-known/openid-configuration`).then((body) => {
      if (body?.issuer !== AUTH || new URL(body.jwks_uri).origin !== AUTH) {
        throw new ProviderError('invalid_provider_response', 'Unexpected OpenAI sign-in configuration');
      }
      return body;
    })).catch((error) => {
      discovery = undefined;
      throw error;
    });
  const signingKey = async (kid: unknown, fresh: boolean) => {
    if (fresh || !jwks) jwks = config().then((c) => getJSON(c.jwks_uri));
    const keys = await jwks.catch((error) => {
      jwks = undefined;
      throw error;
    });
    return (keys.keys ?? []).find((key) => (key as { kid?: string }).kid === kid);
  };

  // Verifies the ID token's signature against OpenAI's published keys and returns its claims
  const verifiedClaims = async (idToken: string) => {
    const [headerPart, payloadPart, signaturePart] = idToken.split('.');
    const header = decodePart(headerPart);
    const claims = decodePart(payloadPart);
    const algorithm = ALGORITHMS[header.alg];
    if (!algorithm || !signaturePart) throw invalidIdToken();
    const jwk = (await signingKey(header.kid, false)) ?? (await signingKey(header.kid, true));
    if (!jwk) throw invalidIdToken();
    const { kty, n, e, crv, x, y } = jwk;
    let valid = false;
    try {
      const key = await crypto.subtle.importKey('jwk', { kty, n, e, crv, x, y }, algorithm.importAs, false, ['verify']);
      valid = await crypto.subtle.verify(
        algorithm.verifyAs,
        key,
        fromBase64url(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      );
    } catch {
      // A key that does not fit the algorithm
    }
    if (!valid) throw invalidIdToken();
    return claims;
  };

  // Checks a token response. nonce is given for the first exchange, subject when an account is already known.
  const validate = async (body: any, clientId: string, expected: { nonce?: string; subject?: string }) => {
    if (typeof body?.access_token !== 'string' || !hasPlanScope(body.scope)) {
      throw new ProviderError('missing_plan_scope', 'ChatGPT plan access was not granted');
    }
    if (!Number.isFinite(body.expires_in) || body.expires_in <= 0) {
      throw new ProviderError('invalid_provider_response', 'ChatGPT returned an invalid token expiry');
    }
    let claims: Record<string, any> | undefined;
    if (typeof body.id_token === 'string') {
      claims = await verifiedClaims(body.id_token);
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const ok =
        claims.iss === AUTH &&
        audience.includes(clientId) &&
        typeof claims.sub === 'string' &&
        typeof claims.exp === 'number' &&
        claims.exp * 1000 > now() &&
        (expected.nonce === undefined || claims.nonce === expected.nonce);
      if (!ok) throw invalidIdToken();
      if (expected.subject && claims.sub !== expected.subject) {
        throw new ProviderError('account_changed', 'Sign in with the same ChatGPT account as before');
      }
    } else if (expected.nonce !== undefined) {
      throw new ProviderError('invalid_id_token', 'ChatGPT did not return an ID token');
    }
    return { claims, accessToken: body.access_token as string, refreshToken: body.refresh_token as unknown, expiresIn: body.expires_in as number };
  };

  const saveTokens = async (tokens: Tokens) => {
    await session.set(STORAGE_KEYS.tokens, tokens);
    await onTokens(tokens);
  };
  const forgetTokens = async () => {
    await session.remove(STORAGE_KEYS.tokens);
    await onTokens(undefined);
  };

  // Gets new tokens with a refresh token (call inside serialized). A refresh token that will never work again is forgotten.
  const refresh = async (refreshToken: string): Promise<Tokens> => {
    const account = await loadAccount();
    if (!account.clientId) throw new ProviderError('login_required', 'Not signed in to ChatGPT');
    let body;
    try {
      body = await tokenRequest({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: refreshToken });
    } catch (error) {
      if (error instanceof ProviderError && TERMINAL_REFRESH_ERRORS.includes(error.code)) await forgetTokens();
      throw error;
    }
    const result = await validate(body, account.clientId, { subject: account.subject });
    const tokens: Tokens = {
      accessToken: result.accessToken,
      // The server may or may not rotate it
      refreshToken: typeof result.refreshToken === 'string' ? result.refreshToken : refreshToken,
      expiresAt: now() + result.expiresIn * 1000,
    };
    await saveTokens(tokens);
    return tokens;
  };

  // Whether MODEL is in the account's catalog. undefined when the catalog cannot be read right now.
  const hasModel = async (accessToken: string) => {
    try {
      const body = await getJSON(`${API}/models`, { headers: { Authorization: `Bearer ${accessToken}` } });
      return visibleModels(body).includes(MODEL);
    } catch {
      return undefined;
    }
  };

  return {
    // Starts a sign-in that comes back to redirectUri, and returns the URL to open
    async beginSignIn(redirectUri: string): Promise<string> {
      const account = await loadAccount();
      const pending: PendingSignIn = { state: random(), nonce: random(), verifier: random(), redirectUri, createdAt: now() };
      await session.set(STORAGE_KEYS.pending, pending);
      const url = new URL(`${AUTH}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: account.clientId ?? FIRST_CLIENT_ID,
        response_type: 'code',
        resource: API,
        scope: SCOPE,
        redirect_uri: redirectUri,
        state: pending.state,
        nonce: pending.nonce,
        code_challenge: await sha256(pending.verifier),
        code_challenge_method: 'S256',
        ext_agent_host_id: account.hostId,
        // Only on the first registration
        ...(account.clientId ? {} : { agent_name_hint: APP_NAME }),
      }).toString();
      return url.href;
    },

    // Finishes the sign-in from the URL the authorization server redirected to.
    // Returns false when the URL does not belong to the sign-in in progress (an old tab, etc.).
    async completeSignIn(callback: URL): Promise<boolean> {
      // Taken before anything waits, so a sign-out from here on cancels this sign-in
      const started = generation;
      // Read and consumed in one step: one callback per sign-in, even when it fails or arrives twice at once
      const pending = await serialized(async () => {
        const stored = await session.get<PendingSignIn>(STORAGE_KEYS.pending);
        if (!stored || callback.searchParams.get('state') !== stored.state) return undefined;
        await session.remove(STORAGE_KEYS.pending);
        return stored;
      });
      if (!pending) return false;
      if (now() - pending.createdAt > SIGN_IN_TTL_MS) throw new ProviderError('login_timeout', 'The sign-in took too long. Try again');

      const account = await loadAccount();
      const { code, clientId } = readCallback(callback, pending, account.clientId);
      const body = await tokenRequest({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
      });
      const result = await validate(body, clientId, { nonce: pending.nonce, subject: account.subject });
      if (typeof result.refreshToken !== 'string') throw new ProviderError('missing_refresh_token', 'ChatGPT did not grant offline access');
      const tokens: Tokens = { accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: now() + result.expiresIn * 1000 };
      const label = result.claims?.email ?? result.claims?.name;
      const subject = result.claims?.sub;
      // The registration and the tokens are saved before the model check, so a failing catalog request loses neither
      await serialized(async () => {
        if (generation !== started) throw new ProviderError('cancelled', 'Signed out while signing in');
        await local.set(STORAGE_KEYS.account, {
          ...account,
          clientId,
          subject: typeof subject === 'string' ? subject : account.subject,
          label: typeof label === 'string' ? label : account.label,
        } satisfies Account);
        await saveTokens(tokens);
      });
      const modelAvailable = await hasModel(tokens.accessToken);
      await local.set(STORAGE_KEYS.account, { ...(await loadAccount()), modelAvailable, checkedModel: MODEL } satisfies Account);
      return true;
    },

    // A valid access token, refreshed when close to expiring. Throws login_required when not signed in,
    // and a terminal refresh error (forgetting the tokens) when the refresh token no longer works.
    accessToken(): Promise<string> {
      return serialized(async () => {
        const tokens = await session.get<Tokens>(STORAGE_KEYS.tokens);
        if (!tokens) throw new ProviderError('login_required', 'Not signed in to ChatGPT');
        if (tokens.expiresAt - REFRESH_MARGIN_MS > now()) return tokens.accessToken;
        return (await refresh(tokens.refreshToken)).accessToken;
      });
    },

    // Signs in again from a saved refresh token (decrypted from the vault after a browser restart).
    // The token is read inside the queue, so two unlocks at once do not both spend the same rotating token.
    // Already signed in (another unlock, or a sign-in while locked), the saved token is left unspent and the current
    // tokens go to onTokens again, so what is saved is never older than what is in use.
    restore(readRefreshToken: () => Promise<string>): Promise<void> {
      return serialized(async () => {
        const tokens = await session.get<Tokens>(STORAGE_KEYS.tokens);
        if (tokens) return onTokens(tokens);
        await refresh(await readRefreshToken());
      });
    },

    // Passes the current tokens to onTokens again (after a passkey was set up, so they get sealed)
    resave(): Promise<void> {
      return serialized(async () => {
        const tokens = await session.get<Tokens>(STORAGE_KEYS.tokens);
        if (tokens) await onTokens(tokens);
      });
    },

    async status(): Promise<AuthStatus> {
      const [account, tokens] = await Promise.all([
        local.get<Account>(STORAGE_KEYS.account),
        session.get<Tokens>(STORAGE_KEYS.tokens),
      ]);
      if (!tokens) return { signedIn: false };
      return { signedIn: true, label: account?.label, modelAvailable: modelAvailableNow(account) };
    },

    // Forgets the tokens (and any sign-in in progress) and asks the server to revoke the refresh token (best effort).
    // The registration (client ID) is kept so the next sign-in reuses it.
    async signOut(): Promise<void> {
      generation++;
      const tokens = await serialized(async () => {
        const stored = await session.get<Tokens>(STORAGE_KEYS.tokens);
        await session.remove(STORAGE_KEYS.pending);
        await forgetTokens();
        return stored;
      });
      const account = await local.get<Account>(STORAGE_KEYS.account);
      if (!tokens || !account?.clientId) return;
      try {
        const endpoint = new URL((await config()).revocation_endpoint ?? '');
        if (endpoint.origin !== AUTH) return;
        await fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // The tokens are already forgotten locally
      }
    },
  };
};

export type ChatGPTAuth = ReturnType<typeof createChatGPTAuth>;
