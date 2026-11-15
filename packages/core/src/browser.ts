// The few places where the browsers differ, decided from the extension's own URL (chrome.runtime.getURL('')):
// chrome-extension://<id>/ in Chrome, where the ID is fixed by the manifest's key, and moz-extension://<uuid>/ in
// Firefox, where the UUID is made anew for every installation. Pure, so both are tested without a browser.

// OpenAI's sign-in returns to http://127.0.0.1:<port>/auth/callback, where nothing listens. This session rule
// (declarativeNetRequest) sends that navigation to the extension's callback page instead, keeping the query string.
// Only the port may vary between sign-ins. The rule is written with plain strings rather than the API's enums, which
// are not there in every browser.
export const CALLBACK_RULE_ID = 1;

export const callbackRule = (redirectUri: string, extensionUrl: string) => {
  const own = new URL(extensionUrl);
  return {
    id: CALLBACK_RULE_ID,
    priority: 1,
    condition: { urlFilter: `|${redirectUri}`, resourceTypes: ['main_frame'] },
    action: {
      type: 'redirect',
      redirect: { transform: { scheme: own.protocol.slice(0, -1), host: own.hostname, port: '', path: '/callback.html' } },
    },
  };
};

// Whether the sign-in can be saved behind a passkey (vault.ts). The passkey's relying party is the extension
// itself, which Chrome allows for chrome-extension://<id>. Firefox does not let an extension be the relying party of
// its own passkey (bug 1693562), so there the sign-in stays in memory and ends when the browser closes.
export const passkeysSupported = (extensionUrl: string): boolean => new URL(extensionUrl).protocol === 'chrome-extension:';
