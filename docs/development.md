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

## Adding another translator

Pass `createPromptTranslator(stream, languages, warmup)` a function that sends the prompt and returns the response text bit by bit as it arrives (`AsyncIterable<string>`), and you get a `Translator` for that language pair (`{ source, target }`, BCP 47 codes). For `warmup`, pass something that sets up the connection ahead of time. Pick a model with a short time to first token and turn reasoning off (none / minimal).

Calling a real API from the content script is blocked by CORS, so the ChatGPT translator runs `stream` in the background service worker and receives the chunks over a port (`chrome.runtime.connect`, see `src/core/port-stream.ts`).

## Interface localization

The popup, the sign-in and unlock pages, the notices on the video, the player button's label and the extension's description come from `public/_locales/<locale>/messages.json` through `chrome.i18n` (`src/shared/i18n.ts`); pages mark their static text with `data-i18n`. There is one locale for each target language (`zh_CN` / `zh_TW` for Simplified / Traditional Chinese, `pt_BR` for Portuguese) and English is the default. Core code returns message keys rather than text (`fatalNotice` in `errors.ts`), so it stays free of `chrome.*`. `tests/locales.test.ts` checks that every locale has the same keys and placeholders, that every key the code uses exists and is used, and that the description fits within Chrome's 132-character limit. The prompt sent to ChatGPT is not UI text and stays in Japanese.

## CI and security

The CI workflow (`.github/workflows/ci.yml`) runs the typecheck, the tests and the build on every pull request, Dependabot's included, and on every push to `main`. Dependabot alerts and security updates are on for the repository.

## Releasing

1. Set the new version in both `package.json` and `public/manifest.json` (`tests/version.test.ts` checks they match).
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.

The Release workflow (`.github/workflows/release.yml`) runs on a `vX.Y.Z` tag. It checks that the tag matches both versions, runs type checking and tests, builds, zips `dist/` as `jimaku-vX.Y.Z.zip`, and creates a GitHub release with the ZIP file and release notes generated from the commits.

Dependabot (`.github/dependabot.yml`) opens a weekly pull request for the dev dependencies (grouped into one) and another for the GitHub Actions.

## Icon

`assets/icon.svg` is the source of the extension's icon (an orange speech bubble with two white caption lines, on a transparent background); the popup's header inlines the same shape. The PNGs in `public/icons/` are made from it with `mise exec -- pnpm icons`, which needs `rsvg-convert` (`brew install librsvg`).
