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
  // The native caption windows on screen, as measured (page coordinates). shifted: one that the shift raises
  captions: readonly { top: number; bottom: number; shifted: boolean }[];
};

// Whether the translation goes under or over the source (YouTube's own captions)
export const POSITIONS = ['below', 'above'] as const;
export type Position = (typeof POSITIONS)[number];
export const DEFAULT_POSITION: Position = 'below';

// A stored value as a position (anything else, such as nothing stored yet, is the default)
export const positionOf = (value: unknown): Position =>
  POSITIONS.find((position) => position === value) ?? DEFAULT_POSITION;

export type Placement = {
  // The translation's bottom edge, in px above the player's bottom edge
  bottom: number;
  // How far (px) YouTube's bottom captions are raised to make room for the translation under them
  shift: number;
};

export type PlaceOptions = {
  position: Position;
  // The translation's height on screen (0 while hidden)
  boxHeight: number;
  // What the last frame applied (null on the first)
  previous: Placement | null;
  gap?: number;
  // The lowest the translation goes, as a share of the player's height
  floor?: number;
};

// Where the translation goes next to the native captions. With CC off it sits at the floor.
// Only windows reaching into the lower half of the player count. Ones above it never meet the translation at the bottom,
// such as the "English / Click ⚙ for settings" hint YouTube shows at the top for a few seconds after CC is turned on.
// The native captions vanish briefly between lines, so keep the previous placement then and nothing bounces
// (only kept at or above the floor, which grows when the player does, say for fullscreen).
export const placeTranslation = (native: NativeCaptions, options: PlaceOptions): Placement => {
  const { position, boxHeight, previous, gap = 8, floor = 0.08 } = options;
  const base = (native.playerBottom - native.playerTop) * floor;
  if (!native.enabled) return { bottom: base, shift: 0 };
  // Back to where YouTube put them, before the last shift
  const middle = (native.playerTop + native.playerBottom) / 2;
  const captions = native.captions
    .map((caption) => {
      const raised = caption.shifted ? (previous?.shift ?? 0) : 0;
      return { top: caption.top + raised, bottom: caption.bottom + raised, shifted: caption.shifted };
    })
    .filter((caption) => caption.bottom > middle);
  if (captions.length === 0) return { bottom: Math.max(base, previous?.bottom ?? 0), shift: previous?.shift ?? 0 };

  // A window the shift cannot raise (one YouTube placed somewhere else) would end up under the translation, so then it
  // goes over the captions instead
  if (position === 'above' || captions.some((caption) => !caption.shifted)) {
    const lift = liftAbove(native.playerBottom, captions.map((caption) => caption.top), gap);
    return { bottom: Math.max(base, lift), shift: 0 };
  }
  // Below: the translation takes the captions' place (no lower than the floor), and the captions are raised above it.
  // While the translation is hidden, the captions stay where they are instead of dropping back for a moment.
  const captionsAt = native.playerBottom - Math.max(...captions.map((caption) => caption.bottom));
  const bottom = Math.max(base, captionsAt);
  const shift = boxHeight > 0 ? Math.max(0, bottom + boxHeight + gap - captionsAt) : (previous?.shift ?? 0);
  return { bottom, shift };
};
