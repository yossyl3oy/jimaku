// The extension's manifest for each browser. Everything is shared but what the browsers do differently, so the
// differences are in one place and tested (tests/manifest.test.ts). The version is the repository's (package.json).

export const BROWSERS = ['chrome', 'firefox'] as const;
export type Browser = (typeof BROWSERS)[number];

// A public key. It fixes Chrome's extension ID to bineloccjadloiohooadhfclifcfdbai, whatever folder the extension is
// loaded from (tests/extension-id.test.ts; see docs/development.md)
const CHROME_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy8lj0+XweKxy35Y8Gg6iRb6RAZmlFujVqyZPhCsQ3OmJvV9+OAHubVMx3TE7riT/BtbQ0uv/evNAh9mo3BPGH0PpSBXtl8ZKBlGIuGcL+afI7dFJh8nq7ftX078or51mM2tE3anahcM4DgvCTrneSHnGbG3LQKArbhc2RpIgvuycYwEj341KJ27VF6Z+vZNqOBdC8xHUgEQhGY7swcL4AQTOLcDfJp/ThM1FHGjWE+fJJW36zTv0DtWEYXZC7CF0yW+RaRWoCe8lX3unJImUDwMxngk++lFmCqtIcCfjDV3N9zkxrdkSJsoWDvw3JIFgg5mEAio/N+9XW1cR4JDkzwIDAQAB';

// The add-on ID in Firefox, which needs one to install an extension from a file and to sign it. Like Chrome's key, it
// must never change: a new one would be another extension
export const FIREFOX_ID = 'jimaku@yossyl3oy.github.io';
// The first Firefox that runs a content script in the page's world (the manifest's "world": "MAIN")
const FIREFOX_MIN_VERSION = '128.0';

// The page OpenAI's sign-in is redirected to. A redirect to an extension page needs it to be web accessible, and only
// to where the navigation starts, so that other sites can't load it to find out that jimaku is installed.
// The Firefox build also lists the loopback callback (without a port, since match patterns have none): Firefox's own
// tests want the address being redirected to match too, and that is how the redirect was tried there (not without it).
// Firefox's extension pages have a new random host in every installation, so a page on the loopback can't guess it.
const callbackPageAccess = (browser: Browser) => ({
  resources: ['callback.html'],
  matches: ['https://auth.openai.com/*', ...(browser === 'firefox' ? ['http://127.0.0.1/*'] : [])],
});

export const manifestFor = (browser: Browser, version: string) => ({
  manifest_version: 3,
  name: 'Jimaku',
  version,
  ...(browser === 'chrome' ? { key: CHROME_KEY } : {}),
  description: '__MSG_extDescription__',
  default_locale: 'en',
  // Chrome runs the background as a service worker. Firefox has none for extensions and runs the same script as an
  // event page, which also stops while idle and starts again on an event
  background: browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_title: 'Jimaku',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    },
  },
  // YouTube's player info is read from the page's world (page.js). On X everything needed is in the page's DOM
  content_scripts: [
    { matches: ['https://www.youtube.com/*'], js: ['page.js'], run_at: 'document_start', world: 'MAIN' },
    { matches: ['https://www.youtube.com/*'], js: ['content.js'], run_at: 'document_idle' },
    { matches: ['https://x.com/*'], js: ['x.js'], run_at: 'document_idle' },
  ],
  permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
  host_permissions: ['https://auth.openai.com/*', 'https://api.openai.com/*', 'http://127.0.0.1/*'],
  web_accessible_resources: [callbackPageAccess(browser)],
  ...(browser === 'firefox'
    ? { browser_specific_settings: { gecko: { id: FIREFOX_ID, strict_min_version: FIREFOX_MIN_VERSION } } }
    : {}),
});
