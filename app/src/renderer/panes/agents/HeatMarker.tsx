import { heatTooltip, type HeatLevel } from '../../../core/usage/heat';

const LEVEL_WORD = ['', 'low', 'medium', 'high'] as const;
const BARS = [0, 1, 2] as const;
const BAR_WIDTH = 3;
const BAR_GAP = 1;

/** Three bars; the number of filled bars carries the level, so the colour only adds to it (0027 section 9). */
export function HeatMarker({ level, costUsdPerMinute, share, windowMinutes, testId }: { level: HeatLevel; costUsdPerMinute?: number | undefined; share: number; windowMinutes: number; testId?: string }) {
  if (level === 0) return null;
  const text = heatTooltip(costUsdPerMinute, share, windowMinutes);
  return (
    <span className="heat-marker" data-level={level} data-testid={testId ?? 'heat-marker'} title={text} role="img" aria-label={`Usage: ${LEVEL_WORD[level]}. ${text}`}>
      <svg width={BARS.length * BAR_WIDTH + (BARS.length - 1) * BAR_GAP} height="10" aria-hidden="true" focusable="false">
        {BARS.map((bar) => (
          <rect key={bar} x={bar * (BAR_WIDTH + BAR_GAP)} width={BAR_WIDTH} height="10" rx="1" data-filled={bar < level} />
        ))}
      </svg>
    </span>
  );
}
