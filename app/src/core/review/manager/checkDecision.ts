import type { ReviewPolicy } from '../policy/schema';
import type { ChangesetRecord } from '../schemas';
import type { CheckOutcomeSet } from '../types';
import { checkFailedText } from './sendBackText';

/**
 * What the manager does after the rules ran on a changeset whose check ran (0045 section 3.3). `review` is the
 * hold: the changeset is not sent back and goes on to the reviewer and the person, as a changeset with a red base does.
 */
export type CheckDecision = { readonly kind: 'accept' } | { readonly kind: 'send_back'; readonly message: string } | { readonly kind: 'review' };

export interface CheckDecisionInput {
  readonly changeset: ChangesetRecord;
  /** The ids of every reason stored for the changeset. */
  readonly reasonIds: ReadonlySet<string>;
  readonly outcome: CheckOutcomeSet | undefined;
  /** The effective policy of the changeset: the retry limit, and the report globs that the send-back of `check.report_missing` names. */
  readonly policy: ReviewPolicy;
  readonly retryLimit: number;
}

export interface CheckRerunInput {
  readonly changeset: ChangesetRecord;
  readonly outcome: CheckOutcomeSet;
  readonly policy: ReviewPolicy;
}

/**
 * The decisions of the check that w-rules fills in: `rerun` is asked once after the checkpoint run and before
 * the rules, and answers true when the checkpoint run should repeat (only when every failure is flaky on the base,
 * section 3.3); `decide` is asked after the rules. The manager never repeats a check twice for one changeset.
 */
export interface CheckDecisionSeam {
  rerun(input: CheckRerunInput): boolean;
  decide(input: CheckDecisionInput): CheckDecision;
}

/** Accepts at rung A after a passed check, sends a failed check back while attempts remain, else goes to review. */
export function decideAfterCheck(input: CheckDecisionInput): CheckDecision {
  if (input.changeset.rung === 'A' && input.outcome?.checkpoint.outcome === 'passed') return { kind: 'accept' };
  if (input.reasonIds.has('check.failed') && input.changeset.attempt < input.retryLimit) return { kind: 'send_back', message: checkFailedText(input.outcome) };
  return { kind: 'review' };
}

export const DEFAULT_CHECK_DECISION: CheckDecisionSeam = { rerun: () => false, decide: decideAfterCheck };
