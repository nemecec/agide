import { heatTooltip, type HeatLevel } from '../../../core/usage/heat';

/** A small bar of one to three segments with a text tooltip; never colour alone (0027 section 9). */
export function HeatMarker({ level, costUsdPerMinute, share, windowMinutes, testId }: { level: HeatLevel; costUsdPerMinute?: number | undefined; share: number; windowMinutes: number; testId?: string }) {
  if (level === 0) return null;
  const text = heatTooltip(costUsdPerMinute, share, windowMinutes);
  return (
    <span className="heat-marker" data-level={level} data-testid={testId ?? 'heat-marker'} title={text} role="img" aria-label={`heat ${level} of 3: ${text}`}>
      {'▮'.repeat(level)}
    </span>
  );
}
