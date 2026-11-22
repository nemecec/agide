import type { Reason } from '../schemas';
import type { RuleContext } from './context';
import { untrusted } from './reasons';

/** Reasons from the check, the run telemetry, the claim and the retry count (0040 section 7.2). */

/** The card text of `check.base_red`: the rung is the one of `check.failed`; only the automatic send-back is left out. */
const BASE_RED = 'the check fails on the base commit as well, so it cannot tell good changes from bad; the code is not sent back for it, and the user decides';

export function checkReasons(ctx: RuleContext): Reason[] {
  const { policy, input, make } = ctx;
  if (policy.check === undefined) return [make('check.none', { evidence: { policyHash: input.policy.hash } })];
  const check = input.check;
  if (check === undefined) return [];
  const { checkpoint, base } = check;
  // A red base never lowers a rung: it only keeps the code from being sent back for a failure that it did not cause. A checkpoint that passes on a red base needs no reason, and the card says that the change made the base green.
  const baseRed = (): Reason[] => [make('check.base_red', { subject: BASE_RED, evidence: { checkpointCheck: checkpoint.id, ...(base === undefined ? {} : { baseCheck: base.id }) } })];
  switch (checkpoint.outcome) {
    case 'failed':
      if (base?.outcome === 'failed') return baseRed();
      return [make('check.failed', { evidence: { checkId: checkpoint.id, exitCode: checkpoint.exitCode, command: checkpoint.command, outputTail: untrusted(checkpoint.outputTail ?? '', 2_000) } })];
    case 'timed_out':
      return [make('check.timed_out', { evidence: { checkId: checkpoint.id, limitSeconds: policy.check.timeoutSeconds } })];
    case 'not_run':
      return base?.outcome === 'failed' ? baseRed() : [make('check.not_run', { evidence: { checkId: checkpoint.id, why: checkpoint.notRunReason } })];
    default:
      return [];
  }
}

export function telemetryReasons(ctx: RuleContext): Reason[] {
  const { make, policy } = ctx;
  const telemetry = ctx.input.changeset.telemetry;
  const reasons: Reason[] = [];
  if (telemetry.endState === 'failed' || telemetry.endState === 'stopped' || telemetry.endState === 'interrupted') {
    reasons.push(make('run.incomplete', { evidence: { endState: telemetry.endState, ...(telemetry.endReason === undefined ? {} : { reason: telemetry.endReason }) } }));
  }
  if (telemetry.backgroundStopped > 0) reasons.push(make('run.background_stopped', { evidence: { tasks: telemetry.backgroundStopped } }));
  if (telemetry.retries > 0) reasons.push(make('run.retries', { evidence: { retries: telemetry.retries } }));
  if (telemetry.denials > 0) {
    const atThreshold = telemetry.denials >= policy.thresholds.denials;
    reasons.push(make('run.denials', { base: atThreshold ? 'C' : 'B', evidence: { denials: telemetry.denials, tools: telemetry.deniedTools.slice(0, 20), threshold: policy.thresholds.denials } }));
  }
  if (telemetry.toolErrors >= policy.thresholds.toolErrors) reasons.push(make('run.tool_errors', { evidence: { toolErrors: telemetry.toolErrors, threshold: policy.thresholds.toolErrors } }));
  return reasons;
}

export function claimReasons(ctx: RuleContext): Reason[] {
  const { make } = ctx;
  const claim = ctx.input.changeset.claim;
  if (claim === null || (claim.source === 'result' && claim.text.trim() === '')) return [make('claim.missing')];
  if (claim.source === 'result') return [];
  const reasons: Reason[] = [];
  if (claim.unverified.length > 0) reasons.push(make('claim.unverified', { evidence: { items: claim.unverified.slice(0, 20).map((item) => untrusted(item, 300)) } }));
  if (claim.confidence === 'low') reasons.push(make('claim.low_confidence', { evidence: { confidence: claim.confidence } }));
  return reasons;
}

/** The send-backs are used up and the check still fails: the rest is for a person. */
export function retryReasons(ctx: RuleContext, failedCheck: boolean): Reason[] {
  const { attempt } = ctx.input.changeset;
  const limit = ctx.policy.retryLimit;
  return failedCheck && attempt >= limit ? [ctx.make('retry.limit', { evidence: { attempts: attempt, limit } })] : [];
}
