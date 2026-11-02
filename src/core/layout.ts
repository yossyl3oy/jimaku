// Pure functions that decide where the translated captions go.

// The font scale that fits a caption line on one line.
// If the width falls short, shrink down to min. Anything still overflowing wraps.
// Shrink a little more, by slack, so rounding after scaling does not push the last character out.
export const fitScale = (available: number, needed: number, min = 0.75, slack = 0.02): number => {
  if (needed <= 0 || available >= needed) return 1;
  return Math.max(min, available / (needed * (1 + slack)));
};

// The height (px) above the player's bottom edge that stacks the translation above YouTube's own captions.
// captionTops are the top edges (page coordinates) of the native captions on screen. 0 if none are shown.
export const liftAbove = (playerBottom: number, captionTops: readonly number[], gap = 8): number => {
  if (captionTops.length === 0) return 0;
  return Math.max(0, playerBottom - Math.min(...captionTops) + gap);
};

export type NativeCaptions = {
  // Whether the CC button is on
  enabled: boolean;
  playerTop: number;
  playerBottom: number;
  // The native caption windows on screen, as measured (page coordinates). shifted: one that the shift moves
  captions: readonly { top: number; bottom: number; shifted: boolean }[];
  // The control bar while it shows, as measured (page coordinates); absent or null while it is hidden
  controls?: { top: number; bottom: number } | null;
};

// The edge of the player YouTube's captions sit at: the bottom on a watch page, the top in Shorts (under the controls)
export type Edge = 'bottom' | 'top';

// Whether the translation goes under or over the source (YouTube's own captions)
export const POSITIONS = ['below', 'above'] as const;
export type Position = (typeof POSITIONS)[number];
export const DEFAULT_POSITION: Position = 'below';

// A stored value as a position (anything else, such as nothing stored yet, is the default)
export const positionOf = (value: unknown): Position =>
  POSITIONS.find((position) => position === value) ?? DEFAULT_POSITION;

export type Placement = {
  // How far (px) the translation is from that edge: its bottom edge above the player's bottom edge, or in Shorts its
  // top edge below the player's top edge
  offset: number;
  // How far (px) YouTube's captions at that edge are moved away from it to make room for the translation (raised on a
  // watch page, lowered in Shorts)
  shift: number;
};

export type PlaceOptions = {
  position: Position;
  // The translation's height on screen (0 while hidden)
  boxHeight: number;
  // What the last frame applied (null on the first)
  previous: Placement | null;
  gap?: number;
  // The lowest the translation goes, as a share of the player's height (in Shorts, the highest). By default where
  // YouTube's captions sit
  floor?: number;
  edge?: Edge;
};

// YouTube's bottom caption windows sit 2% of the player's height above its bottom edge (bottom: 2%), and while the
// control bar shows, they move up by the bar's height plus 8px (measured: a 70px margin, with the progress bar's top
// 62px above the bottom, on players 509px and 924px tall)
const CAPTIONS_AT = 0.02;

// Where the translation goes next to the native captions. With CC off it sits where YouTube's own captions would: at
// the floor, or while the control bar shows, where YouTube raises them to, so it sits as high as next to them with CC on. Next to them, it
// follows them over the bar instead (YouTube moves them there with a short transition, and jumping ahead would jerk
// them along with it).
// Only windows reaching into the lower half of the player count. Ones above it never meet the translation at the bottom,
// such as the "English / Click ⚙ for settings" hint YouTube shows at the top for a few seconds after CC is turned on.
// The native captions vanish briefly between lines, so keep the previous placement then and nothing bounces
// (only kept at or above the floor, which grows when the player does, say for fullscreen).
// In Shorts all of this is measured from the top edge instead, where only windows in the upper half count.
export const placeTranslation = (native: NativeCaptions, options: PlaceOptions): Placement => {
  const { position, boxHeight, previous, gap = 8, floor = CAPTIONS_AT, edge = 'bottom' } = options;
  // At the top, the same placement upside down, where "below" and "above" swap
  if (edge === 'top') {
    return placeTranslation(upsideDown(native), { ...options, edge: 'bottom', position: position === 'below' ? 'above' : 'below' });
  }
  const height = native.playerBottom - native.playerTop;
  const base = height * floor;
  // Where the translation goes on its own: the floor, or where YouTube's captions go while the control bar shows
  const overBar = native.controls ? height * CAPTIONS_AT + (native.playerBottom - native.controls.top) + gap : 0;
  const alone = Math.max(base, overBar);
  if (!native.enabled) return { offset: alone, shift: 0 };
  // Back to where YouTube put them, before the last shift
  const middle = (native.playerTop + native.playerBottom) / 2;
  const captions = native.captions
    .map((caption) => {
      const raised = caption.shifted ? (previous?.shift ?? 0) : 0;
      return { top: caption.top + raised, bottom: caption.bottom + raised, shifted: caption.shifted };
    })
    .filter((caption) => caption.bottom > middle);
  if (captions.length === 0) return { offset: Math.max(alone, previous?.offset ?? 0), shift: previous?.shift ?? 0 };

  // A window the shift cannot raise (one YouTube placed somewhere else) would end up under the translation, so then it
  // goes over the captions instead
  if (position === 'above' || captions.some((caption) => !caption.shifted)) {
    const lift = liftAbove(native.playerBottom, captions.map((caption) => caption.top), gap);
    return { offset: Math.max(base, lift), shift: 0 };
  }
  // Below: the translation takes the captions' place (no lower than the floor), and the captions are raised above it.
  // While the translation is hidden, the captions stay where they are instead of dropping back for a moment.
  const captionsAt = native.playerBottom - Math.max(...captions.map((caption) => caption.bottom));
  const offset = Math.max(base, captionsAt);
  const shift = boxHeight > 0 ? Math.max(0, offset + boxHeight + gap - captionsAt) : (previous?.shift ?? 0);
  return { offset, shift };
};

// The player and its captions flipped vertically, so that the top edge becomes the bottom one
const upsideDown = (native: NativeCaptions): NativeCaptions => ({
  ...native,
  playerTop: -native.playerBottom,
  playerBottom: -native.playerTop,
  captions: native.captions.map(({ top, bottom, shifted }) => ({ top: -bottom, bottom: -top, shifted })),
  controls: native.controls && { top: -native.controls.bottom, bottom: -native.controls.top },
});
