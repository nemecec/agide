import { REASON_CATALOGUE, type ReasonDefinition } from '../reasonCatalogue';
import { maxRung, rungIndex } from '../rungs';
import { BLOCKING_SEVERITIES, type Reason, type ReviewReport, type Rung } from '../schemas';

/** Reasons a reviewer report adds (0040 section 10.6), with the project's `rungs` applied and hard floors kept. */
export function reviewerReasons(report: ReviewReport, policyRungs: Readonly<Record<string, Rung>> = {}): Reason[] {
  const make = (id: keyof typeof REASON_CATALOGUE, subject: string, evidence: Record<string, unknown>, fixedRung?: Rung): Reason => {
    const definition: ReasonDefinition = REASON_CATALOGUE[id];
    const configured = fixedRung ?? policyRungs[id] ?? definition.rung;
    // A policy raises or keeps the default of a hard reason; only the reason's own rung (an escalation) is not the policy's to change.
    const minRung = definition.hard ? maxRung(configured, definition.rung) : configured;
    return { id, subject, source: definition.source, evidence, minRung, hard: definition.hard };
  };
  const blocking = report.findings.filter((finding) => BLOCKING_SEVERITIES.includes(finding.severity));
  const reasons: Reason[] = [];
  if (report.verdict === 'revise') reasons.push(make('reviewer.revise', '', { reportId: report.id }));
  if (blocking.length > 0) reasons.push(make('reviewer.findings', '', { reportId: report.id, findings: blocking.map((finding) => `${report.id}:${finding.idx}`) }));
  if (report.escalateTo !== null) reasons.push(make('reviewer.escalated', report.escalateTo, { reportId: report.id, escalateTo: report.escalateTo }, report.escalateTo));
  if (report.claimCheck === 'contradicted') reasons.push(make('reviewer.claim_contradicted', '', { reportId: report.id }));
  return reasons;
}

/** The rung after a reviewer result: the result can only raise it, never lower it (0010 section 3, 0040 section 9.3). */
export function rungAfterReport(current: Rung, added: readonly Pick<Reason, 'minRung'>[]): Rung {
  return maxRung(current, ...added.map((reason) => reason.minRung));
}

export type ReportOutcome =
  /** The reviewer's accept stands: rung B, no blocking finding, no contradicted claim, a check that did not fail. */
  | { readonly kind: 'accept' }
  /** Back to the working agent with the findings. */
  | { readonly kind: 'send_back' }
  /** A person decides. */
  | { readonly kind: 'human' };

export interface ReportContext {
  readonly rung: Rung;
  readonly checkBlocks: boolean;
  /** Send-backs used so far against the policy's retry limit. */
  readonly attemptsLeft: boolean;
}

/**
 * What a stored report does to the changeset, over the rung that includes its reasons (0040 sections 9.2 and
 * 10.6). A reviewer accept holds at rung B only; above it the reviewer's work informs a person.
 */
export function reportOutcome(report: ReviewReport, finalRung: Rung, context: Pick<ReportContext, 'checkBlocks' | 'attemptsLeft'>): ReportOutcome {
  const blocking = report.findings.some((finding) => BLOCKING_SEVERITIES.includes(finding.severity));
  if (finalRung === 'B' && report.verdict === 'accept' && !blocking && report.claimCheck !== 'contradicted' && !context.checkBlocks) return { kind: 'accept' };
  if (finalRung === 'B' && report.verdict === 'revise' && context.attemptsLeft) return { kind: 'send_back' };
  return { kind: 'human' };
}

/** True when `to` is not below `from`. */
export const isRaise = (from: Rung, to: Rung): boolean => rungIndex(to) >= rungIndex(from);
