import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEW_POLICY } from '../policy/schema';
import { RUNGS, type ReviewReport, type Rung } from '../schemas';
import { TIERS, type Tier } from '../../swarm/definition';
import { reviewerTier } from '../rungs';
import { isRaise, reportOutcome, reviewerReasons, rungAfterReport } from './effects';
import { resolveReviewerModel } from './launch';

const report = (patch: Partial<ReviewReport> = {}): ReviewReport => ({
  id: 'rep_1',
  runId: 'run_1',
  changesetId: 'cs_0123456789abcdef',
  verdict: 'accept',
  escalateTo: null,
  claimCheck: 'confirmed',
  summary: 'fine',
  findings: [],
  droppedFindings: 0,
  receivedAt: '2026-11-21T10:00:00.000Z',
  ...patch,
});

const finding = (severity: ReviewReport['findings'][number]['severity'], idx = 0): ReviewReport['findings'][number] => ({ idx, fileIdx: 0, side: 'new', line: 1, hunkHash: 'a'.repeat(64), onChangedLine: true, severity, title: 't', body: '' });

describe('reviewer report effects', () => {
  it('adds no reason for an accept without a finding at major or above', () => {
    expect(reviewerReasons(report({ findings: [finding('minor'), finding('nit', 1)] })), 'minor and nit findings add nothing').toEqual([]);
  });

  it('adds one reason per row of the effects table', () => {
    const ids = (r: ReviewReport) => reviewerReasons(r).map((reason) => reason.id);
    expect(ids(report({ verdict: 'revise' })), 'revise').toEqual(['reviewer.revise']);
    expect(ids(report({ findings: [finding('major')] })), 'a major finding').toEqual(['reviewer.findings']);
    expect(ids(report({ findings: [finding('blocker')] })), 'a blocker finding').toEqual(['reviewer.findings']);
    expect(ids(report({ verdict: 'escalate', escalateTo: 'D' })), 'escalate').toEqual(['reviewer.escalated']);
    expect(ids(report({ claimCheck: 'contradicted' })), 'a contradicted claim').toEqual(['reviewer.claim_contradicted']);
  });

  it('gives an escalation the rung it asked for, whatever the policy says about the id', () => {
    const [reason] = reviewerReasons(report({ verdict: 'escalate', escalateTo: 'E' }), { 'reviewer.escalated': 'B' });
    expect(reason?.minRung, 'the requested rung stands').toBe('E');
  });

  it('applies the policy rung to the other reviewer reasons', () => {
    const [reason] = reviewerReasons(report({ verdict: 'revise' }), { 'reviewer.revise': 'C' });
    expect(reason?.minRung, 'the policy raises the rung of a revise').toBe('C');
  });

  it('never lowers the rung: every current rung stays at or above itself after any reason', () => {
    for (const current of RUNGS) {
      for (const added of [[], ...RUNGS.map((rung) => [{ minRung: rung }])]) {
        const after = rungAfterReport(current, added);
        expect(isRaise(current, after), `from ${current} with ${JSON.stringify(added)} the rung ${after} is not lower`).toBe(true);
      }
    }
  });

  it('raises the rung to the highest reason and keeps a higher current rung', () => {
    expect(rungAfterReport('B', [{ minRung: 'D' }, { minRung: 'C' }]), 'the highest added reason wins').toBe('D');
    expect(rungAfterReport('E', [{ minRung: 'C' }]), 'a lower reason does not lower E').toBe('E');
    expect(rungAfterReport('C', [{ minRung: 'B' }]), 'a reviewer accept-like reason at B does not lower C').toBe('C');
  });

  const context = { checkBlocks: false, attemptsLeft: true };

  it('accepts only at rung B for an accept with no blocking finding, no contradicted claim and no blocking check', () => {
    expect(reportOutcome(report(), 'B', context).kind, 'a clean accept at B').toBe('accept');
    for (const rung of ['C', 'D', 'E'] as Rung[]) expect(reportOutcome(report(), rung, context).kind, `an accept at ${rung} goes to a person`).toBe('human');
    expect(reportOutcome(report({ findings: [finding('major')] }), 'B', context).kind, 'a major finding blocks the accept').toBe('human');
    expect(reportOutcome(report({ claimCheck: 'contradicted' }), 'B', context).kind, 'a contradicted claim blocks the accept').toBe('human');
    expect(reportOutcome(report(), 'B', { ...context, checkBlocks: true }).kind, 'a failed check blocks the accept').toBe('human');
  });

  it('sends a revise back at B while attempts are left and to a person at the limit or above B', () => {
    expect(reportOutcome(report({ verdict: 'revise' }), 'B', context).kind, 'revise at B with attempts left').toBe('send_back');
    expect(reportOutcome(report({ verdict: 'revise' }), 'B', { ...context, attemptsLeft: false }).kind, 'revise at the retry limit').toBe('human');
    expect(reportOutcome(report({ verdict: 'revise' }), 'C', context).kind, 'revise at C').toBe('human');
    expect(reportOutcome(report({ verdict: 'escalate', escalateTo: 'C' }), 'C', context).kind, 'escalate').toBe('human');
  });
});

describe('reviewer tier rule', () => {
  it('is never below the working agent tier, for every policy tier and worker tier', () => {
    const order = [...TIERS].reverse();
    for (const policyTier of ['strong', 'mid'] as const) {
      for (const worker of TIERS) {
        const model = resolveReviewerModel({ ...DEFAULT_REVIEW_POLICY.reviewer, tier: policyTier }, worker, 'B');
        expect(order.indexOf(model.tier), `policy ${policyTier} with worker ${worker} gives ${model.tier}`).toBeGreaterThanOrEqual(order.indexOf(worker as Tier));
        expect(model.tier, 'the same as the tier helper').toBe(reviewerTier(policyTier, worker));
      }
    }
  });

  it('uses effortB at rung B and effortHuman from C on', () => {
    const reviewer = { ...DEFAULT_REVIEW_POLICY.reviewer, effortB: 'medium' as const, effortHuman: 'xhigh' as const };
    expect(resolveReviewerModel(reviewer, 'mid', 'B').effort, 'rung B').toBe('medium');
    for (const rung of ['C', 'D', 'E'] as Rung[]) expect(resolveReviewerModel(reviewer, 'mid', rung).effort, `rung ${rung}`).toBe('xhigh');
  });

  it('does not let a mid policy tier lower a strong worker', () => {
    expect(resolveReviewerModel({ ...DEFAULT_REVIEW_POLICY.reviewer, tier: 'mid' }, 'strong', 'B').tier, 'a strong worker gets a strong reviewer').toBe('strong');
  });
});
