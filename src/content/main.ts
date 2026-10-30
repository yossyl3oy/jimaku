// Content script entry point. While the jimaku button in the control bar is on, it fetches the open video's captions
// and shows their translation into the language chosen in the popup, translated with the ChatGPT plan.
// The source captions are YouTube's own (the CC button); jimaku works independently of it.

import { createController } from '../core/controller.ts';
import { fatalNotice, isFatalError, type Notice } from '../core/errors.ts';
import { DEFAULT_TARGET } from '../core/languages.ts';
import { DEFAULT_POSITION, placeTranslation, type NativeCaptions, type Placement } from '../core/layout.ts';
import { createWaitMeter } from '../core/metrics.ts';
import { createCaptionSession } from '../core/session.ts';
import { buildCaptionUrl, pickSourceTrack } from '../core/tracks.ts';
import { translationKey } from '../core/translation-cache.ts';
import { t, uiLanguage } from '../shared/i18n.ts';
import { loadPosition, loadTargetLanguage, watchPosition, watchTargetLanguage } from '../shared/settings.ts';
import { createToggleButton } from './button.ts';
import { createChatGPTTranslator, extensionAlive, warmUpChatGPT, watchSignIn } from './chatgpt.ts';
import { mountOverlay, SHIFTED_CAPTIONS } from './overlay.ts';
import { loadTranslations, translationSaver } from './translation-cache.ts';
import {
  fetchCaptions,
  fetchPlayerResponse,
  getPlayerCaptionUrl,
  freshCaptionUrl,
  getVideoId,
  waitWhileAdShowing,
  watchPlayerCaptionRequests,
} from './youtube.ts';

const log = (...args: unknown[]) => console.debug('[jimaku]', ...args);

const PLAYER_SELECTOR = '#movie_player, .html5-video-player';

// Messages to the user are in the browser's language. The one for a reloaded extension is read now, while chrome.i18n
// still answers (an orphaned script may no longer reach it)
const UI_LANGUAGE = uiLanguage();
const noticeText = (notice: Notice) => t(notice.key, ...(notice.substitutions ?? []));
const RELOADED_NOTICE = noticeText(fatalNotice('extension_reloaded'));

// Under or over YouTube's captions, as chosen in the popup (it applies on the next frame)
let position = DEFAULT_POSITION;

// The language chosen in the popup, for the button's character (each video reads it again when it starts)
let targetLanguage = DEFAULT_TARGET;

// The current state of YouTube's own captions (whether the CC button is on, and the caption windows on screen)
const readNativeCaptions = (playerEl: HTMLElement): NativeCaptions => {
  const player = playerEl.getBoundingClientRect();
  return {
    enabled: playerEl.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true',
    playerTop: player.top,
    playerBottom: player.bottom,
    captions: [...playerEl.querySelectorAll<HTMLElement>('.ytp-caption-window-container .caption-window')].flatMap((el) => {
      const rect = el.getBoundingClientRect();
      return rect.height > 0 ? [{ top: rect.top, bottom: rect.bottom, shifted: el.matches(SHIFTED_CAPTIONS) }] : [];
    }),
  };
};

const start = async (videoId: string, signal: AbortSignal, onMounted: () => void) => {
  // Measure the time from opening the video until the first translation is visible (TTFT)
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  // Warm up the connection to the translator while the captions are being fetched
  warmUpChatGPT();
  const [player, target] = await Promise.all([fetchPlayerResponse(videoId, signal), loadTargetLanguage()]);
  if (signal.aborted) return;
  const track = player && pickSourceTrack(player, target);
  if (!track) {
    log(`no captions to translate into ${target}`, videoId);
    return;
  }
  const languages = { source: track.languageCode, target };

  // The player may just not be built yet, so throw and let it be retried
  const playerEl = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
  const video = playerEl?.querySelector<HTMLVideoElement>('video');
  if (!playerEl || !video) throw new Error('player not found');

  // If the caption URL is already known (the CC button was on, etc.), fetch the captions and start translating during the ad.
  // Otherwise the only way is to press the CC button so the player fetches them, and during an ad the player doesn't fetch
  // the video's captions, so wait for the ad to end.
  const knownCaptionUrl = freshCaptionUrl(videoId);
  if (!knownCaptionUrl) await waitWhileAdShowing(playerEl, signal);
  const playerCaptionUrl = knownCaptionUrl ?? (await getPlayerCaptionUrl(videoId, signal));
  const captions = await fetchCaptions(buildCaptionUrl(track.baseUrl, playerCaptionUrl), signal);
  if (signal.aborted) return;
  if (!captions.length) {
    log('captions are empty', videoId);
    return;
  }
  const captionsAt = elapsed();

  // During an ad, video.currentTime is the ad's time, so the video's position is updated only outside ads
  const isAdShowing = () => playerEl.classList.contains('ad-showing');
  // When started during an ad, translate from the start of the video
  let contentTime = isAdShowing() ? 0 : video.currentTime;
  let wasAdShowing = isAdShowing();
  let placement: Placement | null = null;
  const waitMeter = createWaitMeter(() => performance.now());
  let firstShown = false;

  // Lines translated before, in this tab or another, are shown at once and not requested again
  const key = translationKey(videoId, track, target);
  const kept = await loadTranslations(key, captions.map((caption) => caption.text));
  if (signal.aborted) return;
  const { translations } = kept;
  const cached = translations.filter((translation) => translation).length;
  const saveTranslations = translationSaver(key, kept);

  const overlay = mountOverlay(playerEl, target, UI_LANGUAGE);
  const session = createCaptionSession({
    captions,
    translations,
    translator: createChatGPTTranslator(languages),
    title: player.videoDetails?.title,
    getCurrentTime: () => contentTime,
    onError: (error) => {
      log('translation failed', error);
      // The extension was reloaded under the tab: take everything down now (its notice was read at load, since
      // chrome.i18n may no longer answer here), rather than waiting for the next button check
      if (isFatalError(error) && error.code === 'extension_reloaded') return shutDown();
      // The session stops on these; it starts again when the user signs in (watchSignIn)
      if (isFatalError(error)) overlay.setNotice(noticeText(fatalNotice(error.code)));
    },
    isFatal: isFatalError,
    onChunkEnd: saveTranslations,
  });
  // When playback jumps, translate the new position first
  const onSeeking = () => {
    if (isAdShowing()) return;
    contentTime = video.currentTime;
    session.seek();
  };
  video.addEventListener('seeking', onSeeking);
  signal.addEventListener(
    'abort',
    () => {
      video.removeEventListener('seeking', onSeeking);
      overlay.destroy();
      // Keeps what arrived from the chunk cut off by turning jimaku off or leaving the video
      saveTranslations();
    },
    { once: true }
  );
  onMounted();

  const tick = () => {
    if (signal.aborted) return;
    const adShowing = isAdShowing();
    if (adShowing) {
      overlay.render(null);
      // The ad's own captions are left where YouTube puts them
      if (placement) overlay.place((placement = { ...placement, shift: 0 }));
    } else {
      contentTime = video.currentTime;
      // When the ad ends, translate the video's position first (playback may start partway in)
      if (wasAdShowing) session.seek();
      const lines = session.linesAt(contentTime);
      overlay.render(lines);
      if (!firstShown && lines?.translation !== undefined) {
        firstShown = true;
        log(`[TTFT] first translation after ${elapsed()}ms (captions fetched after ${captionsAt}ms)`);
      }
      const waited = waitMeter.observe(lines?.index ?? null, lines?.translation !== undefined);
      if (waited !== null) log(`[TTFT] waited ${Math.round(waited)}ms for a translation`);
      placement = placeTranslation(readNativeCaptions(playerEl), {
        position,
        boxHeight: overlay.boxHeight(),
        previous: placement,
      });
      overlay.place(placement);
    }
    wasAdShowing = adShowing;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  log(
    `${captions.length} lines (${track.languageCode}${track.kind === 'asr' ? ', auto-generated' : ''} → ${target}),`,
    `${cached} already translated`
  );
  await session.run(signal);
};

const controller = createController(start, { onError: (error) => log('failed to start (will retry)', error) });

// Turns jimaku on or off for the video open now (each video opens with it off)
const button = createToggleButton(() => {
  if (!extensionAlive()) return shutDown();
  controller.setEnabled(!controller.isEnabled());
  button.sync(controller.isEnabled(), targetLanguage);
});

let buttonTimer: ReturnType<typeof setInterval> | undefined;

// After the extension is reloaded or updated, this script keeps running in the open tab, cut off from the extension.
// It takes its button and captions down instead of showing stale ones, and says to reload the tab.
const shutDown = () => {
  clearInterval(buttonTimer);
  const wasEnabled = controller.isEnabled();
  controller.setEnabled(false);
  button.remove();
  const playerEl = document.querySelector<HTMLElement>(PLAYER_SELECTOR);
  if (wasEnabled && playerEl) mountOverlay(playerEl, UI_LANGUAGE, UI_LANGUAGE).setNotice(RELOADED_NOTICE);
  log('the extension was reloaded; reload the tab to use the new one');
};

const init = async () => {
  watchPlayerCaptionRequests();
  // Read the saved settings before watching videos
  position = await loadPosition().catch(() => DEFAULT_POSITION);
  watchPosition((value) => (position = value));
  targetLanguage = await loadTargetLanguage().catch(() => DEFAULT_TARGET);
  // Watched right after it is read, so a change made meanwhile isn't missed.
  // A new language changes the button's character and starts the open video over (fetching its captions again,
  // since the track may change)
  watchTargetLanguage((code) => {
    targetLanguage = code;
    button.sync(controller.isEnabled(), code);
    controller.restart();
  });
  watchSignIn(() => controller.restart());

  // YouTube is a SPA, so video changes are known from this event. Another video turns jimaku off, and the button
  // shows it at once. The connection is warmed up for every video, even while off, so turning jimaku on starts quickly
  const openVideo = () => {
    // A script cut off by a reloaded extension keeps getting this event: stay shut down instead of putting the button back
    if (!extensionAlive()) return shutDown();
    const videoId = getVideoId();
    if (videoId) warmUpChatGPT();
    controller.navigate(videoId);
    button.sync(controller.isEnabled(), targetLanguage);
  };
  window.addEventListener('yt-navigate-finish', openVideo);
  openVideo();

  // The control bar gets created later or rebuilt, so check the button periodically and put it back.
  // This is also where a reloaded extension is noticed
  const syncButton = () => (extensionAlive() ? button.sync(controller.isEnabled(), targetLanguage) : shutDown());
  buttonTimer = setInterval(syncButton, 1000);
  syncButton();
};

init().catch((error) => log('failed to initialize', error));
