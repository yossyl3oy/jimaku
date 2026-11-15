import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROWSERS, FIREFOX_ID, manifestFor } from '../scripts/manifest.ts';

const chrome = manifestFor('chrome', '1.2.3');
const firefox = manifestFor('firefox', '1.2.3');
// As written to manifest.json (keys left out are gone)
const written = (manifest: object): Record<string, unknown> => JSON.parse(JSON.stringify(manifest));

test('manifest: both browsers get the version given and the same extension otherwise', () => {
  const browserOnly = ['key', 'background', 'web_accessible_resources', 'browser_specific_settings'];
  const shared = (manifest: object) =>
    Object.fromEntries(Object.entries(written(manifest)).filter(([name]) => !browserOnly.includes(name)));
  assert.equal(chrome.version, '1.2.3');
  assert.deepEqual(shared(firefox), shared(chrome));
});

test('manifest: Chrome runs the background as a service worker and keeps its ID with the key', () => {
  assert.deepEqual(chrome.background, { service_worker: 'background.js' });
  assert.equal(typeof written(chrome).key, 'string');
  assert.equal('browser_specific_settings' in written(chrome), false);
});

test('manifest: Firefox runs the same script as an event page and has an add-on ID instead of the key', () => {
  assert.deepEqual(firefox.background, { scripts: ['background.js'] });
  assert.equal('key' in written(firefox), false);
  assert.deepEqual(written(firefox).browser_specific_settings, { gecko: { id: FIREFOX_ID, strict_min_version: '128.0' } });
});

// A new ID would be another extension to Firefox, with none of the settings of the one installed
test('manifest: the Firefox add-on ID stays jimaku@yossyl3oy.github.io', () => {
  assert.equal(FIREFOX_ID, 'jimaku@yossyl3oy.github.io');
});

test('manifest: the callback page is reachable only from where the sign-in redirect starts', () => {
  assert.deepEqual(chrome.web_accessible_resources, [{ resources: ['callback.html'], matches: ['https://auth.openai.com/*'] }]);
  // The Firefox build also lists the address being redirected (the loopback callback), as it was tried there
  assert.deepEqual(firefox.web_accessible_resources, [
    { resources: ['callback.html'], matches: ['https://auth.openai.com/*', 'http://127.0.0.1/*'] },
  ]);
});

test('manifest: every browser asks for the same permissions, and no more than these', () => {
  for (const browser of BROWSERS) {
    const manifest = manifestFor(browser, '1.2.3');
    assert.deepEqual(manifest.permissions, ['storage', 'declarativeNetRequestWithHostAccess'], browser);
    assert.deepEqual(manifest.host_permissions, ['https://auth.openai.com/*', 'https://api.openai.com/*', 'http://127.0.0.1/*'], browser);
    assert.deepEqual(manifest.content_scripts.map((script) => script.matches), [['https://www.youtube.com/*'], ['https://www.youtube.com/*']], browser);
  }
});
