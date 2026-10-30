# Development

Building, testing and releasing jimaku, and where to change things. How it behaves is in [How it works](how-it-works.md).

## Tests

```bash
mise exec -- pnpm test
mise exec -- pnpm typecheck
mise exec -- pnpm bench   # TTFT benchmark
```

Caption JSON fixtures (`tests/fixtures/`) make it possible to test everything from parsing to the translation flow without a DOM. The ChatGPT sign-in, token refresh, vault and streaming are tested against a fake OpenAI service and in-memory storage (`tests/fakes.ts`). The real sign-in and the passkey prompt can only be checked in Chrome.

## Layout

What each file under `src/` does is listed in [layout.md](layout.md).

## TTFT (time until the first translation is visible)

See [ttft.md](ttft.md) for how jimaku reduces the wait for the first translation and how to measure it.

## Comparing models

The development build (`mise exec -- pnpm build`) adds a benchmark page (`src/bench/`) when `bench-data/captions.json` is there; the release build leaves it out. Load `dist/`, sign in, and open `chrome-extension://bineloccjadloiohooadhfclifcfdbai/bench.html`. It translates the same caption chunks with each model in the account's catalog (`GET /v1/models`), at the lowest reasoning effort each one accepts, and with each prompt in `src/bench/prompts.ts`. For each, it shows the time to the first translated line, the tokens per request and per line, how many lines came back, and the translations next to a human translation. Download JSON saves the full report. Every request counts toward the plan's usage, and the page shows an estimate before running.

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

gpt-6-sol translated most faithfully, but its tokens weigh 20 times gpt-6-luna's, so it took about 6.4 credits for each hour of captions against 0.33, and half of a Pro plan's usage within days. gpt-6-luna is back, with the English instructions, which take about a third fewer input tokens. Its translations are slightly less steady: now and then it moves a phrase to the neighbouring line (Japanese puts the verb last, so a sentence split over lines doesn't always split cleanly), once it shifted a whole chunk of auto-generated captions by a line, and at the start of a video, with no earlier translations to follow, it may leave a speaker label as "CA:". Rules spelling this out ("stricter rules") made no difference. The server took 1.4-2.3s to start answering in every case, varying between runs, so the first-line times differ by less than that. Models that need reasoning (gpt-6.1-sol, gpt-6-astra) were 0.7-1.2s slower, with more tokens. The line check looks at 22 places, so it misses some moves that reading the translations found.

Then the prompt for gpt-6-luna was compared with one change at a time, 18 times each, side by side. "Lines in place" here covers every auto-generated line: a line is in place when its translation is closer to gpt-6-sol's translation of the same line (whose lines stayed in place best) than to its neighbours'. "Like the human translation" is the character n-gram F-score (chrF) against the TED translation, where the lines line up.

| Prompt for gpt-6-luna | Tokens / line | Plan credits / hour | First line after the headers | Speaker names | Lines in place | Like the human translation |
|---|---|---|---|---|---|---|
| **Copy each source line before its translation, with the rules below (now)** | **76** | **0.52** | **1.16s** | **100%** | **97%** | **0.37** |
| Copy only the first three words | 72 | 0.45 | 1.00s | 100% | 92% | 0.34 |
| Rules for sentence fragments, speaker labels and tone | 64 | 0.37 | 0.91s | 100% | 89% | 0.35 |
| English instructions of v0.5.0 | 52 | 0.33 | 0.95s | 56% | 85% | 0.32 |

Each rule alone helped less: writing speaker labels as names fixed them, keeping the tone removed the casual slips, but asking for sentence fragments alone made the lines move more. gpt-6-luna kept shifting the translations of auto-generated captions to the line before (Japanese puts the verb last), until it had to copy each source line before translating it; that costs about 0.2s before the first line and more output tokens, still a twelfth of gpt-6-sol's usage. It still translates the pun in the talk's title ("Why are you boring?", about The Boring Company) word for word, as no rule changed. The responses also showed two slips the parser now handles: a TAB written out as "\t", which lost whole chunks, and characters no language uses.

The captions come from `bench-data/captions.json`, which is not committed because captions belong to the video's owner. It holds windows of real captions: `{ video, title, windows: [{ track, start, offset, lines: [{ s, t, ref? }] }] }`, where each window has the 6 lines before the 10-line chunk (`start` is the chunk's first line in the track, `offset` the window's), the chunk and 4 lines after it, and `ref` is the human translation of a line where the tracks line up.

## Adding another translator

Pass `createPromptTranslator(stream, languages, warmup)` a function that sends the prompt and returns the response text bit by bit as it arrives (`AsyncIterable<string>`), and you get a `Translator` for that language pair (`{ source, target }`, BCP 47 codes). For `warmup`, pass something that sets up the connection ahead of time. Pick a model with a short time to first token and turn reasoning off (none / minimal).

Calling a real API from the content script is blocked by CORS, so the ChatGPT translator runs `stream` in the background service worker and receives the chunks over a port (`chrome.runtime.connect`, see `src/core/port-stream.ts`).

## Interface localization

The popup, the sign-in and unlock pages, the notices on the video, the player button's label and the extension's description come from `public/_locales/<locale>/messages.json` through `chrome.i18n` (`src/shared/i18n.ts`); pages mark their static text with `data-i18n`. There is one locale for each target language (`zh_CN` / `zh_TW` for Simplified / Traditional Chinese, `pt_BR` for Portuguese) and English is the default. Core code returns message keys rather than text (`fatalNotice` in `errors.ts`), so it stays free of `chrome.*`. `tests/locales.test.ts` checks that every locale has the same keys and placeholders, that every key the code uses exists and is used, and that the description fits within Chrome's 132-character limit. The prompt sent to ChatGPT is not UI text: its instructions are in English for every language.

## CI and security

The CI workflow (`.github/workflows/ci.yml`) runs the typecheck, the tests and the release build on every pull request, Dependabot's included, and on every push to `main`. Dependabot alerts and security updates are on for the repository.

## Releasing

1. Set the new version in both `package.json` and `public/manifest.json` (`tests/version.test.ts` checks they match).
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.

The Release workflow (`.github/workflows/release.yml`) runs on a `vX.Y.Z` tag. It checks that the tag matches both versions, runs type checking and tests, builds with `pnpm build:release` (only the files the extension loads, which `tests/build.test.ts` lists), zips `dist/` as `jimaku-vX.Y.Z.zip`, and creates a GitHub release with the ZIP file. The release notes list every commit since the previous version tag (merge commits left out), oldest first and each linked, followed by a link comparing the two tags.

Dependabot (`.github/dependabot.yml`) opens a weekly pull request for the dev dependencies (grouped into one) and another for the GitHub Actions.

## Extension ID

The `key` in `public/manifest.json` (a public key) fixes the extension ID to `bineloccjadloiohooadhfclifcfdbai`, whatever folder the extension is loaded from. The saved sign-in and the passkey belong to that ID, and so does the "Jimaku" entry in ChatGPT's app usage settings (one per sign-in client). Without the key, an unpacked extension gets its ID from its folder's path, so each new folder started over with a new sign-in, a new passkey and a new entry in ChatGPT. `tests/extension-id.test.ts` checks the ID. The private key is not kept: loading an unpacked extension doesn't need it. The Chrome Web Store assigns its own key, so `key` has to be removed from a package uploaded there.

## Icon

`assets/icon.svg` is the source of the extension's icon (an orange speech bubble with two white caption lines, on a transparent background); the popup's header inlines the same shape. The PNGs in `public/icons/` are made from it with `mise exec -- pnpm icons`, which needs `rsvg-convert` (`brew install librsvg`).
