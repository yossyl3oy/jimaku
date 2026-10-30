# TTFT (time until the first translation is visible)

How Jimaku reduces the wait for the first translation. See [How it works](how-it-works.md) for how jimaku works as a whole.

The goal is to keep the "…" placeholder on screen as briefly as possible:

- The translation streams back as "number<TAB>translation" lines, and each line is shown as soon as it arrives (no waiting for a whole 10-line response)
- Each translation batch starts at the current caption line rather than a fixed 10-line boundary
- When playback jumps to an untranslated section, the pending translation request is canceled and translation starts at the new position
- Player info is read straight from the page's player, instead of fetching the ~2MB watch page HTML again (about 700ms)
- If the caption URL is already known, captions are fetched and translation starts during the ad; otherwise it waits, because the video's captions can't be fetched while an ad plays. The end of an ad is detected as soon as the player's CSS class changes
- To obtain the caption URL (which includes the pot token), the CC button is pressed twice in a row: the player starts its request inside the click handler, and the request canceled by the second click still appears in the resource timing entries with its full URL. Measured on a watch page: about 10ms with CC off and 130-150ms with CC on, compared with 400ms or more when CC was left on for 200ms. The original CC setting is preserved
- When a video opens, even while jimaku is off, the content script wakes the service worker, refreshes the access token if needed, and opens the connection to `api.openai.com` (a `HEAD` without credentials, which gets a 401), so the first request skips the TLS handshake. The translator's `warmup()` does the same when translation starts, since the connection may have gone idle by the time jimaku is turned on

`mise exec -- pnpm bench` measures the wait with the mock translator (400ms to the first character, then 60ms per line), so it excludes time spent on YouTube interactions and network requests. On a real video, the `[TTFT]` logs (Verbose) show the wait times.
