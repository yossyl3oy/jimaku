// Puts jimaku's on/off button in the player's control bar (just left of the CC button).
// YouTube's own CC button is left alone. The red underline while pressed is drawn by YouTube's CSS
// (.ytp-button[aria-pressed="true"]::after) as is.

import { t } from '../shared/i18n.ts';

const BUTTON_CLASS = 'jimaku-toggle';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Read when the script loads, in the browser's language
const LABEL = t('toggleLabel');

// An icon of a white rounded plate with "訳" cut out. Sized 24x24 like the CC button.
// YouTube enforces Trusted Types, so innerHTML isn't used.
const createIcon = () => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');

  const mask = document.createElementNS(SVG_NS, 'mask');
  mask.id = 'jimaku-toggle-mask';
  const maskBoard = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ x: '1', y: '3', width: '22', height: '18', rx: '2', fill: '#fff' }).forEach(([k, v]) =>
    maskBoard.setAttribute(k, v)
  );
  const glyph = document.createElementNS(SVG_NS, 'text');
  Object.entries({
    x: '12',
    y: '17',
    'text-anchor': 'middle',
    'font-size': '13',
    'font-weight': '700',
    'font-family': '"Hiragino Sans", "Noto Sans JP", sans-serif',
    fill: '#000',
  }).forEach(([k, v]) => glyph.setAttribute(k, v));
  glyph.textContent = '訳';
  mask.append(maskBoard, glyph);

  const board = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ x: '1', y: '3', width: '22', height: '18', rx: '2', fill: '#fff', mask: 'url(#jimaku-toggle-mask)' }).forEach(
    ([k, v]) => board.setAttribute(k, v)
  );
  svg.append(mask, board);
  return svg;
};

const createButton = (onClick: () => void) => {
  const button = document.createElement('button');
  button.className = `ytp-button ${BUTTON_CLASS}`;
  button.setAttribute('aria-label', LABEL);
  button.title = LABEL;
  button.append(createIcon());
  button.addEventListener('click', (event) => {
    // So the click doesn't reach the player (play/pause)
    event.stopPropagation();
    onClick();
  });
  return button;
};

// Each sync(pressed) call checks the button is in the current control bar and syncs its pressed state.
// YouTube sometimes rebuilds the control bar, so put the button back if it's missing.
export const createToggleButton = (onClick: () => void) => {
  let button: HTMLButtonElement | null = null;

  return {
    sync(pressed: boolean) {
      const subtitles = document.querySelector<HTMLElement>('#movie_player .ytp-subtitles-button');
      if (!subtitles?.parentElement) return;
      if (!button || button.nextElementSibling !== subtitles) {
        button?.remove();
        button = createButton(onClick);
        subtitles.parentElement.insertBefore(button, subtitles);
      }
      button.setAttribute('aria-pressed', String(pressed));
    },
    remove() {
      button?.remove();
      button = null;
    },
  };
};
