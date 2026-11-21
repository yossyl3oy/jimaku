# Development

Building, testing and releasing jimaku, and where to change things. How it behaves is in [How it works](how-it-works.md).

## Build

```bash
mise exec -- pnpm build           # Development builds into dist/chrome and dist/firefox (with the model benchmark page when its captions are there)
mise exec -- pnpm build:release   # Only what the extension loads (what CI and the release workflow build)
```

Both browsers are built from the same code; only `manifest.json` differs (`packages/extension/scripts/manifest.ts`). The commands run from the repository's root, which is a pnpm workspace (see [layout.md](layout.md)).

- Chrome: load `dist/chrome` from `chrome://extensions` ("Load unpacked"). After each build, click the reload button on Jimaku there and reload the open YouTube and X tabs.
- Firefox: open `about:debugging`, click "This Firefox", then "Load Temporary Add-on…" and pick any file in `dist/firefox`. After each build, click Reload there. A temporary add-on is gone when Firefox restarts.

## Chrome and Firefox

What differs between the two, and where it is handled:

- **The background.** Chrome runs `background.js` as a service worker; Firefox has no service workers for extensions and runs the same script as an event page (`background.scripts`). Each manifest names only its own.
- **The extension's own address.** Chrome's is `chrome-extension://<id>/` with the ID fixed by the manifest's `key` (below). Firefox's is `moz-extension://<uuid>/` with a UUID made anew for every installation, so the rule that catches the sign-in callback builds its target from `chrome.runtime.getURL('')` (`callbackRule` in the core's `browser.ts`). Firefox's manifest also makes the callback page web accessible to `http://127.0.0.1/*`, the address being redirected: Firefox's own tests want it to match too, and the redirect was tried only that way.
- **The add-on ID.** Firefox needs `browser_specific_settings.gecko.id` (`jimaku@yossyl3oy.github.io`) to install an extension from a file or sign it, and takes no `key`. Like the key, it must never change. The oldest Firefox supported is 128, the first to run a content script in the page's world.
- **The passkey.** The saved sign-in is unlocked by a passkey whose relying party is the extension itself. Firefox does not let an extension be the relying party of its own passkey ([bug 1693562](https://bugzilla.mozilla.org/show_bug.cgi?id=1693562)), so there the callback page doesn't offer to save the sign-in and it stays in memory (`passkeysSupported` in `browser.ts`).
- **Signing.** Firefox's release and beta versions install only extensions signed by Mozilla. The Firefox ZIP of a release is not signed, so it is for temporary loading, and for the Firefox versions and forks that can turn the requirement off (see the README). Signing it would mean submitting each version to addons.mozilla.org, which also asks new extensions to declare the data they send (`data_collection_permissions`; jimaku sends the captions and the video's title to OpenAI, and on X the post's text).

Checked by hand in Firefox on 2026-11-14, with `dist/firefox` loaded as a temporary add-on: the 訳 button, the sign-in through the callback rule, and translating. The benchmark page and installing the unsigned ZIP for good were not tried there.

X (`x.js`) was checked by hand in Chrome on 2026-11-21, with `dist/chrome` loaded: the 訳 button in X's control bar (in a landscape and a portrait video) and translating with the ChatGPT plan. Before that, on 2026-11-20, its bundle ran inside x.com in a Chromium browser, with a stand-in for the `chrome.*` APIs and a translator that echoes each line: reading the captions (a creator's and auto-generated ones), the translation over the control bar, the original line with it while X's CC is on (with X's own hidden), both orders, a seek, turning another video on, and a post scrolling away. Not tried: X in Firefox (hiding X's captions there included), fullscreen, and X's media viewer.

## Tests

```bash
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm bench   # TTFT benchmark
```

`pnpm test` runs both packages' tests (`packages/core/tests/` and `packages/extension/tests/`). Caption JSON fixtures (`packages/core/tests/fixtures/`) make it possible to test everything from parsing to the translation flow without a DOM. The ChatGPT sign-in, token refresh, vault and streaming are tested against a fake OpenAI service and in-memory storage (`packages/core/tests/fakes.ts`). The real sign-in and the passkey prompt can only be checked in Chrome.

## Layout

The two packages, and what each file in them does, are listed in [layout.md](layout.md).

## TTFT (time until the first translation is visible)

See [ttft.md](ttft.md) for how jimaku reduces the wait for the first translation and how to measure it.

## Comparing models

The development build (`mise exec -- pnpm build`) adds a benchmark page (`packages/extension/src/bench/`) when `bench-data/captions.json` is there; the release build leaves it out. Load `dist/chrome`, sign in, and open `chrome-extension://bineloccjadloiohooadhfclifcfdbai/bench.html`. It translates the same caption chunks with each model in the account's catalog (`GET /v1/models`), at the lowest reasoning effort each one accepts, and with each prompt in `packages/extension/src/bench/prompts.ts`. For each, it shows the time to the first translated line, the tokens per request and per line, how many lines came back, and the translations next to a human translation. Download JSON saves the full report. Every request counts toward the plan's usage, and the page shows an estimate before running.

The last comparisons (2026-10-31, English to Japanese, 6 chunks of a TED talk with human and auto-generated captions) measured all 10 models in the catalog. Translations were scored by whether speaker names were translated instead of left as "CA:" / "EM:", and whether lines stayed in place (each auto-generated line keeps its own key words and none of its neighbours'). Plan usage is in credits per hour of captions, from the measured tokens and the credit rates per model on [OpenAI's pricing page](https://learn.chatgpt.com/docs/pricing); the ChatGPT plan's included usage isn't published in tokens, but it is weighted by model in a similar way.

| Model, prompt | Tokens / line | Plan credits / hour | First line after the headers | Speaker names | Lines in place |
|---|---|---|---|---|---|
| **gpt-6-luna, English instructions (v0.5.0; the prompt has changed since, below)** | **61** | **0.33** | **0.92s** | **73%** | **89%** |
| gpt-6-luna, Japanese instructions (up to v0.2.0) | 82 | 0.38 | 0.85s | 65% | 98% |
| gpt-6-luna, English with stricter rules | 73 | 0.36 | 0.86s | 59% | 94% |
| gpt-6.1-terra, Japanese instructions | 81 | 3.9 | 1.18s | 100% | 95% |
| gpt-6-sol, English instructions (v0.3.0 and v0.4.0) | 59 | 6.4 | 1.11s | 93% | 98% |
| gpt-6-sol, English, half the context | 52 | 6.0 | 1.31s | 22% | 100% |
| gpt-5.6-sol, English instructions | 59 | 13 | 0.95s | 78% | 95% |

gpt-6-sol translated most faithfully, but its tokens weigh 20 times gpt-6-luna's, so it took about 6.4 credits for each hour of captions against 0.33, and half of a Pro plan's usage within days (while every opened video was translated whole). So v0.5.0 went back to gpt-6-luna, with the English instructions, which take about a third fewer input tokens. Its translations were slightly less steady: now and then it moves a phrase to the neighbouring line (Japanese puts the verb last, so a sentence split over lines doesn't always split cleanly), once it shifted a whole chunk of auto-generated captions by a line, and at the start of a video, with no earlier translations to follow, it may leave a speaker label as "CA:". Rules spelling this out ("stricter rules") made no difference. The server took 1.4-2.3s to start answering in every case, varying between runs, so the first-line times differ by less than that. Models that need reasoning (gpt-6.1-sol, gpt-6-astra) were 0.7-1.2s slower, with more tokens. The line check looks at 22 places, so it misses some moves that reading the translations found.

Then the prompt for gpt-6-luna was compared with one change at a time, 18 times each, side by side. "Lines in place" here covers every auto-generated line: a line is in place when its translation is closer to gpt-6-sol's translation of the same line (whose lines stayed in place best) than to its neighbours'. "Like the human translation" is the character n-gram F-score (chrF) against the TED translation, where the lines line up.

| Prompt for gpt-6-luna | Tokens / line | Plan credits / hour | First line after the headers | Speaker names | Lines in place | Like the human translation |
|---|---|---|---|---|---|---|
| **Copy each source line before its translation, with the rules below (v0.6.0)** | **76** | **0.52** | **1.16s** | **100%** | **97%** | **0.37** |
| Copy only the first three words | 72 | 0.45 | 1.00s | 100% | 92% | 0.34 |
| Rules for sentence fragments, speaker labels and tone | 64 | 0.37 | 0.91s | 100% | 89% | 0.35 |
| English instructions of v0.5.0 | 52 | 0.33 | 0.95s | 56% | 85% | 0.32 |

Each rule alone helped less: writing speaker labels as names fixed them, keeping the tone removed the casual slips, but asking for sentence fragments alone made the lines move more. gpt-6-luna kept shifting the translations of auto-generated captions to the line before (Japanese puts the verb last), until it had to copy each source line before translating it; that costs about 0.2s before the first line and more output tokens, still a twelfth of gpt-6-sol's usage. It still translates the pun in the talk's title ("Why are you boring?", about The Boring Company) word for word, as no rule changed. The responses also showed two slips the parser now handles: a TAB written out as "\t", which lost whole chunks, and characters no language uses.

In use, though, gpt-6-luna's subtitles read word for word, which none of these scores caught. So four models were compared with three prompts on what a reader notices: a separate reviewer rated every version 1-5 without knowing which model or prompt made it (natural Japanese, faithful meaning, working as subtitles, sounding like the speaker), next to the scores above.

| Model and prompt | Overall | Natural | Faithful | As subtitles | Spoken | First line | Plan credits / hour |
|---|---|---|---|---|---|---|---|
| gpt-6.1-sol (reasoning "low", the least it takes), Japanese instructions | 4.3 | 4.3 | 4.5 | 4.7 | 4.3 | 5.4s | 8.7 |
| gpt-6-sol, Japanese instructions | 3.7 | 4.0 | 3.8 | 4.0 | 3.7 | 2.5s | 7.2 |
| **gpt-6.1-terra, Japanese instructions (now)** | **3.5** | **4.0** | **3.5** | **4.2** | **3.8** | **2.5s** | **3.5** |
| gpt-6-sol, copy each source line first | 3.7 | 4.0 | 4.2 | 3.3 | 4.0 | 2.8s | 10.2 |
| gpt-6.1-terra, copy each source line first | 3.3 | 3.7 | 3.7 | 3.3 | 3.8 | 2.7s | 5.0 |
| gpt-6.1-terra, English instructions | 3.2 | 3.7 | 3.5 | 3.7 | 3.5 | 2.8s | 3.0 |
| gpt-6-luna, copy each source line first (v0.6.0) | 2.8 | 3.0 | 3.7 | 2.8 | 3.2 | 2.5s | 0.52 |
| gpt-6-luna, Japanese instructions | 2.0 | 2.8 | 3.3 | 2.2 | 2.8 | 2.4s | 0.38 |

gpt-6-luna came last with every prompt (word-for-word phrasing, fragments in English word order, a line repeating its neighbour). With the other models the Japanese instructions read the most naturally, and copying each source line first made worse subtitles. gpt-6.1-sol translated best, the pun included, but it needs reasoning, so its first line takes over 5 seconds. gpt-6.1-terra read as naturally as gpt-6-sol and also got the pun, at half its plan usage, though slightly less faithfully. Each version covered the 6 chunks once and one reviewer scored them, so differences of a few tenths are within noise.

The captions come from `bench-data/captions.json`, which is not committed because captions belong to the video's owner. It holds windows of real captions: `{ video, title, windows: [{ track, start, offset, lines: [{ s, t, ref? }] }] }`, where each window has the 6 lines before the 10-line chunk (`start` is the chunk's first line in the track, `offset` the window's), the chunk and 4 lines after it, and `ref` is the human translation of a line where the tracks line up.

## Adding another translator

Pass `createPromptTranslator(stream, languages, warmup)` a function that sends the prompt and returns the response text bit by bit as it arrives (`AsyncIterable<string>`), and you get a `Translator` for that language pair (`{ source, target }`, BCP 47 codes). `warmup` is optional and nothing calls it yet: the content script warms up the ChatGPT translator itself (`warmUpChatGPT` in the extension's `src/content/chatgpt.ts`, see [ttft.md](ttft.md)), so another translator needs its own call there. Pick a model with a short time to first token and turn reasoning off (none / minimal).

Calling a real API from the content script is blocked by CORS, so the ChatGPT translator runs `stream` in the background service worker and receives the chunks over a port (`chrome.runtime.connect`, see `port-stream.ts` in the core).

## Interface localization

The popup, the sign-in and unlock pages, the notices on the video, the player button's label and the extension's description come from `packages/extension/public/_locales/<locale>/messages.json` through `chrome.i18n` (`src/shared/i18n.ts` in the extension); pages mark their static text with `data-i18n`. There is one locale for each target language (`zh_CN` / `zh_TW` for Simplified / Traditional Chinese, `pt_BR` for Portuguese) and English is the default. Core code returns message keys rather than text (`fatalNotice` in `errors.ts`), so it stays free of `chrome.*`. `tests/locales.test.ts` in the extension package checks that every locale has the same keys and placeholders, that every key the code uses exists and is used, and that the description fits within Chrome's 132-character limit. The prompt sent to ChatGPT is not UI text and stays in Japanese.

## CI and security

The CI workflow (`.github/workflows/ci.yml`) runs the typecheck, the tests and the release build on every pull request, Dependabot's included, and on every push to `main`. Dependabot alerts and security updates are on for the repository. Both workflows pin each action to a commit, with its version in a comment: a tag can be moved to other code, and the release job can publish what it builds.

## Releasing

1. Set the new version in the repository's `package.json`. It is the only place: every manifest is built with it.
2. Commit, tag, then push `main` and the tag: `git tag v0.1.0 && git push origin main v0.1.0`.

The Release workflow (`.github/workflows/release.yml`) runs on a `vX.Y.Z` tag. It checks that the tag matches that version, runs type checking and tests, builds with `pnpm build:release` (only the files the extension loads, which `tests/build.test.ts` in the extension package lists for each browser), zips `dist/chrome` as `jimaku-vX.Y.Z.zip` and `dist/firefox` as `jimaku-firefox-vX.Y.Z.zip`, and creates a GitHub release with both ZIP files. The release notes say which ZIP file is for which browser and that the Firefox one is unsigned and has no Windows Hello / Touch ID, then list every commit since the previous version tag (merge commits left out), oldest first and each linked, followed by a link comparing the two tags.

Dependabot (`.github/dependabot.yml`) opens a weekly pull request for the dev dependencies (grouped into one) and another for the GitHub Actions, which updates both the pinned commit and the version in the comment.

## Extension ID

The `key` in Chrome's manifest (a public key, in `packages/extension/scripts/manifest.ts`) fixes the extension ID to `bineloccjadloiohooadhfclifcfdbai`, whatever folder the extension is loaded from. The saved sign-in and the passkey belong to that ID, and so does the "Jimaku" entry in ChatGPT's app usage settings (one per sign-in client). Without the key, an unpacked extension gets its ID from its folder's path, so each new folder started over with a new sign-in, a new passkey and a new entry in ChatGPT. `tests/extension-id.test.ts` in the extension package checks the ID. The private key is not kept: loading an unpacked extension doesn't need it. The Chrome Web Store assigns its own key, so `key` has to be removed from a package uploaded there.

## Icon

`assets/icon.svg` is the source of the extension's icon (an orange speech bubble with two white caption lines, on a transparent background); the popup's header inlines the same shape. The PNGs in `packages/extension/public/icons/` are made from it with `mise exec -- pnpm icons`, which needs `rsvg-convert` (`brew install librsvg`).
