// Content script for X (x.com). While jimaku's button in a video's control bar is on, it shows the translation of the
// video's captions into the language chosen in the popup, translated with the ChatGPT plan, as on YouTube
// (src/content/main.ts, whose pieces it shares). X shows many videos at once, so every player whose CC button shows
// gets a button, and one video is translated at a time: turning one on turns the one before off.
// The source captions are X's own, read from the caption tracks on the <video> element (player.ts). While X's CC
// button is on, the overlay shows the source line with the translation, in place of X's captions.

import { createController } from '@jimaku/core/controller.ts';
import { fatalNotice, isFatalError, type Notice } from '@jimaku/core/errors.ts';
import { createHeadStart } from '@jimaku/core/head-start.ts';
import { DEFAULT_TARGET } from '@jimaku/core/languages.ts';
import { DEFAULT_POSITION, placeTranslation, type Placement } from '@jimaku/core/layout.ts';
import { createWaitMeter } from '@jimaku/core/metrics.ts';
import { createCaptionSession } from '@jimaku/core/session.ts';
import { translationKey } from '@jimaku/core/translation-cache.ts';
import { captionsFromCues, pickXTrack, postTitle, xCaptionsShown, xVideoId, type PickedTrack } from '@jimaku/core/x-video.ts';
import type { Caption } from '@jimaku/core/captions.ts';
import { createToggle, renderToggle } from '../content/button.ts';
import { createChatGPTTranslator, extensionAlive, warmUpChatGPT, watchSignIn } from '../content/chatgpt.ts';
import { mountOverlay } from '../content/overlay.ts';
import { loadTranslations, translationSaver } from '../content/translation-cache.ts';
import { t, uiLanguage } from '../shared/i18n.ts';
import { loadPosition, loadTargetLanguage, watchPosition, watchTargetLanguage } from '../shared/settings.ts';
import { captionSlots, hideXCaptions, loadCues, postOf, readControls, textTracksOf, trackInfo, videoOf } from './player.ts';

const log = (...args: unknown[]) => console.debug('[jimaku]', ...args);

// As on YouTube: messages in the browser's language, the one for a reloaded extension read while chrome.i18n answers
const UI_LANGUAGE = uiLanguage();
const noticeText = (notice: Notice) => t(notice.key, ...(notice.substitutions ?? []));
const RELOADED_NOTICE = noticeText(fatalNotice('extension_reloaded'));

// Under or over the source line, as chosen in the popup
let position = DEFAULT_POSITION;
// The language chosen in the popup, for the buttons' character (each video reads it again when it starts)
let targetLanguage = DEFAULT_TARGET;

// Each player gets an id the first time jimaku sees it, which the controller tells videos apart by. A player plays one
// video; X takes a player away when its post scrolls far off (or another page opens) and builds a new one for it later
const ids = new WeakMap<HTMLElement, string>();
const players = new Map<string, WeakRef<HTMLElement>>();
let nextId = 1;
const idOf = (player: HTMLElement) => {
  let id = ids.get(player);
  if (!id) {
    id = `x-player-${nextId++}`;
    ids.set(player, id);
    players.set(id, new WeakRef(player));
  }
  return id;
};
const playerOf = (id: string) => players.get(id)?.deref() ?? null;

// The player turned on last (null when none). Turning another one on moves it
let active: string | null = null;

// What a video's translation needs before its first request
type Prepared = { title?: string; videoId: string; track: PickedTrack['track']; target: string; captions: Caption[] };

// Picks the video's caption track for the chosen language and reads its captions. null when there is nothing to
// translate. Nothing here can be seen or undone by a press of the user's own, so a head start prepares in full too.
const prepare = async (id: string, signal: AbortSignal): Promise<Prepared | null> => {
  const player = playerOf(id);
  const video = player && videoOf(player);
  if (!player?.isConnected || !video) throw new Error('player not found');
  const target = await loadTargetLanguage();
  signal.throwIfAborted();
  const tracks = textTracksOf(video);
  const picked = pickXTrack(tracks.map(trackInfo), target);
  if (!picked) {
    log(`no captions to translate into ${target}`, id);
    return null;
  }
  const captions = captionsFromCues(await loadCues(video, tracks[picked.index], signal), video.duration);
  signal.throwIfAborted();
  if (!captions.length) {
    log('no captions within the video', id);
    return null;
  }
  const post = postOf(player);
  return { title: postTitle(post.text), videoId: xVideoId(video.poster, post.link) ?? id, track: picked.track, target, captions };
};

// The captions are read from the moment the pointer goes down on the button (see head-start.ts). Nothing is sent to
// the translator before the click.
const headStart = createHeadStart(prepare);

const start = async (id: string, signal: AbortSignal, onMounted: () => void) => {
  // Measure the time from turning jimaku on until the first translation is visible (TTFT)
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  warmUpChatGPT();
  const prepared = await headStart.take(id, signal);
  if (signal.aborted || !prepared) return;
  const { track, target, captions } = prepared;

  const player = playerOf(id);
  const video = player && videoOf(player);
  if (!player?.isConnected || !video) throw new Error('player not found');
  const captionsAt = elapsed();
  let placement: Placement | null = null;
  const waitMeter = createWaitMeter(() => performance.now());
  let firstShown = false;

  // Lines translated before, in this tab or another, are shown at once and not requested again
  const key = translationKey(prepared.videoId, track, target);
  const kept = await loadTranslations(key, captions.map((caption) => caption.text));
  if (signal.aborted) return;
  const { translations } = kept;
  const cached = translations.filter((translation) => translation).length;
  const saveTranslations = translationSaver(key, kept);

  const overlay = mountOverlay(player, target, UI_LANGUAGE, 'bottom', track.languageCode);
  const showXCaptions = hideXCaptions(video);
  const session = createCaptionSession({
    captions,
    translations,
    translator: createChatGPTTranslator({ source: track.languageCode, target }, 'x'),
    title: prepared.title,
    getCurrentTime: () => video.currentTime,
    onError: (error) => {
      log('translation failed', error);
      if (isFatalError(error) && error.code === 'extension_reloaded') return shutDown();
      // The session stops on these; it starts again when the user signs in (watchSignIn)
      if (isFatalError(error)) overlay.setNotice(noticeText(fatalNotice(error.code)));
    },
    isFatal: isFatalError,
    onChunkEnd: saveTranslations,
  });
  // When playback jumps (or a short video loops), translate the new position first
  const onSeeking = () => session.seek();
  video.addEventListener('seeking', onSeeking);
  signal.addEventListener(
    'abort',
    () => {
      video.removeEventListener('seeking', onSeeking);
      overlay.destroy();
      showXCaptions();
      // Keeps what arrived from the chunk cut off by turning jimaku off or leaving the video
      saveTranslations();
    },
    { once: true }
  );
  onMounted();

  const tick = () => {
    if (signal.aborted) return;
    requestAnimationFrame(tick);
    // A player taken out of the page draws nothing (syncButtons turns jimaku off for it)
    if (!player.isConnected) return;
    const lines = session.linesAt(video.currentTime);
    // The source line only while X's CC button is on, as X's own captions would show
    const withSource = xCaptionsShown(textTracksOf(video).map(trackInfo));
    overlay.setOrder(position);
    overlay.render(lines && { translation: lines.translation, ...(withSource ? { source: lines.source } : {}) });
    if (!firstShown && lines?.translation !== undefined) {
      firstShown = true;
      log(`[TTFT] first translation after ${elapsed()}ms (captions read after ${captionsAt}ms)`);
    }
    const waited = waitMeter.observe(lines?.index ?? null, lines?.translation !== undefined);
    if (waited !== null) log(`[TTFT] waited ${Math.round(waited)}ms for a translation`);
    // Where X's captions sit: near the bottom, and over the control bar while it shows. X's own are hidden, so
    // nothing else is placed around
    const rect = player.getBoundingClientRect();
    placement = placeTranslation(
      { enabled: false, playerTop: rect.top, playerBottom: rect.bottom, captions: [], controls: readControls(player) },
      { position, boxHeight: overlay.boxHeight(), previous: placement }
    );
    overlay.place(placement);
  };
  requestAnimationFrame(tick);

  log(
    `${captions.length} lines (${track.languageCode}${track.kind === 'asr' ? ', auto-generated' : ''} → ${target}),`,
    `${cached} already translated`
  );
  await session.run(signal);
};

const controller = createController(start, { onError: (error) => log('failed to start (will retry)', error) });

// Whether the user's next click on this player's button turns jimaku on
const aboutToTurnOn = (id: string) => extensionAlive() && !(active === id && controller.isEnabled());
let approachedAt = -Infinity;

// Each player's button, in a wrapper like the one around each of X's buttons in the row, just before the CC button's.
// The row goes whenever the control bar hides, so the button is put back each time it comes again
type Toggle = { wrapper: HTMLElement; button: HTMLButtonElement; iconSize?: number };
const toggles = new WeakMap<HTMLElement, Toggle>();

const toggleFor = (player: HTMLElement, captionsButton: HTMLElement): Toggle => {
  const existing = toggles.get(player);
  if (existing) return existing;
  const id = idOf(player);
  const button = createToggle(
    {
      onClick: () => {
        if (!extensionAlive()) return shutDown();
        if (active === id && controller.isEnabled()) {
          controller.setEnabled(false);
        } else {
          active = id;
          controller.navigate(id);
          controller.setEnabled(true);
        }
        syncButtons();
      },
      // As on YouTube: wake the worker and the connection when the pointer or the focus reaches the button
      onApproach: () => {
        if (!aboutToTurnOn(id) || performance.now() - approachedAt < 5000) return;
        approachedAt = performance.now();
        warmUpChatGPT();
      },
      // The pointer went down on the button: read the captions now, ahead of the click
      onPress: () => {
        if (aboutToTurnOn(id)) headStart.begin(id);
      },
    },
    // X's buttons get their look from their classes
    captionsButton.className
  );
  // X's buttons hold their icon in an inner element that centres it, so the icon is centred here instead (measured:
  // 7px in from the edges of a 32px button, as on X's own). They also keep their 1px border transparent until hovered
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.borderColor = 'transparent';
  const wrapper = document.createElement('div');
  wrapper.append(button);
  // As big as the icon of X's CC button
  const iconSize = Math.round(captionsButton.querySelector('svg')?.getBoundingClientRect().width ?? 0) || undefined;
  const toggle = { wrapper, button, iconSize };
  toggles.set(player, toggle);
  return toggle;
};

const syncButtons = () => {
  const enabledId = controller.isEnabled() ? active : null;
  for (const { player, captionsButton } of captionSlots()) {
    const toggle = toggleFor(player, captionsButton);
    const slot = captionsButton.parentElement!;
    if (toggle.wrapper.nextElementSibling !== slot) slot.parentElement!.insertBefore(toggle.wrapper, slot);
    renderToggle(toggle.button, idOf(player) === enabledId, targetLanguage, false, toggle.iconSize);
  }
  // The player turned on left the page: turn jimaku off for it
  if (active && !playerOf(active)?.isConnected) {
    active = null;
    controller.navigate(null);
  }
  for (const [id, player] of players) if (!player.deref()) players.delete(id);
};

// X builds and takes away control bars all the time, so the buttons follow the page's changes (once a frame at most)
let syncScheduled = false;
const scheduleSync = () => {
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    if (extensionAlive()) syncButtons();
    else shutDown();
  });
};
const observer = new MutationObserver(scheduleSync);
let aliveTimer: ReturnType<typeof setInterval> | undefined;

// After the extension is reloaded or updated, this script keeps running in the open tab, cut off from the extension.
// It takes its buttons and captions down instead of showing stale ones, and says to reload the tab.
const shutDown = () => {
  clearInterval(aliveTimer);
  observer.disconnect();
  const wasEnabled = controller.isEnabled();
  const player = active ? playerOf(active) : null;
  controller.setEnabled(false);
  headStart.drop();
  for (const button of document.querySelectorAll('.jimaku-toggle')) button.parentElement?.remove();
  if (wasEnabled && player?.isConnected) mountOverlay(player, UI_LANGUAGE, UI_LANGUAGE).setNotice(RELOADED_NOTICE);
  log('the extension was reloaded; reload the tab to use the new one');
};

const init = async () => {
  position = await loadPosition().catch(() => DEFAULT_POSITION);
  watchPosition((value) => (position = value));
  targetLanguage = await loadTargetLanguage().catch(() => DEFAULT_TARGET);
  // A new language changes the buttons' character and starts the video on over (its track may change)
  watchTargetLanguage((code) => {
    targetLanguage = code;
    syncButtons();
    headStart.drop();
    controller.restart();
  });
  watchSignIn(() => controller.restart());

  observer.observe(document.documentElement, { childList: true, subtree: true });
  // A reloaded extension is noticed here too, while the page doesn't change
  aliveTimer = setInterval(() => (extensionAlive() ? syncButtons() : shutDown()), 1000);
  syncButtons();
};

init().catch((error) => log('failed to initialize', error));
