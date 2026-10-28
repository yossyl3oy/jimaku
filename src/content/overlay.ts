// Shows the translation over the video. The source is left to YouTube's own captions (the CC button); while they are
// shown, the translation goes under them (raising them to make room) or over them.

import { fitScale, type Placement } from '../core/layout.ts';

const HOST_ID = 'jimaku-overlay';
const SHIFT_STYLE_ID = 'jimaku-caption-shift';
const SHIFT_VAR = '--jimaku-caption-shift';

// YouTube's bottom-anchored caption windows, which the shift raises. They are placed with bottom: 2% and no transform,
// so the separate translate property moves them without touching YouTube's own positioning
export const SHIFTED_CAPTIONS = '.ytp-caption-window-container .ytp-caption-window-bottom';
const SHIFT_STYLE = `${SHIFTED_CAPTIONS} { translate: 0 calc(-1 * var(${SHIFT_VAR}, 0px)); }`;

const STYLE = `
:host {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 60;
  container-type: size;
}
.box {
  position: absolute;
  left: 50%;
  /* --bottom is set by place(); until then, the spot used with CC off */
  bottom: var(--bottom, 8%);
  transform: translateX(-50%);
  /* The box is transparent. A fixed width keeps lines at the same width after scaling as when measured */
  width: 90%;
  text-align: center;
  font-family: "YouTube Noto", Roboto, sans-serif;
  line-height: 1.35;
}
/* The line carries its language (lang), so Chinese and Korean get the browser's font for that script.
   Japanese fonts are named only for Japanese, so Chinese is not drawn with Japanese glyph shapes */
.line:lang(ja) { font-family: "YouTube Noto", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif; }
.box[hidden] { display: none; }
.line {
  display: block;
  width: fit-content;
  margin: 0 auto;
  padding: 0.1em 0.4em;
  background: rgba(8, 8, 8, 0.75);
  color: #fff;
}
/* A long line is shrunk slightly with --fit to fit on one line. If it still overflows, it wraps so no meaning is lost */
.line { max-width: 100%; box-sizing: border-box; }
.translation { font-size: calc(clamp(13px, 2.9cqw, 34px) * var(--fit, 1)); color: #ffe066; }
.measuring { white-space: nowrap; }
.translation.pending { color: rgba(255, 255, 255, 0.5); }
/* Why the translation stopped (not signed in, usage limit, ...) */
.notice {
  position: absolute;
  left: 50%;
  top: 6%;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 0.3em 0.8em;
  border-radius: 4px;
  background: rgba(8, 8, 8, 0.8);
  color: #fff;
  font: 14px "YouTube Noto", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
.notice[hidden] { display: none; }
`;

export type Overlay = {
  // The caption line at the playback position (null when there is none); its translation is undefined until translated
  render(line: { translation: string | undefined } | null): void;
  // Puts the translation at placement.bottom and raises YouTube's bottom captions by placement.shift
  place(placement: Placement): void;
  // The translation's height on screen (0 while hidden)
  boxHeight(): number;
  // A message shown at the top of the player (null hides it)
  setNotice(text: string | null): void;
  destroy(): void;
};

// target is the language of the translation and noticeLanguage that of the notices (BCP 47 codes)
export const mountOverlay = (player: HTMLElement, target: string, noticeLanguage: string): Overlay => {
  document.getElementById(HOST_ID)?.remove();
  document.getElementById(SHIFT_STYLE_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  // YouTube enforces Trusted Types, so innerHTML isn't used
  const style = document.createElement('style');
  style.textContent = STYLE;
  const box = document.createElement('div');
  box.className = 'box';
  box.hidden = true;
  const translationEl = document.createElement('span');
  translationEl.className = 'line translation';
  translationEl.lang = target;
  // lang does not set the writing direction; auto lays out a right-to-left translation right to left
  translationEl.dir = 'auto';
  box.append(translationEl);
  const noticeEl = document.createElement('div');
  noticeEl.className = 'notice';
  noticeEl.lang = noticeLanguage;
  noticeEl.hidden = true;
  shadow.append(style, box, noticeEl);
  player.appendChild(host);
  // YouTube's captions are outside the shadow root, so their rule goes in the page
  const shiftStyle = document.createElement('style');
  shiftStyle.id = SHIFT_STYLE_ID;
  shiftStyle.textContent = SHIFT_STYLE;
  document.head.append(shiftStyle);

  // Measure the width at the original size laid out on one line without wrapping, and shrink by the overflow
  const fitLine = (el: HTMLElement) => {
    el.style.setProperty('--fit', '1');
    el.classList.add('measuring');
    const scale = fitScale(el.clientWidth, el.scrollWidth);
    el.classList.remove('measuring');
    el.style.setProperty('--fit', String(scale));
  };
  // Measure again when the player's width changes (fullscreen, theater mode, etc.)
  const resizeObserver = new ResizeObserver(() => {
    if (!box.hidden) fitLine(translationEl);
  });
  resizeObserver.observe(host);

  // null: no caption line; undefined: waiting for its translation
  let shown: string | null | undefined = null;
  let placed: Placement | null = null;

  return {
    render(line) {
      const translation = line ? line.translation : null;
      if (translation === shown) return;
      shown = translation;
      // While waiting, show "…"; hide it with no caption line, or for a line that could not be translated (empty string)
      box.hidden = translation === null || translation === '';
      if (box.hidden) return;
      translationEl.textContent = translation ?? '…';
      translationEl.classList.toggle('pending', translation === undefined);
      fitLine(translationEl);
    },
    setNotice(text) {
      noticeEl.hidden = text === null;
      noticeEl.textContent = text ?? '';
    },
    place(placement) {
      if (placed?.bottom === placement.bottom && placed.shift === placement.shift) return;
      placed = placement;
      box.style.setProperty('--bottom', `${placement.bottom}px`);
      player.style.setProperty(SHIFT_VAR, `${placement.shift}px`);
    },
    boxHeight: () => (box.hidden ? 0 : box.getBoundingClientRect().height),
    destroy() {
      resizeObserver.disconnect();
      host.remove();
      // Put YouTube's captions back where they were
      shiftStyle.remove();
      player.style.removeProperty(SHIFT_VAR);
    },
  };
};
