// Shared chart geometry and easing math for web and mobile.

export type Tick = { t: number; p: number };

export const WINDOW_MS = 60_000;
export const SEED_MS = 15 * 60_000;
export const TICK_PX = 44; // vertical pixels between price ticks
export const EMIT_MS = 200; // Sample cadence in milliseconds.
export const SHELF_HALF = 60; // ticks above/below the shelf anchor
// Horizontal flow speed; matches the background grid (50px per 1s).
export const FLOW_PX_PER_SEC = 50;

export function tickSpacingFor(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  // Start from one basis point of price per vertical tick.
  const raw = price / 10_000;
  // Round spacing up to whole cents at prices of $100 or more.
  if (raw >= 0.01) return Math.ceil(raw * 100) / 100;
  // Sub-cent: the nearest 1/2/5 × 10^n multiple >= raw so labels read evenly.
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Compute precision numerically to handle exponential notation. Keep at least four decimals
 * below $1; absorb log10 noise and cap at 20.
 */
export function labelDecimalsFor(spacing: number, price: number): number {
  const subDollarFloor = price > 0 && price < 1 ? 4 : 0;
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return Math.max(2, subDollarFloor);
  }
  const fromSpacing = Math.min(
    20,
    Math.max(0, Math.ceil(-Math.log10(spacing) - 1e-9)),
  );
  return Math.max(2, fromSpacing, subDollarFloor);
}

// Fritsch-Carlson monotone cubic smoothing, emitted as Bézier segments.
export type SmoothPathSink = {
  moveTo: (x: number, y: number) => unknown;
  lineTo: (x: number, y: number) => unknown;
  cubicTo: (
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ) => unknown;
};

export type SmoothPathPoints = readonly (readonly [number, number])[];

function smoothDeltaAt(points: SmoothPathPoints, index: number): number {
  "worklet";
  const left = points[index]!;
  const right = points[index + 1]!;
  const dx = right[0] - left[0];
  return dx === 0 ? 0 : (right[1] - left[1]) / dx;
}

function initialSmoothTangentAt(
  points: SmoothPathPoints,
  index: number,
): number {
  "worklet";
  if (index === 0) return smoothDeltaAt(points, 0);
  if (index === points.length - 1) {
    return smoothDeltaAt(points, points.length - 2);
  }
  const before = smoothDeltaAt(points, index - 1);
  const after = smoothDeltaAt(points, index);
  return before * after <= 0 ? 0 : (before + after) / 2;
}

function writeSmoothSegment(
  points: SmoothPathPoints,
  index: number,
  leftTangent: number,
  rightTangent: number,
  sink: SmoothPathSink,
): void {
  "worklet";
  const left = points[index]!;
  const right = points[index + 1]!;
  const dx = right[0] - left[0];
  sink.cubicTo(
    left[0] + dx / 3,
    left[1] + (leftTangent * dx) / 3,
    right[0] - dx / 3,
    right[1] - (rightTangent * dx) / 3,
    right[0],
    right[1],
  );
}

/**
 * Write the monotone spline into a path-like sink. Native mutates one
 * persistent SkPath; `smoothPath` uses the same writer for the web SVG string.
 */
export function writeSmoothPath(
  points: SmoothPathPoints,
  sink: SmoothPathSink,
): void {
  "worklet";
  const n = points.length;
  if (n === 0) return;
  sink.moveTo(points[0]![0], points[0]![1]);
  if (n === 1) return;
  if (n === 2) {
    sink.lineTo(points[1]![0], points[1]![1]);
    return;
  }

  // Emit one interval late so the sequential tangent correction survives
  // without two temporary arrays per write.
  let previousSegmentLeftTangent = 0;
  let carriedTangent = initialSmoothTangentAt(points, 0);
  for (let i = 0; i < n - 1; i++) {
    const delta = smoothDeltaAt(points, i);
    let leftTangent = carriedTangent;
    let rightTangent = initialSmoothTangentAt(points, i + 1);
    if (delta === 0) {
      leftTangent = 0;
      rightTangent = 0;
    } else {
      const alpha = leftTangent / delta;
      const beta = rightTangent / delta;
      const mag = alpha * alpha + beta * beta;
      if (mag > 9) {
        const tau = 3 / Math.sqrt(mag);
        leftTangent = tau * alpha * delta;
        rightTangent = tau * beta * delta;
      }
    }
    if (i > 0) {
      writeSmoothSegment(
        points,
        i - 1,
        previousSegmentLeftTangent,
        leftTangent,
        sink,
      );
    }
    previousSegmentLeftTangent = leftTangent;
    carriedTangent = rightTangent;
  }
  writeSmoothSegment(
    points,
    n - 2,
    previousSegmentLeftTangent,
    carriedTangent,
    sink,
  );
}

export function smoothPath(points: [number, number][]): string {
  const segments: string[] = [];
  writeSmoothPath(points, {
    moveTo: (x, y) => segments.push(`M ${x},${y}`),
    lineTo: (x, y) => segments.push(` L ${x},${y}`),
    cubicTo: (cp1x, cp1y, cp2x, cp2y, x, y) =>
      segments.push(` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${x},${y}`),
  });
  return segments.join("");
}

// Shared 300ms ease-in-out price tween.
export const CHART_ANIM_MS = 300;
export const CHART_BEZIER_P1X = 0.42;
export const CHART_BEZIER_P1Y = 0;
export const CHART_BEZIER_P2X = 0.58;
export const CHART_BEZIER_P2Y = 1;

/**
 * Evaluate the configured cubic Bézier at time fraction t, solving x(u) with up to six Newton
 * iterations.
 */
export function evalBezier(t: number): number {
  "worklet";
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const p1x = CHART_BEZIER_P1X;
  const p1y = CHART_BEZIER_P1Y;
  const p2x = CHART_BEZIER_P2X;
  const p2y = CHART_BEZIER_P2Y;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const oneMinusU = 1 - u;
    const xu =
      3 * oneMinusU * oneMinusU * u * p1x +
      3 * oneMinusU * u * u * p2x +
      u * u * u;
    const dx =
      3 * oneMinusU * oneMinusU * p1x +
      6 * oneMinusU * u * (p2x - p1x) +
      3 * u * u * (1 - p2x);
    if (Math.abs(dx) < 1e-6) break;
    const next = u - (xu - t) / dx;
    u = next < 0 ? 0 : next > 1 ? 1 : next;
  }
  const oneMinusU = 1 - u;
  return (
    3 * oneMinusU * oneMinusU * u * p1y +
    3 * oneMinusU * u * u * p2y +
    u * u * u
  );
}
