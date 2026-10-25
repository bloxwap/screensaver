import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHART_ANIM_MS, EMIT_MS, WINDOW_MS } from '../bloxwap/chart-math';
import { advanceChartPresentation, createChartPresentation } from './chart-presentation';

test('rapid quotes retarget the shared tween without postponing its completion', () => {
  const state = createChartPresentation();
  const step = (price: number, time: number) => advanceChartPresentation(state, price, time, time, true, false);
  step(100, 0);
  step(100, 1_000);
  step(110, 1_001);
  step(120, 1_101);
  assert.equal(state.start, 1_001);
  assert.ok(state.value > 100 && state.value < 120);
  step(130, 1_201);
  assert.equal(state.start, 1_001);
  assert.ok(state.value > 100 && state.value < 130);
  step(130, 1_001 + CHART_ANIM_MS);
  assert.equal(state.value, 130);
});

test('the pill reads eased trail samples instead of jumping ahead to raw quotes', () => {
  const state = createChartPresentation();
  const step = (price: number, time: number) => advanceChartPresentation(state, price, time, time, true, false);
  assert.equal(step(100, 0), 100);
  step(100, 1_000);
  assert.equal(step(200, 1_001), 100);
  assert.equal(step(200, 1_100), 100);
  const readout = step(200, 1_000 + EMIT_MS);
  assert.ok(readout > 100 && readout < 200);
  assert.equal(readout, state.value);
  assert.equal(readout, state.ticks.at(-1)!.p);
  assert.ok(state.ticks.every((tick) => tick.p <= state.value));
  step(200, 1_301);
  assert.equal(step(200, 1_400), 200);
});

test('quiet markets sample regularly with bounded, strictly ordered display history', () => {
  const state = createChartPresentation();
  for (let time = 0; time <= WINDOW_MS * 3; time += EMIT_MS) {
    advanceChartPresentation(state, 100, time, time, true, false);
  }
  assert.ok(state.ticks.length <= WINDOW_MS / EMIT_MS + 2);
  assert.equal(state.ticks.at(-1)!.t, WINDOW_MS * 3);
  assert.ok(state.ticks.every((tick, i) => tick.p === 100 && (!i || tick.t > state.ticks[i - 1].t)));
});

test('disconnect freezes scrolling; resume snaps to the current mark', () => {
  const state = createChartPresentation();
  advanceChartPresentation(state, 100, 0, 5_000, true, false);
  advanceChartPresentation(state, 110, 1_000, 6_000, true, false);
  advanceChartPresentation(state, 110, 2_000, 4_900, false, false);
  assert.equal(state.time, 6_000);
  assert.equal(state.value, 110);
  state.value = NaN; // The visibility handler resets the tween.
  assert.equal(advanceChartPresentation(state, 120, 3_000, 8_000, true, false), 120);
  assert.equal(state.value, 120);
  assert.equal(state.time, 8_000);
});

test('reduced motion snaps without duplicate timestamps or a lingering animation', () => {
  const state = createChartPresentation();
  advanceChartPresentation(state, 100, 0, 1_000, true, true);
  assert.equal(advanceChartPresentation(state, 200, 10, 1_000, true, true), 200);
  assert.equal(state.value, 200);
  assert.deepEqual(state.ticks, [{ t: 1_000, p: 200 }]);
});
