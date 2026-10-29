# jimaku

A Chrome extension that puts a translation of YouTube's captions on the video. YouTube's own captions (the CC button) show the original, and jimaku adds the translation under them, or over them if you prefer. It translates captions and does nothing else.

Translation runs on your ChatGPT plan through OpenAI's Sign in with ChatGPT (for open-source and locally hosted apps). The Claude API is planned but not connected yet.

> **Use at your own risk.** Sign in with ChatGPT for open-source apps is still a preview, and I can't say for sure that a tool like jimaku is meant to use it. If you sign in with it, you do so at your own risk.

## Features

- One translation line under (or over) YouTube's captions; with CC off, just the translation
- 14 languages to translate into, Japanese by default
- Translation starts at the line you are watching and streams in line by line
- Translations are kept in the tab, so turning jimaku off and on or coming back to a video doesn't translate again
- No API key and no API charges: requests count toward the usage included in your ChatGPT plan
- The sign-in stays in memory, or behind Windows Hello / Touch ID if you choose
- Its screens follow the browser's language, in the same 14 languages (English for any other)

## Install

From a release: download `jimaku-vX.Y.Z.zip` from the [Releases](https://github.com/yossyl3oy/jimaku/releases) page and unzip it. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick the unzipped folder.

From source: you need Chrome, and [mise](https://mise.jdx.dev/) with pnpm (mise installs the Node version in `mise.toml`; pnpm's version is `packageManager` in `package.json`).

```bash
mise exec -- pnpm install
mise exec -- pnpm build
```

Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick `dist/`.

## Use

1. Click the jimaku icon in the toolbar, click Continue with ChatGPT and sign in. You can then save the sign-in behind Windows Hello / Touch ID, so a browser restart only needs that instead of signing in again.
2. Open a YouTube video that has captions. The translation of each caption line appears at the bottom of the video.
3. Turn jimaku on or off with the 訳 button in the player's control bar, just left of the CC button. The setting is remembered and shared across tabs. It works independently of CC: turn CC on to see the original captions.

In the popup (shown here in English; it follows the browser's language):

- **Translate into** — the language to translate into. Changing it starts the open videos over in the new language.
- **Subtitle position** — Below original (the default) or Above original. It applies right away, and the preview under it shows the order.
- **Manage usage** — opens your ChatGPT usage settings. jimaku shows no usage numbers of its own, because Sign in with ChatGPT offers no way to read them.

When translation can't continue (for example: not signed in, locked after a browser restart, usage limit reached, or the extension was updated under the tab), it stops and says why at the top of the video. It starts again by itself after you sign in or unlock; after an update, reload the tab.

### If something looks wrong

- Nothing shows up: look for `[jimaku]` logs in the DevTools console of the YouTube tab (set the log level to Verbose).
- After reloading or updating the extension, reload the YouTube tabs too. The old script in an open tab takes its button and translation down, and the new one starts only when the tab loads.
- The translation's lines are split differently from the captions: jimaku picks the track it translates by itself (see below), so when CC shows another track, such as the auto-generated one, the two can be split differently.

## How it works

### Which captions are translated

Tracks already in the target language are skipped. Of the rest, jimaku takes the first of: human-written captions in the spoken language (the language of YouTube's auto-generated track), human-written English, the auto-generated track, then any other human-written captions. A video whose captions are all in the target language is left alone. The prompt itself stays in Japanese; only the language names in it change.

### Where the translation goes

- Below original: the translation takes the place of YouTube's captions, and those are raised by the translation's height (a `translate` on YouTube's bottom caption windows, which use `bottom: 2%` and no transform of their own). Turning jimaku off puts them back. A caption window YouTube placed somewhere else (not bottom-anchored) can't be raised that way, so while one is in the lower half, the translation goes over the captions instead.
- Above original: the translation is stacked above YouTube's captions, which stay where they are.

With CC off, the translation sits near the bottom of the video either way. Caption windows in the upper half of the video are ignored, such as the "Click ⚙ for settings" hint YouTube shows at the top for a few seconds after CC is turned on.

### Translations kept in the tab

The lines translated so far are kept in the content script's memory, per video, caption track and target language (the 20 used most recently). Starting one of those again in the tab shows its lines at once and requests only the missing ones; lines that failed are tried again. Nothing is written to disk, so closing or reloading the tab forgets them. `chrome.storage.session` would keep them across reloads, but it holds the tokens and stays closed to content scripts, and `chrome.storage.local` would leave a record of the videos watched.

### Sign-in and tokens

- Sign-in follows [OpenAI's flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): PKCE, and a redirect to `http://127.0.0.1:<port>/auth/callback`. Nothing listens there; a `declarativeNetRequest` session rule sends that navigation to the extension's `callback.html`. The client ID issued at the first sign-in and the `ext_agent_host_id` are reused, so the registrations in your ChatGPT settings don't multiply.
- The model is fixed (`gpt-6-luna`, reasoning off) and checked against the account's catalog once at sign-in, so a translation is a single request.
- The tokens are kept in `chrome.storage.session` only (memory, cleared when the browser restarts). The SIWC terms require tokens to be stored locally under the user's control, and the docs say "Keep tokens out of browser storage".
- Saving the sign-in behind a passkey writes the refresh token to `chrome.storage.local`, encrypted (AES-GCM) under a random data key. That key is stored only wrapped by a key derived from the passkey's WebAuthn PRF output. This needs WebAuthn PRF (Windows 11 or recent macOS, and a recent Chrome); without it, jimaku stays memory-only. The screens name only the check this computer uses: Windows Hello on Windows, Touch ID on macOS, "passkey" (in the browser's language) elsewhere.
- The popup shows no usage numbers: the SIWC docs offer no endpoint for them (they say not to call ChatGPT's `backend-api`, which is where Codex reads its limits) and ask apps to link to ChatGPT's usage settings instead.

## Development

### Tests

```bash
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm bench   # TTFT benchmark
```

With just caption JSON (`tests/fixtures/`), everything from parsing to how translation proceeds can be tested without a DOM. The ChatGPT sign-in, token refresh, vault and streaming are tested against a fake OpenAI and in-memory storage (`tests/fakes.ts`). The real sign-in and the passkey prompt can only be checked in Chrome.

### Layout

What each file under `src/` does is listed in [docs/layout.md](docs/layout.md).

### TTFT (time until the first translation is visible)

The goal is to keep the "…" placeholder on screen as briefly as possible:

- The translation streams back as "number<TAB>translation" lines, and each line is shown as soon as it arrives (no waiting for a whole 10-line response)
- The range to translate starts at the line being watched, not at fixed 10-line blocks
- When playback jumps to an untranslated part, the chunk in flight is cut off and the new position is translated first
- Player info is read straight from the page's player, instead of fetching the ~2MB watch page HTML again (about 700ms)
- If the caption URL is already known, captions are fetched and translation starts during the ad; otherwise it waits, because the video's captions can't be fetched while an ad plays. The end of an ad is noticed the moment the player's class changes
- To get the caption URL (it carries the pot token), the CC button is pressed twice in a row: the player opens its request inside the click handler, and the request ended by the second press still shows up in the resource timing with its whole URL. Measured on a watch page: about 10ms with CC off and 130-150ms with CC on, against 400ms or more when the button was held on for 200ms. The native captions keep their on/off
- When a video opens, the translator's `warmup()` wakes the service worker, refreshes the access token if needed, and opens the connection to `api.openai.com` (a `HEAD` without credentials, which gets a 401), so the first request skips the TLS handshake

`mise exec -- pnpm bench` measures the wait with the mock translator (400ms to the first character, then 60ms per line), so it doesn't show the YouTube or network steps. On a real video, the `[TTFT]` logs (Verbose) show the wait times.

### Adding another translator

Pass `createPromptTranslator(stream, languages, warmup)` a function that sends the prompt and returns the response text bit by bit as it arrives (`AsyncIterable<string>`), and you get a `Translator` for that language pair (`{ source, target }`, BCP 47 codes). For `warmup`, pass something that sets up the connection ahead of time. Pick a model with a short time to first token and turn reasoning off (none / minimal).

Calling a real API from the content script is blocked by CORS, so the ChatGPT translator runs `stream` in the background service worker and receives the chunks over a port (`chrome.runtime.connect`, see `src/core/port-stream.ts`).

### Languages of the screens

The popup, the sign-in and unlock pages, the notices on the video, the player button's label and the extension's description come from `public/_locales/<locale>/messages.json` through `chrome.i18n` (`src/shared/i18n.ts`); pages mark their static text with `data-i18n`. There is one locale for each target language (`zh_CN` / `zh_TW` for Simplified / Traditional Chinese, `pt_BR` for Portuguese) and English is the default. Core code returns message keys rather than text (`fatalNotice` in `errors.ts`), so it stays free of `chrome.*`. `tests/locales.test.ts` checks that every locale has the same keys and placeholders, that every key the code uses exists and is used, and that the description fits Chrome's 132 characters. The prompt sent to ChatGPT is not UI text and stays in Japanese.

### Releasing

1. Set the new version in both `package.json` and `public/manifest.json` (`tests/version.test.ts` checks they match).
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.

The Release workflow (`.github/workflows/release.yml`) runs on a `vX.Y.Z` tag. It checks that the tag matches both versions, runs the typecheck and the tests, builds, zips `dist/` as `jimaku-vX.Y.Z.zip`, and creates a GitHub release with it and notes generated from the commits.

Dependabot (`.github/dependabot.yml`) opens a weekly pull request for the dev dependencies (grouped into one) and another for the GitHub Actions.

### Icon

`assets/icon.svg` is the source of the extension's icon (an orange speech bubble with two white caption lines, on a transparent background); the popup's header inlines the same shape. The PNGs in `public/icons/` are made from it with `mise exec -- pnpm icons`, which needs `rsvg-convert` (`brew install librsvg`).

## Going forward

Security and prompt efficiency are the two things I plan to keep working on: keeping the tokens and the saved sign-in as tightly held as they can be, and getting the same translations out of fewer tokens.

## Special thanks

jimaku came together quickly thanks to [Shizue](https://github.com/rokrokss/shizue) by rokrokss. Thank you! I only used its caption features, so, since it is MIT-licensed, I rebuilt just that part as a small extension of its own. See `NOTICE` for which code came from Shizue.

## License

MIT (see `LICENSE`). The code taken from Shizue is MIT-licensed too; its copyright notice is in `NOTICE`.
