export interface PlanSample {
  readonly at: number;
  readonly percent: number;
}

export const FORECAST_SPAN_MS = 30 * 60_000;
const MIN_SAMPLES = 3;
const MIN_SPREAD_MS = 5 * 60_000;

/** Least-squares slope in percent per minute over the samples; undefined without enough samples spread over time. */
export function slopePerMinute(samples: readonly PlanSample[]): number | undefined {
  if (samples.length < MIN_SAMPLES) return undefined;
  const first = Math.min(...samples.map((s) => s.at));
  const last = Math.max(...samples.map((s) => s.at));
  if (last - first < MIN_SPREAD_MS) return undefined;
  const xs = samples.map((s) => (s.at - first) / 60_000);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = samples.reduce((a, b) => a + b.percent, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  samples.forEach((sample, index) => {
    const dx = (xs[index] ?? 0) - meanX;
    numerator += dx * (sample.percent - meanY);
    denominator += dx * dx;
  });
  return denominator === 0 ? undefined : numerator / denominator;
}

export interface Forecast {
  readonly minutesToFull: number;
  readonly beforeReset: boolean;
}

/** Time to 100 percent at the current slope, and whether that falls before the window resets. */
export function forecast(samples: readonly PlanSample[], usedPercentage: number, now: number, resetsAt: number): Forecast | undefined {
  const slope = slopePerMinute(samples);
  if (slope === undefined || slope <= 0) return undefined;
  const minutesToFull = Math.max(0, (100 - usedPercentage) / slope);
  return { minutesToFull, beforeReset: now + minutesToFull * 60_000 < resetsAt };
}
