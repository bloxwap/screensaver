import { CHART_ANIM_MS, EMIT_MS, WINDOW_MS, evalBezier, type Tick } from '../bloxwap/chart-math';

/** Display-only samples; market quotes and stored history retain their observed prices. */
export function createChartPresentation() {
  return { from: NaN, to: NaN, start: 0, value: NaN, time: NaN, sampledAt: -Infinity, ticks: [] as Tick[] };
}

/** Matches apps/app/src/components/trading/live-chart.tsx in the monorepo. */
export function advanceChartPresentation(
  state: ReturnType<typeof createChartPresentation>,
  price: number,
  frameTime: number,
  time: number,
  live: boolean,
  reducedMotion: boolean,
): number {
  const snap = reducedMotion || !Number.isFinite(state.value);
  if (snap) {
    state.from = state.to = state.value = price;
    state.start = frameTime;
  } else if (frameTime - state.start >= CHART_ANIM_MS) {
    if (price !== state.to) {
      state.from = state.value;
      state.to = price;
      state.start = frameTime;
    }
  } else {
    // Retarget an active tween without restarting its clock on every book update.
    state.to = price;
  }
  state.value = state.from + (state.to - state.from) * evalBezier(Math.min(1, (frameTime - state.start) / CHART_ANIM_MS));
  // Freeze the presentation on disconnect instead of rewinding to the server timestamp.
  if (live || !Number.isFinite(state.time)) state.time = Math.max(state.time || 0, time);
  const last = state.ticks.at(-1);
  if (!last || snap || frameTime - state.sampledAt >= EMIT_MS) {
    const sample = { t: state.time, p: state.value };
    if (last?.t === sample.t) state.ticks[state.ticks.length - 1] = sample;
    else state.ticks.push(sample);
    const cutoff = state.time - WINDOW_MS;
    // Keep one preceding sample so a viewport boundary never creates a gap.
    while (state.ticks.length > 1 && state.ticks[1].t < cutoff) state.ticks.shift();
    state.sampledAt = frameTime;
  }
  return state.ticks.at(-1)!.p;
}
