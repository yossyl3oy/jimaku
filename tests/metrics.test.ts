import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWaitMeter } from '../src/core/metrics.ts';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

test('createWaitMeter: returns the wait when a waiting line gets its translation', () => {
  const c = clock();
  const meter = createWaitMeter(c.now);
  assert.equal(meter.observe(3, false), null);
  c.advance(250);
  assert.equal(meter.observe(3, false), null);
  c.advance(150);
  assert.equal(meter.observe(3, true), 400);
  // Not measured after it's shown
  assert.equal(meter.observe(3, true), null);
});

test('createWaitMeter: does not measure a line translated from the start', () => {
  const meter = createWaitMeter(clock().now);
  assert.equal(meter.observe(0, true), null);
});

test('createWaitMeter: restarts the measurement when moving to the next line while still waiting', () => {
  const c = clock();
  const meter = createWaitMeter(c.now);
  meter.observe(3, false);
  c.advance(500);
  meter.observe(4, false);
  c.advance(100);
  assert.equal(meter.observe(4, true), 100);
});

test('createWaitMeter: restarts the measurement after a gap with no caption', () => {
  const c = clock();
  const meter = createWaitMeter(c.now);
  meter.observe(3, false);
  c.advance(500);
  meter.observe(null, false);
  assert.equal(meter.observe(3, true), null);
});
