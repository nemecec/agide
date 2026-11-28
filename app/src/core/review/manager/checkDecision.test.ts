import { describe, expect, it } from 'vitest';
import { sha1Of, sha256Of } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import type { ChangesetRecord, CheckRecord } from '../schemas';
import { DEFAULT_CHECK_DECISION, decideAfterCheck } from './checkDecision';
import { checkFailedText } from './sendBackText';

const changeset = (patch: Partial<ChangesetRecord> = {}): ChangesetRecord =>
  ({ id: 'cs_0123456789abcdef', swarmId: 'sw1', agent: 'worker', attempt: 0, rung: 'A', floor: 'A', state: 'assessed', ...patch }) as ChangesetRecord;
const run = (outcome: CheckRecord['outcome']): { checkpoint: CheckRecord } => ({
  checkpoint: {
    id: 'chk_1',
    changesetId: 'cs_0123456789abcdef',
    target: 'checkpoint',
    commitId: sha1Of('c'),
    policyHash: sha256Of('p'),
    command: ['pnpm', 'test'],
    outcome,
    notRunReason: null,
    exitCode: outcome === 'passed' ? 0 : 1,
    signal: null,
    durationMs: 1,
    outputPath: null,
    outputTail: 'output',
    truncated: false,
    startedAt: '2026-11-28T10:00:00.000Z',
    endedAt: '2026-11-28T10:00:01.000Z',
  },
});
const POLICY = reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } });
const ids = (...values: string[]): ReadonlySet<string> => new Set(values);
const nonceless = (text: string): string => text.replaceAll(/[0-9a-f]{12}/g, 'NONCE');

describe('the default decision after a check', () => {
  it('accepts a changeset at rung A whose check passed, and only then', () => {
    expect(decideAfterCheck({ changeset: changeset(), policy: POLICY, reasonIds: ids(), outcome: run('passed'), retryLimit: 2 }), 'rung A and a passed check').toEqual({ kind: 'accept' });
    expect(decideAfterCheck({ changeset: changeset({ rung: 'B' }), policy: POLICY, reasonIds: ids(), outcome: run('passed'), retryLimit: 2 }).kind, 'rung B is reviewed').toBe('review');
    expect(decideAfterCheck({ changeset: changeset(), policy: POLICY, reasonIds: ids(), outcome: undefined, retryLimit: 2 }).kind, 'no check, no accept').toBe('review');
    expect(decideAfterCheck({ changeset: changeset(), policy: POLICY, reasonIds: ids(), outcome: run('timed_out'), retryLimit: 2 }).kind, 'a timed out check is not a pass').toBe('review');
  });

  it('sends a failed check back with the text of before while attempts remain', () => {
    const outcome = run('failed');
    const decision = decideAfterCheck({ changeset: changeset({ rung: 'C', attempt: 1 }), policy: POLICY, reasonIds: ids('check.failed'), outcome, retryLimit: 2 });
    expect(decision.kind, 'attempts remain').toBe('send_back');
    expect(nonceless(decision.kind === 'send_back' ? decision.message : ''), 'the text of the failed check').toBe(nonceless(checkFailedText(outcome)));
  });

  it('goes to review when the attempts are used up, when the check failed on the base too, and without a failed check', () => {
    const outcome = run('failed');
    expect(decideAfterCheck({ changeset: changeset({ rung: 'C', attempt: 2 }), policy: POLICY, reasonIds: ids('check.failed'), outcome, retryLimit: 2 }).kind, 'attempts used up').toBe('review');
    expect(decideAfterCheck({ changeset: changeset({ rung: 'C' }), policy: POLICY, reasonIds: ids('check.base_red'), outcome, retryLimit: 2 }).kind, 'a red base is not sent back').toBe('review');
    expect(decideAfterCheck({ changeset: changeset({ rung: 'C' }), policy: POLICY, reasonIds: ids('size.large'), outcome: run('passed'), retryLimit: 2 }).kind, 'no failed check').toBe('review');
  });

  it('never repeats a check by default', () => {
    expect(DEFAULT_CHECK_DECISION.rerun({ changeset: changeset(), outcome: run('failed'), policy: POLICY }), 'no rerun').toBe(false);
    expect(DEFAULT_CHECK_DECISION.decide, 'the default decision is the one above').toBe(decideAfterCheck);
  });
});
