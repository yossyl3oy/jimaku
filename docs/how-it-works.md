# How it works

How jimaku picks the captions, places the translation, caches it and keeps the sign-in. For installing and using it, see the [README](../README.md).

## Which captions are translated

Tracks already in the target language are skipped. Among the remaining tracks, jimaku selects one in this order of preference: human-written captions in the spoken language (the language of YouTube's auto-generated track), human-written English, the auto-generated track, then any other human-written captions. If all caption tracks are in the target language, no translation is shown. The prompt itself stays in Japanese; only the language names in it change.

## Where the translation goes

- Below original: the translation occupies the original position of YouTube's captions, which are shifted up by the height of the translation (a `translate` on YouTube's bottom caption windows, which use `bottom: 2%` and no transform of their own). Turning jimaku off puts them back. A caption window YouTube placed somewhere else (not bottom-anchored) can't be raised that way, so while one is in the lower half, the translation goes over the captions instead.
- Above original: the translation is stacked above YouTube's captions, which stay where they are.

With CC off, the translation sits near the bottom of the video either way. Caption windows in the upper half of the video are ignored, such as the "Click ⚙ for settings" hint YouTube shows at the top for a few seconds after CC is turned on.

## How far ahead it translates

Translation starts at the caption line being watched and asks for 10 lines at a time while the next of them starts within 5 minutes of playback (the 10 lines go together, so the last of them can run past the 5 minutes). Further lines are requested as playback gets near them, and the lines before the playback position only if playback goes back there, so a video closed after a few minutes uses the ChatGPT plan's usage for those minutes and about 5 more. While the video is paused, the 5 minutes ahead are still filled, then nothing more is requested until playback moves. A jump to a part not translated yet cuts off the request in flight and translates the new position first.

## Translation caching

Translated lines are cached for the 20 most recently used combinations of video, caption track and target language, up to 5 MB in all, and every tab shares them. Turning jimaku on again, returning to a video or opening it in another tab displays the cached translations immediately and requests only missing lines, including any that previously failed. Lines are added after each chunk of 10 and when translation stops. The background keeps the cache in `chrome.storage.session`, which stays in memory and is never written to disk, so closing the browser clears it and no record of the videos watched is left (`chrome.storage.local` would leave one). That storage also holds the authentication tokens, so the cache leaves half of its 10 MB free for them. It is kept inaccessible to content scripts, so they only ask the background to load and add translations, and it checks what they send.

## Sign-in and tokens

- Sign-in follows [OpenAI's flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): PKCE, and a redirect to `http://127.0.0.1:<port>/auth/callback`. Nothing listens there; a `declarativeNetRequest` session rule sends that navigation to the extension's `callback.html`. A redirect like this needs the page to be web accessible, so `callback.html` is, but only to `https://auth.openai.com`, where the navigation starts: other sites can't load it to find out that Jimaku is installed, now that its ID is fixed. The client ID issued at the first sign-in and the `ext_agent_host_id` are reused, to avoid creating duplicate registrations in your ChatGPT settings.
- The model is fixed (`gpt-6.1-terra`, reasoning off) and checked against the account's catalog once at sign-in, so a translation is a single request. It was chosen with the model benchmark (see [development.md](development.md#comparing-models)); a check made for an earlier model is ignored, so an account that signed in before the switch tries the new model and is checked again at its next sign-in.
- The tokens are kept in `chrome.storage.session` only (memory, cleared when the browser restarts). The SIWC terms require tokens to be stored locally under the user's control, and the docs say "Keep tokens out of browser storage".
- Saving sign-in credentials with a passkey writes the refresh token to `chrome.storage.local`, encrypted (AES-GCM) under a random data key. That key is stored only in encrypted form, protected by a key derived from the passkey's WebAuthn PRF output. This requires WebAuthn PRF (Windows 11 or a recent version of macOS, and a recent version of Chrome); without it, jimaku stays memory-only. The interface uses the name of the authentication method available on your computer: Windows Hello on Windows, Touch ID on macOS, "passkey" (in the browser's language) elsewhere.
- The popup shows no usage numbers: the SIWC docs offer no endpoint for them (they say not to call ChatGPT's `backend-api`, which is where Codex reads its limits) and ask apps to link to ChatGPT's usage settings instead.
