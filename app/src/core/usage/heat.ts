export type HeatLevel = 0 | 1 | 2 | 3;

export interface HeatThresholds {
  readonly heatFloorUsdPerMinute: number;
  readonly alertUsdPerMinute: number;
}

/**
 * The heat marker of a node (0027 section 9): none below the floor or below a tenth of the profile's rate, then
 * levels from 10, 30 and 60 percent of the profile's rate; at or above the alert threshold it is the top level.
 * Without a price the cost rate is unknown and the share alone decides.
 */
export function heatLevel(share: number, costUsdPerMinute: number | undefined, thresholds: HeatThresholds): HeatLevel {
  if (costUsdPerMinute !== undefined && costUsdPerMinute >= thresholds.alertUsdPerMinute) return 3;
  if (costUsdPerMinute !== undefined && costUsdPerMinute < thresholds.heatFloorUsdPerMinute) return 0;
  if (share >= 0.6) return 3;
  if (share >= 0.3) return 2;
  if (share >= 0.1) return 1;
  return 0;
}

export function heatTooltip(costUsdPerMinute: number | undefined, share: number, windowMinutes: number): string {
  const percent = Math.round(share * 100);
  const cost = costUsdPerMinute === undefined ? 'no price for this model' : `about ${costUsdPerMinute.toFixed(2)} USD per minute`;
  return `${cost}, ${percent} percent of the profile, estimated over the last ${windowMinutes} minutes`;
}
