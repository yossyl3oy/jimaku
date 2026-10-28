import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fatalNotice, isFatalError, ProviderError } from '../src/core/errors.ts';

test('isFatalError: errors that would fail every chunk the same way stop the session; others do not', () => {
  const fatal = [
    'login_required',
    'locked',
    'refresh_token_reused',
    'subscription_sharing_user_not_eligible',
    'subscription_sharing_invalid_user',
    'subscription_sharing_usage_limit_exceeded',
    'extension_reloaded',
  ];
  for (const code of fatal) {
    assert.equal(isFatalError(new ProviderError(code, '')), true, code);
  }
  for (const code of ['stream_interrupted', 'port_closed', 'timeout', 'response_failed']) {
    assert.equal(isFatalError(new ProviderError(code, '')), false, code);
  }
  assert.equal(isFatalError(new Error('login_required')), false);
});

test('fatalNotice: the message telling the user what to do', () => {
  assert.deepEqual(fatalNotice('refresh_token_expired'), { key: 'noticeSignIn' });
  assert.deepEqual(fatalNotice('locked'), { key: 'noticeUnlock' });
  assert.deepEqual(fatalNotice('subscription_sharing_usage_limit_exceeded'), { key: 'noticeUsageLimit' });
  assert.deepEqual(fatalNotice('subscription_sharing_user_not_eligible'), { key: 'noticeNotEligible' });
  assert.deepEqual(fatalNotice('extension_reloaded'), { key: 'noticeExtensionReloaded' });
  // Anything else names its code
  assert.deepEqual(fatalNotice('chatpass_v2_scope_not_authorized'), {
    key: 'noticeRejected',
    substitutions: ['chatpass_v2_scope_not_authorized'],
  });
});
