import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALLBACK_RULE_ID, callbackRule, passkeysSupported } from '../src/browser.ts';

const CHROME = 'chrome-extension://bineloccjadloiohooadhfclifcfdbai/';
const FIREFOX = 'moz-extension://0f3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/';
const REDIRECT = 'http://127.0.0.1:50000/auth/callback';

test('callbackRule: in Chrome, sends the loopback callback to chrome-extension://<id>/callback.html', () => {
  assert.deepEqual(callbackRule(REDIRECT, CHROME), {
    id: CALLBACK_RULE_ID,
    priority: 1,
    condition: { urlFilter: '|http://127.0.0.1:50000/auth/callback', resourceTypes: ['main_frame'] },
    action: {
      type: 'redirect',
      redirect: {
        transform: { scheme: 'chrome-extension', host: 'bineloccjadloiohooadhfclifcfdbai', port: '', path: '/callback.html' },
      },
    },
  });
});

test('callbackRule: in Firefox, sends it to moz-extension://<uuid>/callback.html (the UUID of this installation)', () => {
  const { transform } = callbackRule(REDIRECT, FIREFOX).action.redirect;
  assert.deepEqual(transform, {
    scheme: 'moz-extension',
    host: '0f3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    port: '',
    path: '/callback.html',
  });
});

test('callbackRule: clears the port and leaves the query alone, so the callback page gets the code and state', () => {
  const { transform } = callbackRule(REDIRECT, CHROME).action.redirect;
  assert.equal(transform.port, '');
  assert.equal('query' in transform, false);
});

test('callbackRule: matches only main-frame navigations that start with this sign-in redirect URI', () => {
  const { condition } = callbackRule('http://127.0.0.1:61234/auth/callback', FIREFOX);
  assert.deepEqual(condition, { urlFilter: '|http://127.0.0.1:61234/auth/callback', resourceTypes: ['main_frame'] });
});

test('passkeysSupported: in Chrome, where the extension can be the relying party of its own passkey', () => {
  assert.equal(passkeysSupported(CHROME), true);
});

test('passkeysSupported: not in Firefox, where the sign-in stays in memory', () => {
  assert.equal(passkeysSupported(FIREFOX), false);
});
