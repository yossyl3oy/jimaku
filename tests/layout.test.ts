import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POSITION, fitScale, liftAbove, placeTranslation, positionOf } from '../src/core/layout.ts';

test('fitScale: does not shrink when it fits', () => {
  assert.equal(fitScale(800, 600), 1);
  assert.equal(fitScale(800, 800), 1);
});

test('fitScale: shrinks by the overflow plus a little slack', () => {
  assert.equal(fitScale(800, 1000, 0.75, 0), 0.8);
  assert.equal(fitScale(800, 1000), 800 / 1020);
});

test('fitScale: does not shrink too far (the rest is left to ellipsis or wrapping)', () => {
  assert.equal(fitScale(400, 1000), 0.75);
  assert.equal(fitScale(400, 1000, 0.5), 0.5);
});

test('fitScale: does not shrink when the width cannot be measured', () => {
  assert.equal(fitScale(800, 0), 1);
});

test('liftAbove: does not lift when no native caption is shown', () => {
  assert.equal(liftAbove(600, []), 0);
});

test('liftAbove: places it gap above the topmost native caption', () => {
  // Player bottom 600, caption tops 520 and 540 → 600 - 520 + 8
  assert.equal(liftAbove(600, [540, 520]), 88);
  assert.equal(liftAbove(600, [520], 0), 80);
});

// Player 0-600, so the floor is 12px (2%, where YouTube's captions sit); one caption line 540-578, a little higher
// (22px above the bottom)
const player = { playerTop: 0, playerBottom: 600 };
const line = { top: 540, bottom: 578, shifted: true };
const cc = (captions: { top: number; bottom: number; shifted: boolean }[]) => ({ enabled: true, ...player, captions });

test('placeTranslation: with CC off, sits at the floor and raises nothing', () => {
  const off = { enabled: false, ...player, captions: [] };
  for (const position of ['below', 'above'] as const) {
    assert.deepEqual(placeTranslation(off, { position, boxHeight: 40, previous: { offset: 100, shift: 50 } }), {
      offset: 12,
      shift: 0,
    });
  }
});

test('placeTranslation above: stacks over the native captions', () => {
  assert.deepEqual(placeTranslation(cc([line]), { position: 'above', boxHeight: 40, previous: null }), {
    offset: 68,
    shift: 0,
  });
});

test('placeTranslation below: takes the place of the captions and raises them over it by its height plus the gap', () => {
  // The translation spans 538-578; the captions are raised by 22 + 40 + 8 - 22 = 48 to 492-530
  assert.deepEqual(placeTranslation(cc([line]), { position: 'below', boxHeight: 40, previous: null }), {
    offset: 22,
    shift: 48,
  });
});

test('placeTranslation below: no lower than the floor', () => {
  // A caption line 4px above the bottom: the translation stays at 12px, and the captions go over it (12 + 40 + 8 - 4)
  const low = { top: 558, bottom: 596, shifted: true };
  assert.deepEqual(placeTranslation(cc([low]), { position: 'below', boxHeight: 40, previous: null }), { offset: 12, shift: 56 });
});

test('placeTranslation below: measuring the raised captions next frame gives the same placement (no drift)', () => {
  const first = placeTranslation(cc([line]), { position: 'below', boxHeight: 40, previous: null });
  const raised = { top: line.top - first.shift, bottom: line.bottom - first.shift, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised]), { position: 'below', boxHeight: 40, previous: first }), first);
});

test('placeTranslation below: follows the captions up when the control bar shows', () => {
  // Measured on a watch page: player 68-428, the caption line 313-351 with the controls showing (77px above the bottom)
  const native = { enabled: true, playerTop: 68, playerBottom: 428, captions: [{ top: 313, bottom: 351, shifted: true }] };
  assert.deepEqual(placeTranslation(native, { position: 'below', boxHeight: 30, previous: null }), {
    offset: 77,
    shift: 38,
  });
});

test('placeTranslation below: while the translation is hidden, the captions stay raised', () => {
  const previous = { offset: 22, shift: 48 };
  const raised = { top: line.top - 48, bottom: line.bottom - 48, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised]), { position: 'below', boxHeight: 0, previous }), previous);
});

test('placeTranslation: keeps the last placement when the native captions vanish between lines', () => {
  const previous = { offset: 22, shift: 48 };
  assert.deepEqual(placeTranslation(cc([]), { position: 'below', boxHeight: 40, previous }), previous);
  assert.deepEqual(placeTranslation(cc([]), { position: 'above', boxHeight: 40, previous: null }), { offset: 12, shift: 0 });
});

test('placeTranslation: switching to above lowers the captions back and stacks over where YouTube put them', () => {
  const raised = { top: line.top - 48, bottom: line.bottom - 48, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised]), { position: 'above', boxHeight: 40, previous: { offset: 22, shift: 48 } }), {
    offset: 68,
    shift: 0,
  });
});

test('placeTranslation: a kept placement stays at or above the floor after the player grows', () => {
  // Fullscreen between two caption lines: 600px tall → 1080px tall, so the floor goes from 12 to 21.6
  const tall = { enabled: true, playerTop: 0, playerBottom: 1080, captions: [] };
  assert.deepEqual(placeTranslation(tall, { position: 'below', boxHeight: 40, previous: { offset: 12, shift: 56 } }), {
    offset: 1080 * 0.02,
    shift: 56,
  });
});

test('placeTranslation below: goes over the captions when one of them cannot be raised', () => {
  // A window YouTube placed itself (not bottom-anchored) at 480-518 stays put, so stacking under it would overlap
  const placed = { top: 480, bottom: 518, shifted: false };
  assert.deepEqual(placeTranslation(cc([placed]), { position: 'below', boxHeight: 40, previous: null }), {
    offset: 128,
    shift: 0,
  });
  const raised = { top: line.top - 48, bottom: line.bottom - 48, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised, placed]), { position: 'below', boxHeight: 40, previous: { offset: 22, shift: 48 } }), {
    offset: 128,
    shift: 0,
  });
});

// Measured on a watch page: player 68-428, the hint 92-130 (not raised by the shift), the first caption line 385-423
test('placeTranslation: ignores windows in the upper half, like the "Click ⚙ for settings" hint after CC is turned on', () => {
  const measured = { enabled: true, playerTop: 68, playerBottom: 428 };
  const hint = { top: 92, bottom: 130, shifted: false };
  assert.deepEqual(placeTranslation({ ...measured, captions: [hint] }, { position: 'above', boxHeight: 30, previous: null }), {
    offset: 360 * 0.02,
    shift: 0,
  });
  const withLine = { ...measured, captions: [hint, { top: 385, bottom: 423, shifted: true }] };
  assert.deepEqual(placeTranslation(withLine, { position: 'above', boxHeight: 30, previous: null }), { offset: 51, shift: 0 });
});

// A 500px tall player whose control bar, progress bar included, takes the bottom 62px while it shows (measured on a
// watch page). YouTube's captions sit 10px above the bottom (2%, the floor), and 80px while the bar shows (70px more)
const small = { playerTop: 0, playerBottom: 500 };
const controls = { top: 438, bottom: 500 };

test('placeTranslation: with CC off, goes where YouTube raises its captions while the control bar shows, and back to the floor when it hides', () => {
  const off = { enabled: false, ...small, captions: [] };
  for (const position of ['below', 'above'] as const) {
    assert.deepEqual(placeTranslation({ ...off, controls }, { position, boxHeight: 30, previous: null }), { offset: 80, shift: 0 });
    assert.deepEqual(placeTranslation({ ...off, controls: null }, { position, boxHeight: 30, previous: { offset: 80, shift: 0 } }), {
      offset: 10,
      shift: 0,
    });
  }
});

test('placeTranslation: with CC off, sits as high as next to the native captions with CC on while the control bar is hidden', () => {
  const options = { position: 'below', boxHeight: 30, previous: null } as const;
  const atRest = { top: 452, bottom: 490, shifted: true };
  const on = placeTranslation({ enabled: true, ...small, captions: [atRest] }, options);
  assert.equal(placeTranslation({ enabled: false, ...small, captions: [] }, options).offset, on.offset);
});

test('placeTranslation: while the control bar shows, sits as high with CC off as next to the raised captions with CC on', () => {
  const raisedLine = { top: 382, bottom: 420, shifted: true };
  const options = { position: 'below', boxHeight: 30, previous: null } as const;
  const on = placeTranslation({ enabled: true, ...small, captions: [raisedLine], controls }, options);
  const off = placeTranslation({ enabled: false, ...small, captions: [], controls }, options);
  assert.equal(off.offset, on.offset);
});

test('placeTranslation: between caption lines, the kept placement still clears the control bar', () => {
  const native = { enabled: true, ...small, captions: [], controls };
  assert.deepEqual(placeTranslation(native, { position: 'below', boxHeight: 30, previous: { offset: 40, shift: 60 } }), {
    offset: 80,
    shift: 60,
  });
});

test('placeTranslation: next to the native captions, follows them over the control bar instead of jumping ahead', () => {
  // The control bar has just shown, and YouTube has yet to move its caption line (10px above the bottom) over it
  const native = { enabled: true, ...small, captions: [{ top: 452, bottom: 490, shifted: true }] };
  for (const position of ['below', 'above'] as const) {
    const options = { position, boxHeight: 30, previous: null };
    assert.deepEqual(placeTranslation({ ...native, controls }, options), placeTranslation(native, options), position);
  }
});

// Shorts, with the player made 0-1000 (measured: 944px tall, the caption window 88px below its top and 40px tall),
// so the floor of 10% is 100px below the top
const shorts = { enabled: true, playerTop: 0, playerBottom: 1000 };
const topLine = { top: 88, bottom: 128, shifted: true };
const atTop = { edge: 'top', floor: 0.1 } as const;

test('placeTranslation at the top: with CC off, sits at the floor under the top edge', () => {
  assert.deepEqual(placeTranslation({ ...shorts, enabled: false, captions: [] }, { ...atTop, position: 'below', boxHeight: 30, previous: null }), {
    offset: 100,
    shift: 0,
  });
});

test('placeTranslation at the top, below: goes under the native captions, which stay where they are', () => {
  assert.deepEqual(placeTranslation({ ...shorts, captions: [topLine] }, { ...atTop, position: 'below', boxHeight: 30, previous: null }), {
    offset: 136,
    shift: 0,
  });
});

test('placeTranslation at the top, above: takes the floor and lowers the captions under it by its height plus the gap', () => {
  // The translation spans 100-130; the captions are lowered by 100 + 30 + 8 - 88 = 50 to 138-178
  const first = placeTranslation({ ...shorts, captions: [topLine] }, { ...atTop, position: 'above', boxHeight: 30, previous: null });
  assert.deepEqual(first, { offset: 100, shift: 50 });
  // Measuring the lowered captions next frame gives the same placement
  const lowered = { top: topLine.top + 50, bottom: topLine.bottom + 50, shifted: true };
  assert.deepEqual(placeTranslation({ ...shorts, captions: [lowered] }, { ...atTop, position: 'above', boxHeight: 30, previous: first }), first);
});

test('placeTranslation at the top: stays under controls at the top edge while they show', () => {
  // 2% of 1000, the bar's 120px and 8px
  const native = { ...shorts, enabled: false, captions: [], controls: { top: 0, bottom: 120 } };
  assert.deepEqual(placeTranslation(native, { ...atTop, position: 'below', boxHeight: 30, previous: null }), { offset: 148, shift: 0 });
});

test('placeTranslation at the top: ignores windows in the lower half', () => {
  const low = { top: 800, bottom: 840, shifted: false };
  assert.deepEqual(placeTranslation({ ...shorts, captions: [low] }, { ...atTop, position: 'below', boxHeight: 30, previous: null }), {
    offset: 100,
    shift: 0,
  });
});

test('positionOf: only offered positions, otherwise below', () => {
  assert.equal(positionOf('above'), 'above');
  assert.equal(positionOf('below'), 'below');
  assert.equal(positionOf(undefined), DEFAULT_POSITION);
  assert.equal(positionOf('left'), 'below');
});
