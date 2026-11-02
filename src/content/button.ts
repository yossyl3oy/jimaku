// Puts jimaku's on/off button in the player's control bar (just left of the CC button), or in Shorts in the controls
// over the video (just left of their CC button). YouTube's own CC button is left alone. Like the CC button, the icon shows the state itself:
// a white plate while on and a transparent frame while off (YouTube's current player no longer
// draws the red underline under pressed buttons). The character on it follows the language translated into.

import { buttonGlyphOf, type ButtonGlyph } from '../core/button-glyph.ts';
import { t } from '../shared/i18n.ts';

const BUTTON_CLASS = 'jimaku-toggle';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Read when the script loads, in the browser's language
const LABEL = t('toggleLabel');

const createSvgElement = (name: string, attributes: Record<string, string>) => {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([k, v]) => element.setAttribute(k, v));
  return element;
};

// The same size and place as the CC button's plate
const BOARD = { x: '1', y: '3', width: '22', height: '18', rx: '2' };

// The character stays the same size in both states (see button-glyph.ts for the sizes)
const createGlyph = ({ text, fontSize, y, fontFamily }: ButtonGlyph, fill: string) => {
  const glyph = createSvgElement('text', {
    x: '12',
    y: String(y),
    'text-anchor': 'middle',
    'font-size': String(fontSize),
    'font-weight': '700',
    'font-family': fontFamily,
    fill,
  });
  glyph.textContent = text;
  return glyph;
};

// On: a white plate with the character cut out. Off: a 2px white frame on a transparent background with the
// character in white, the frame drawn like the CC button's (rounded outside, square inside).
// Sized 24x24 like the CC button. YouTube enforces Trusted Types, so innerHTML isn't used.
const createIcon = (pressed: boolean, glyph: ButtonGlyph, shadow: boolean) => {
  const svg = createSvgElement('svg', { viewBox: '0 0 24 24', width: '24', height: '24' });
  // The shadow of the icons in Shorts' controls (measured)
  if (shadow) svg.style.filter = 'drop-shadow(rgba(0, 0, 0, 0.8) 0px 0px 1px)';
  if (pressed) {
    const mask = createSvgElement('mask', { id: 'jimaku-toggle-mask' });
    mask.append(createSvgElement('rect', { ...BOARD, fill: '#fff' }), createGlyph(glyph, '#000'));
    svg.append(mask, createSvgElement('rect', { ...BOARD, fill: '#fff', mask: 'url(#jimaku-toggle-mask)' }));
  } else {
    const frame = createSvgElement('rect', {
      x: '2',
      y: '4',
      width: '20',
      height: '16',
      rx: '1',
      fill: 'none',
      stroke: '#fff',
      'stroke-width': '2',
    });
    svg.append(frame, createGlyph(glyph, '#fff'));
  }
  return svg;
};

export type ButtonSlot = { before: string; className: string; shadow: boolean };

const createButton = (onClick: () => void, className: string) => {
  const button = document.createElement('button');
  button.className = `${className} ${BUTTON_CLASS}`;
  // Shorts' controls let the pointer through to the video except on their buttons
  button.style.pointerEvents = 'all';
  button.setAttribute('aria-label', LABEL);
  button.title = LABEL;
  button.addEventListener('click', (event) => {
    // So the click doesn't reach the player (play/pause)
    event.stopPropagation();
    // Only the user turns jimaku on, since it spends the ChatGPT plan's usage: a script on the page can call click()
    // on the button too. A click or Enter / Space from the user is trusted
    if (!event.isTrusted) return;
    onClick();
  });
  return button;
};

// Swaps the icon only when the state or the language changes, since sync runs again and again
const render = (button: HTMLButtonElement, pressed: boolean, language: string, shadow: boolean) => {
  const state = String(pressed);
  if (button.getAttribute('aria-pressed') === state && button.dataset.language === language) return;
  button.setAttribute('aria-pressed', state);
  button.dataset.language = language;
  button.replaceChildren(createIcon(pressed, buttonGlyphOf(language), shadow));
};

// Each sync(pressed, language, slot) call checks the button is in the slot's controls and syncs its pressed state
// and its character (language is the one translated into). The slot is the watch page's or the Shorts' one.
// YouTube sometimes rebuilds the control bar, so put the button back if it's missing.
export const createToggleButton = (onClick: () => void) => {
  let button: HTMLButtonElement | null = null;

  return {
    sync(pressed: boolean, language: string, slot: ButtonSlot) {
      const before = document.querySelector<HTMLElement>(slot.before);
      if (!before?.parentElement) return;
      if (!button || button.nextElementSibling !== before) {
        button?.remove();
        button = createButton(onClick, slot.className);
        before.parentElement.insertBefore(button, before);
      }
      render(button, pressed, language, slot.shadow);
    },
    remove() {
      button?.remove();
      button = null;
    },
  };
};
