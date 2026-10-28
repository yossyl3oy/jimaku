// base64url without padding (PKCE, WebAuthn IDs, stored ciphertext)

// Bytes backed by a plain ArrayBuffer, as Web Crypto and WebAuthn take them
export type Bytes = Uint8Array<ArrayBuffer>;

export const toBase64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const fromBase64url = (text: string): Bytes =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
