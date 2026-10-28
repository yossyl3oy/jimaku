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

// Player 0-600, so the floor is 48px; one caption line 540-578, where YouTube puts it (22px above the bottom)
const player = { playerTop: 0, playerBottom: 600 };
const line = { top: 540, bottom: 578, shifted: true };
const cc = (captions: { top: number; bottom: number; shifted: boolean }[]) => ({ enabled: true, ...player, captions });

test('placeTranslation: with CC off, sits at the floor and raises nothing', () => {
  const off = { enabled: false, ...player, captions: [] };
  for (const position of ['below', 'above'] as const) {
    assert.deepEqual(placeTranslation(off, { position, boxHeight: 40, previous: { bottom: 100, shift: 50 } }), {
      bottom: 48,
      shift: 0,
    });
  }
});

test('placeTranslation above: stacks over the native captions', () => {
  assert.deepEqual(placeTranslation(cc([line]), { position: 'above', boxHeight: 40, previous: null }), {
    bottom: 68,
    shift: 0,
  });
});

test('placeTranslation below: takes the floor and raises the captions over it by its height plus the gap', () => {
  // The translation spans 512-552; the captions are raised by 48 + 40 + 8 - 22 = 74 to 466-504
  assert.deepEqual(placeTranslation(cc([line]), { position: 'below', boxHeight: 40, previous: null }), {
    bottom: 48,
    shift: 74,
  });
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
    bottom: 77,
    shift: 38,
  });
});

test('placeTranslation below: while the translation is hidden, the captions stay raised', () => {
  const previous = { bottom: 48, shift: 74 };
  const raised = { top: line.top - 74, bottom: line.bottom - 74, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised]), { position: 'below', boxHeight: 0, previous }), previous);
});

test('placeTranslation: keeps the last placement when the native captions vanish between lines', () => {
  const previous = { bottom: 48, shift: 74 };
  assert.deepEqual(placeTranslation(cc([]), { position: 'below', boxHeight: 40, previous }), previous);
  assert.deepEqual(placeTranslation(cc([]), { position: 'above', boxHeight: 40, previous: null }), { bottom: 48, shift: 0 });
});

test('placeTranslation: switching to above lowers the captions back and stacks over where YouTube put them', () => {
  const raised = { top: line.top - 74, bottom: line.bottom - 74, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised]), { position: 'above', boxHeight: 40, previous: { bottom: 48, shift: 74 } }), {
    bottom: 68,
    shift: 0,
  });
});

test('placeTranslation: a kept placement stays at or above the floor after the player grows', () => {
  // Fullscreen between two caption lines: 600px tall → 1080px tall, so the floor goes from 48 to 86.4
  const tall = { enabled: true, playerTop: 0, playerBottom: 1080, captions: [] };
  assert.deepEqual(placeTranslation(tall, { position: 'below', boxHeight: 40, previous: { bottom: 48, shift: 74 } }), {
    bottom: 86.4,
    shift: 74,
  });
});

test('placeTranslation below: goes over the captions when one of them cannot be raised', () => {
  // A window YouTube placed itself (not bottom-anchored) at 480-518 stays put, so stacking under it would overlap
  const placed = { top: 480, bottom: 518, shifted: false };
  assert.deepEqual(placeTranslation(cc([placed]), { position: 'below', boxHeight: 40, previous: null }), {
    bottom: 128,
    shift: 0,
  });
  const raised = { top: line.top - 74, bottom: line.bottom - 74, shifted: true };
  assert.deepEqual(placeTranslation(cc([raised, placed]), { position: 'below', boxHeight: 40, previous: { bottom: 48, shift: 74 } }), {
    bottom: 128,
    shift: 0,
  });
});

// Measured on a watch page: player 68-428, the hint 92-130 (not raised by the shift), the first caption line 385-423
test('placeTranslation: ignores windows in the upper half, like the "Click ⚙ for settings" hint after CC is turned on', () => {
  const measured = { enabled: true, playerTop: 68, playerBottom: 428 };
  const hint = { top: 92, bottom: 130, shifted: false };
  assert.deepEqual(placeTranslation({ ...measured, captions: [hint] }, { position: 'above', boxHeight: 30, previous: null }), {
    bottom: 360 * 0.08,
    shift: 0,
  });
  const withLine = { ...measured, captions: [hint, { top: 385, bottom: 423, shifted: true }] };
  assert.deepEqual(placeTranslation(withLine, { position: 'above', boxHeight: 30, previous: null }), { bottom: 51, shift: 0 });
});

test('positionOf: only offered positions, otherwise below', () => {
  assert.equal(positionOf('above'), 'above');
  assert.equal(positionOf('below'), 'below');
  assert.equal(positionOf(undefined), DEFAULT_POSITION);
  assert.equal(positionOf('left'), 'below');
});
