# How it works

How jimaku picks the captions, places the translation, caches it and keeps the sign-in. For installing and using it, see the [README](../README.md).

## Which captions are translated

Tracks already in the target language are skipped. Among the remaining tracks, jimaku selects one in this order of preference: human-written captions in the spoken language (the language of YouTube's auto-generated track), human-written English, the auto-generated track, then any other human-written captions. If all caption tracks are in the target language, no translation is shown. The prompt itself stays in Japanese; only the language names in it change.

## Where the translation goes

- Below original: the translation occupies the original position of YouTube's captions, which are shifted up by the height of the translation (a `translate` on YouTube's bottom caption windows, which use `bottom: 2%` and no transform of their own). Turning jimaku off puts them back. A caption window YouTube placed somewhere else (not bottom-anchored) can't be raised that way, so while one is in the lower half, the translation goes over the captions instead.
- Above original: the translation is stacked above YouTube's captions, which stay where they are.

With CC off, the translation sits near the bottom of the video either way. Caption windows in the upper half of the video are ignored, such as the "Click ⚙ for settings" hint YouTube shows at the top for a few seconds after CC is turned on.

## Translation caching

Translated lines are cached in the content script's memory for the 20 most recently used combinations of video, caption track and target language. Returning to a cached combination in the same tab displays its translations immediately and requests only missing lines, including any that previously failed. Nothing is written to disk, so closing or reloading the tab clears the cache. `chrome.storage.session` would keep them across reloads, but it stores authentication tokens and is kept inaccessible to content scripts, and `chrome.storage.local` would leave a record of the videos watched.

## Sign-in and tokens

- Sign-in follows [OpenAI's flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): PKCE, and a redirect to `http://127.0.0.1:<port>/auth/callback`. Nothing listens there; a `declarativeNetRequest` session rule sends that navigation to the extension's `callback.html`. The client ID issued at the first sign-in and the `ext_agent_host_id` are reused, to avoid creating duplicate registrations in your ChatGPT settings.
- The model is fixed (`gpt-6-luna`, reasoning off) and checked against the account's catalog once at sign-in, so a translation is a single request.
- The tokens are kept in `chrome.storage.session` only (memory, cleared when the browser restarts). The SIWC terms require tokens to be stored locally under the user's control, and the docs say "Keep tokens out of browser storage".
- Saving sign-in credentials with a passkey writes the refresh token to `chrome.storage.local`, encrypted (AES-GCM) under a random data key. That key is stored only in encrypted form, protected by a key derived from the passkey's WebAuthn PRF output. This requires WebAuthn PRF (Windows 11 or a recent version of macOS, and a recent version of Chrome); without it, jimaku stays memory-only. The interface uses the name of the authentication method available on your computer: Windows Hello on Windows, Touch ID on macOS, "passkey" (in the browser's language) elsewhere.
- The popup shows no usage numbers: the SIWC docs offer no endpoint for them (they say not to call ChatGPT's `backend-api`, which is where Codex reads its limits) and ask apps to link to ChatGPT's usage settings instead.
