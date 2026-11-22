import { rungAbove, maxRung } from '../rungs';
import type { Reason } from '../schemas';
import type { AssessInput, RiskRules } from '../types';
import { buildContext } from './context';
import { fileReasons } from './fileRules';
import { pathReasons } from './pathRules';
import { checkReasons, claimReasons, retryReasons, telemetryReasons } from './runRules';
import { secretReasons } from './secretRules';
import { sizeReasons } from './sizeRules';
import { testReasons } from './testRules';

/**
 * The rule, check, telemetry and claim reasons of a changeset (0040 section 7), pure over the stored records. The
 * project policy's `rungs` apply to every id and never lower a hard reason; accumulation is added last.
 */
export class DefaultRiskRules implements RiskRules {
  assess(input: AssessInput): Reason[] {
    const ctx = buildContext(input);
    const checks = checkReasons(ctx);
    const reasons = [
      ...checks,
      ...retryReasons(
        ctx,
        checks.some((reason) => reason.id === 'check.failed'),
      ),
      ...sizeReasons(ctx),
      ...fileReasons(ctx),
      ...pathReasons(ctx),
      ...testReasons(ctx),
      ...secretReasons(ctx),
      ...telemetryReasons(ctx),
      ...claimReasons(ctx),
      ...(input.policy.source === 'invalid' ? [ctx.make('policy.invalid', { evidence: { issues: (input.policy.errors ?? []).slice(0, 20) } })] : []),
    ];
    return withAccumulation(ctx, reasons);
  }
}

/** One rung up when `thresholds.accumulate` reasons sit at the highest rung; once per assessment, at most E. */
function withAccumulation(ctx: ReturnType<typeof buildContext>, reasons: Reason[]): Reason[] {
  if (reasons.length === 0) return reasons;
  const top = maxRung(...reasons.map((reason) => reason.minRung));
  const counted = reasons.filter((reason) => reason.minRung === top);
  if (top === 'E' || counted.length < ctx.policy.thresholds.accumulate) return reasons;
  const accumulate = ctx.make('accumulate', { base: rungAbove(top), evidence: { atRung: top, count: counted.length, reasonIds: [...new Set(counted.map((reason) => reason.id))].sort() } });
  return [...reasons, accumulate];
}
