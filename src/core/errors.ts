// Errors from the translator's provider (ChatGPT plan). They cross from the background to the content script as
// { code, message }, so they carry a code instead of relying on the class.

export class ProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

// Codes that will fail the same way on every request until the user does something (signs in again, waits for
// the usage window to reset). On these the session stops instead of failing chunk after chunk.
// (https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
const SIGN_IN_AGAIN = [
  'login_required',
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
  'invalid_token',
  'http_401',
  'subscription_sharing_invalid_user',
  'missing_plan_scope',
];
const FATAL_CODES = new Set([
  ...SIGN_IN_AGAIN,
  'locked',
  'model_unavailable',
  'model_not_found',
  'http_403',
  'invalid_client',
  'subscription_sharing_user_not_eligible',
  'subscription_sharing_usage_limit_exceeded',
  // Temporary, but retrying every chunk would only add load; turning jimaku off and on tries again
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_user_unavailable',
  // The request body is fixed, so these fail the same way every time
  'subscription_sharing_unsupported_capability',
  'subscription_sharing_route_not_supported',
  'chatpass_v2_scope_not_authorized',
  'chatpass_v2_invalid_authorization_context',
  // The extension was reloaded or updated under the open tab; only reloading the tab connects it again
  'extension_reloaded',
]);

export const isFatalError = (error: unknown): error is ProviderError =>
  error instanceof ProviderError && FATAL_CODES.has(error.code);

// A message for the user: its key in public/_locales/<locale>/messages.json, and what fills its placeholder
export type Notice = { key: string; substitutions?: string[] };

// What to tell the user when a fatal error stops the translation
export const fatalNotice = (code: string): Notice => {
  if (SIGN_IN_AGAIN.includes(code)) return { key: 'noticeSignIn' };
  switch (code) {
    case 'locked':
      return { key: 'noticeUnlock' };
    case 'subscription_sharing_usage_limit_exceeded':
      return { key: 'noticeUsageLimit' };
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return { key: 'noticePlanUnavailable' };
    case 'subscription_sharing_user_not_eligible':
    case 'http_403':
      return { key: 'noticeNotEligible' };
    case 'model_unavailable':
    case 'model_not_found':
      return { key: 'noticeModelUnavailable' };
    case 'extension_reloaded':
      return { key: 'noticeExtensionReloaded' };
    default:
      return { key: 'noticeRejected', substitutions: [code] };
  }
};
