import { meterModel, type MeterModel } from './swarmModel';
import './swarm.css';

const WIDTH = 100;
const HEIGHT = 6;

export interface BudgetMeterProps {
  readonly budget: { readonly usdTotal: number; readonly reportedUsd: number; readonly estimatedUsd: number; readonly reservedUsd: number };
  /** Draws the bar alone, for a tree row; the words are then the accessible name and the tooltip. */
  readonly compact?: boolean;
  readonly 'data-testid'?: string;
}

/**
 * The budget bar of 0037 section 10: the reported part solid, the estimated part light with an outline, the
 * reserved part as an outline only. The fill changes from 80 percent and at the cap, and the words that follow
 * the bar (or the label of a compact bar) say the same, so the state does not depend on colour.
 */
export function BudgetMeter({ budget, compact = false, 'data-testid': testId = 'budget-meter' }: BudgetMeterProps) {
  const model: MeterModel = meterModel(budget);
  const bar = (
    <svg className="budget-bar" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={model.label} data-level={model.level} data-testid={`${testId}-bar`}>
      <rect className="budget-track" x="0" y="0" width={WIDTH} height={HEIGHT} rx="2" />
      <rect className="budget-reported" x="0" y="0" width={model.reported * WIDTH} height={HEIGHT} rx="2" />
      <rect className="budget-estimated" x={model.reported * WIDTH} y="0.5" width={model.estimated * WIDTH} height={HEIGHT - 1} />
      <rect className="budget-reserved" x={(model.reported + model.estimated) * WIDTH} y="0.5" width={model.reserved * WIDTH} height={HEIGHT - 1} />
    </svg>
  );
  if (compact) {
    return (
      <span className="budget-meter" data-compact="" data-level={model.level} title={model.label} data-testid={testId}>
        {bar}
      </span>
    );
  }
  return (
    <span className="budget-meter" data-level={model.level} data-testid={testId}>
      {bar}
      <span className="budget-label" data-testid={`${testId}-label`}>
        {model.label}
      </span>
    </span>
  );
}
