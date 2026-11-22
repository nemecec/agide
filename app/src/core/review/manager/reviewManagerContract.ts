import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import { captureFixture, policySnapshot, type CaptureFixture } from '../fakes/fixtures';
import { catalogueReason, type FakeCheckExecutor, type FakeMerger, type FakeReviewBudget, type FakeRiskRules, type FakeSendBackChannel, type InMemorySwarmFacts } from '../fakes/fakes';
import { reviewPolicySchema } from '../policy/schema';
import { REPORT_REVIEW_TOOL } from '../reviewer/InMemoryReviewerRuntime';
import type { ChangesetRecord, ChangesetState, PolicySnapshot } from '../schemas';
import type { ChangesetDetail, ReviewCaller, ReviewManager, ReviewRunRequest } from '../types';

/**
 * What the suite gets per test. Captures go in through `submit`; the check, the rules, the budget, the send-back
 * channel and the merger are fakes the test steers; reviewers run on the in-memory agent runtime with the step
 * script set by `setReviewer`, and their `report_review` steps reach `reportReview` as the reviewer session.
 */
export interface ReviewManagerHarness {
  readonly manager: ReviewManager;
  readonly facts: InMemorySwarmFacts;
  readonly checks: FakeCheckExecutor;
  readonly rules: FakeRiskRules;
  readonly budget: FakeReviewBudget;
  readonly sendBack: FakeSendBackChannel;
  readonly merger: FakeMerger;
  readonly agents: InMemoryAgentRuntime;
  setReviewer(script: (request: ReviewRunRequest) => string): void;
  putPolicy(snapshot: PolicySnapshot): void;
  close(): Promise<void>;
}

export const UI: ReviewCaller = { kind: 'ui' };
export const WORKER: ReviewCaller = { kind: 'session', sessionId: 'session-worker', folderId: 'folder-swarm' };
const STARTER: ReviewCaller = { kind: 'session', sessionId: 'session-starter', folderId: 'folder-user' };

export const WITH_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }), 'check');
export const NO_CHECK = policySnapshot();
/** No send-back on its own, and a contradicted claim and a timed-out check at rung B, so only the accept rule holds them back. */
export const STRICT = policySnapshot(
  reviewPolicySchema.parse({ version: 1, retryLimit: 0, check: { command: ['pnpm', 'test'] }, rungs: { 'reviewer.claim_contradicted': 'B', 'check.timed_out': 'B' } }),
  'strict',
);

/** A `report_review` step for the in-memory reviewer. */
export function reportStep(changesetId: string, patch: Record<string, unknown> = {}): string {
  const input = { changesetId, verdict: 'accept', claimCheck: 'confirmed', summary: 'Looks right.', findings: [], ...patch };
  return `/tool ${REPORT_REVIEW_TOOL} ${JSON.stringify(input)}\n/cost 0.05\n/text reported`;
}

/** Behaviour every `ReviewManager` shows (0040 sections 9 to 16). */
export function describeReviewManagerContract(name: string, setup: () => Promise<ReviewManagerHarness>, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (ReviewManager contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    let h: ReviewManagerHarness;
    beforeEach(async () => {
      h = await setup();
      h.putPolicy(WITH_CHECK);
      h.putPolicy(NO_CHECK);
      h.putPolicy(STRICT);
      h.facts.addFolder('folder-user');
      h.facts.addFolder('folder-swarm', 'folder-user');
      h.facts.addSwarm('sw1', { folderId: 'folder-swarm', callerSessionId: 'session-starter', defaultTarget: 'main' });
      h.facts.addAgent('sw1', { name: 'worker', sessionId: 'session-worker' });
      h.facts.addAgent('sw1', { name: 'helper', sessionId: 'session-helper' });
      h.setReviewer(() => '/text I looked and said nothing');
    });
    afterEach(async () => {
      await h.manager.shutdown();
      await h.close();
    });

    const capture = (seed: string, patch: Partial<CaptureFixture> = {}) => captureFixture({ seed, policyHash: WITH_CHECK.hash, ...patch });
    const detail = (changesetId: string): ChangesetDetail => h.manager.get({ changesetId, hunks: true }, UI);
    const until = async (changesetId: string, check: (changeset: ChangesetRecord) => boolean, what: string): Promise<ChangesetRecord> => {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const found = detail(changesetId);
        if (check(found.changeset)) return found.changeset;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; ${found.changeset.state} at ${found.changeset.rung}; decisions ${found.decisions.map((decision) => decision.action).join(', ')}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const reach = (changesetId: string, state: ChangesetState) => until(changesetId, (changeset) => changeset.state === state, state);
    const accepting = (request: ReviewRunRequest) => reportStep(request.changesetId);

    it('accepts a rung A changeset whose check passed, without a reviewer', async () => {
      const submitted = await h.manager.submit(capture('a'));
      const accepted = await reach(submitted.id, 'accepted');
      expect(accepted.rung, 'rung').toBe('A');
      expect(detail(submitted.id).decisions.map((decision) => [decision.actor, decision.action]), 'decisions').toEqual([
        ['app', 'start_check'],
        ['app', 'assess'],
        ['app', 'auto_accept'],
      ]);
      expect(h.agents.launches.length, 'no reviewer started').toBe(0);
      expect(h.checks.requests[0]?.policy.check?.command, 'the check command comes from the stored swarm policy').toEqual(['pnpm', 'test']);
    });

    it('sends nothing back on its own once the retry limit is reached', async () => {
      const failing = capture('limit', { policyHash: STRICT.hash });
      h.checks.set(failing.id, 'failed');
      await h.manager.submit(failing);
      await reach(failing.id, 'awaiting_human');
      expect(h.sendBack.sent, 'no automatic send-back at retryLimit 0').toEqual([]);
    });

    it('never lets the reviewer accept at B over a contradicted claim or a check that did not pass', async () => {
      h.rules.set('worker', [catalogueReason('size.medium')]);
      h.setReviewer((request) => reportStep(request.changesetId, { claimCheck: 'contradicted' }));
      const contradicted = capture('contradicted', { policyHash: STRICT.hash });
      await h.manager.submit(contradicted);
      const held = await reach(contradicted.id, 'awaiting_human');
      expect(held.rung, 'the policy keeps reviewer.claim_contradicted at B').toBe('B');

      h.setReviewer(accepting);
      const timedOut = capture('timed-out', { agent: 'helper', sessionId: 'session-helper', policyHash: STRICT.hash });
      h.checks.set(timedOut.id, 'timed_out');
      await h.manager.submit(timedOut);
      const waiting = await reach(timedOut.id, 'awaiting_human');
      expect(waiting.rung, 'the policy keeps check.timed_out at B').toBe('B');
    });

    it('sends a failed check back while attempts remain, and reviews a failure the base shares', async () => {
      const failing = capture('fail');
      h.checks.set(failing.id, 'failed');
      await h.manager.submit(failing);
      await reach(failing.id, 'sent_back');
      expect(h.sendBack.sent.map((sent) => sent.agent), 'the message went to the agent').toEqual(['worker']);
      expect(h.sendBack.sent[0]?.message, 'app text that names the check').toContain('The project check failed');
      const shared = capture('shared', { agent: 'helper', sessionId: 'session-helper' });
      h.checks.set(shared.id, 'failed', 'failed');
      h.setReviewer(accepting);
      await h.manager.submit(shared);
      const done = await reach(shared.id, 'accepted');
      expect(done.rung, 'check.failed_on_base keeps rung B').toBe('B');
      expect(detail(shared.id).decisions.at(-1)?.actor, 'the reviewer accepted').toBe('reviewer');
    });

    it('lets the reviewer accept at rung B only, and waits for the user when a finding is major', async () => {
      h.setReviewer(accepting);
      const plain = capture('b', { policyHash: NO_CHECK.hash });
      await h.manager.submit(plain);
      expect((await reach(plain.id, 'accepted')).rung, 'accepted at B').toBe('B');

      h.setReviewer((request) => reportStep(request.changesetId, { findings: [{ path: 'src/a.ts', line: 2, severity: 'major', title: 'wrong sign' }] }));
      const major = capture('major', { agent: 'helper', sessionId: 'session-helper', policyHash: NO_CHECK.hash });
      await h.manager.submit(major);
      const waiting = await reach(major.id, 'awaiting_human');
      expect(waiting.rung, 'reviewer.findings raises to C').toBe('C');
      expect(detail(major.id).report?.findings[0], 'the finding is anchored on the added line').toMatchObject({ fileIdx: 0, line: 2, onChangedLine: true });
    });

    it('sends work back on a revise report and counts the attempt on the next capture', async () => {
      h.setReviewer((request) => reportStep(request.changesetId, { verdict: 'revise' }));
      const first = capture('rev1', { policyHash: NO_CHECK.hash });
      await h.manager.submit(first);
      await reach(first.id, 'sent_back');
      expect(h.sendBack.sent.length, 'one send-back delivered').toBe(1);
      const second = await h.manager.submit(capture('rev2', { policyHash: NO_CHECK.hash }));
      expect([second.seq, second.attempt, second.supersedes], 'seq, attempt and the superseded id').toEqual([2, 1, first.id]);
      expect(detail(first.id).changeset.state, 'the first changeset is superseded').toBe('superseded');
    });

    it('retries a reviewer that does not report once, then waits for the user with reviewer.no_report', async () => {
      const silent = capture('silent', { policyHash: NO_CHECK.hash });
      await h.manager.submit(silent);
      await reach(silent.id, 'awaiting_human');
      const found = detail(silent.id);
      expect(found.runs.map((run) => [run.attempt, run.state, run.failure]), 'two failed runs').toEqual([
        [1, 'failed', 'no-report'],
        [2, 'failed', 'no-report'],
      ]);
      expect(found.reasons.map((reason) => reason.id), 'reason').toContain('reviewer.no_report');
      expect(found.changeset.rung, 'rung C').toBe('C');
    });

    it('queues a unit for budget, never accepts it on its own, and lets the user accept it', async () => {
      h.budget.setPot(0);
      h.setReviewer(accepting);
      const queued = capture('budget', { policyHash: NO_CHECK.hash });
      await h.manager.submit(queued);
      const waiting = await reach(queued.id, 'queued_for_budget');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(detail(queued.id).changeset.state, 'still queued').toBe('queued_for_budget');
      await expect(h.manager.accept({ changesetId: queued.id, expectedHash: waiting.contentHash, expectedRung: waiting.rung, withoutReviewer: false }, UI), 'without the tick').rejects.toMatchObject({
        code: 'refused',
      });
      const accepted = await h.manager.accept({ changesetId: queued.id, expectedHash: waiting.contentHash, expectedRung: waiting.rung, withoutReviewer: true }, UI);
      expect(accepted.state, 'the user accepted').toBe('accepted');
    });

    it('takes report_review only from the running reviewer of the changeset, once', async () => {
      let request: ReviewRunRequest | undefined;
      h.setReviewer((given) => {
        request = given;
        return '/sleep 2000';
      });
      const unit = capture('scope', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      await reach(unit.id, 'in_review');
      await until(unit.id, () => request !== undefined, 'reviewer started');
      expect([request!.files.length, request!.hunks.length, request!.claim?.source, request!.reasons.map((reason) => reason.id)], 'the prompt data of the run').toEqual([1, 1, 'result', ['check.none']]);
      const report = { changesetId: unit.id, verdict: 'accept' as const, claimCheck: 'confirmed' as const, summary: 'ok', findings: [] };
      await expect(h.manager.reportReview(report, WORKER), 'the working agent').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.reportReview(report, UI), 'the user').rejects.toMatchObject({ code: 'out_of_scope' });
      const reviewer: ReviewCaller = { kind: 'reviewer', sessionId: request!.sessionId };
      await expect(h.manager.reportReview({ ...report, changesetId: 'cs_0000000000000000' }, reviewer), 'another changeset').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.reportReview(report, reviewer), 'the reviewer').resolves.toEqual({ stored: true, findings: 0 });
      await expect(h.manager.reportReview(report, reviewer), 'a second report').rejects.toMatchObject({ code: 'refused' });
    });

    it('refuses a report from a reviewer run that already ended', async () => {
      const sessions: string[] = [];
      h.setReviewer((given) => {
        sessions.push(given.sessionId);
        return sessions.length === 1 ? '/text no report' : '/sleep 2000';
      });
      const unit = capture('ended-run', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      await until(unit.id, () => sessions.length === 2, 'the second run started');
      const report = { changesetId: unit.id, verdict: 'accept' as const, claimCheck: 'confirmed' as const, summary: 'ok', findings: [] };
      await expect(h.manager.reportReview(report, { kind: 'reviewer', sessionId: sessions[0]! }), 'the ended first run').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.reportReview(report, { kind: 'reviewer', sessionId: sessions[1]! }), 'the running second run').resolves.toEqual({ stored: true, findings: 0 });
    });

    it('takes the latest report_outcome of a worktree agent as the claim of its next capture only', async () => {
      h.facts.addAgent('sw1', { name: 'reader', sessionId: 'session-reader', workspace: 'readonly' });
      const outcome = { summary: 'did it', confidence: 'low' as const, testsRun: ['pnpm test'], unverified: [] };
      expect(() => h.manager.reportOutcome(outcome, { kind: 'session', sessionId: 'session-reader', folderId: 'folder-swarm' }), 'a readonly agent').toThrow(
        expect.objectContaining({ code: 'out_of_scope' }),
      );
      expect(h.manager.reportOutcome(outcome, WORKER), 'recorded').toMatchObject({ recorded: true });
      const first = await h.manager.submit(capture('claimed', { policyHash: NO_CHECK.hash }));
      expect(first.claim, 'the claim is the report').toMatchObject({ source: 'report_outcome', summary: 'did it', confidence: 'low' });
      const second = await h.manager.submit(capture('claimed-again', { policyHash: NO_CHECK.hash }));
      expect(second.claim?.source, 'the next capture without a report keeps the result text').toBe('result');
    });

    it('binds the summary seen mark to the rung and the reasons', async () => {
      const unit = capture('summary', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      await reach(unit.id, 'awaiting_human');
      h.manager.seen({ changesetId: unit.id, level: 'summary', how: 'marked' }, UI);
      expect(detail(unit.id).seen.summary, 'seen after the mark').toBe(true);
      await h.manager.escalate({ changesetId: unit.id, toRung: 'D', reason: 'look closer' }, UI);
      expect(detail(unit.id).seen.summary, 'unseen once the rung and reasons changed').toBe(false);
    });

    it('keeps only draft comments on diff lines and sends them once with the send-back', async () => {
      const unit = capture('comments', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      expect(() => h.manager.comment({ changesetId: unit.id, file: 0, side: 'new', line: 40, body: 'here?' }, UI), 'a line outside the diff').toThrow(expect.objectContaining({ code: 'invalid_input' }));
      const draft = h.manager.comment({ changesetId: unit.id, file: 0, side: 'new', line: 2, body: 'why this value?' }, UI);
      if (!('id' in draft)) throw new Error('expected a comment');
      await h.manager.sendBack({ changesetId: unit.id, expectedHash: waiting.contentHash, message: 'please look' }, UI);
      expect(h.sendBack.sent.at(-1)?.message, 'the comment is in the message').toContain('why this value?');
      expect(detail(unit.id).comments.map((comment) => [comment.state, comment.sentIn !== null]), 'the draft is sent with its decision').toEqual([['sent', true]]);
      expect(() => h.manager.comment({ commentId: draft.id, delete: true }, UI), 'a sent comment stays').toThrow(expect.objectContaining({ code: 'refused' }));
    });

    it('asks for corrected anchors and keeps the anchored findings after the third try', async () => {
      let request: ReviewRunRequest | undefined;
      h.setReviewer((given) => {
        request = given;
        return '/sleep 2000';
      });
      const unit = capture('anchors', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      await until(unit.id, () => request !== undefined, 'reviewer started');
      const reviewer: ReviewCaller = { kind: 'reviewer', sessionId: request!.sessionId };
      const findings = [
        { path: 'src/a.ts', line: 2, side: 'new' as const, severity: 'minor' as const, title: 'fine', body: '' },
        { path: 'src/a.ts', line: 99, side: 'new' as const, severity: 'minor' as const, title: 'nowhere', body: '' },
      ];
      const report = { changesetId: unit.id, verdict: 'accept' as const, claimCheck: 'confirmed' as const, summary: 'ok', findings };
      await expect(h.manager.reportReview(report, reviewer), 'first try').rejects.toMatchObject({ code: 'invalid_input' });
      await expect(h.manager.reportReview(report, reviewer), 'second try').rejects.toMatchObject({ code: 'invalid_input' });
      await expect(h.manager.reportReview(report, reviewer), 'third try stores').resolves.toEqual({ stored: true, findings: 1 });
      expect(detail(unit.id).report?.droppedFindings, 'dropped findings').toBe(1);
    });

    it('refuses an accept on a stale hash or rung, and at D until the flagged hunks are seen', async () => {
      h.rules.set('worker', [catalogueReason('path.sensitive', { subject: 'src/a.ts' })]);
      h.setReviewer(accepting);
      const unit = capture('d', { policyHash: NO_CHECK.hash, files: [{ path: 'src/a.ts', hunks: [' a\n-b\n+c'] }, { path: 'src/b.ts', hunks: ['+d'] }] });
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      expect(waiting.rung, 'path.sensitive is D').toBe('D');
      const accept = (expectedHash: string, expectedRung: 'C' | 'D') => h.manager.accept({ changesetId: unit.id, expectedHash, expectedRung, withoutReviewer: false }, UI);
      await expect(accept(waiting.contentHash, 'D'), 'the flagged hunk is unseen').rejects.toMatchObject({ code: 'refused' });
      h.manager.seen({ changesetId: unit.id, level: 'hunk', file: 0, hunk: 0, how: 'marked' }, UI);
      await expect(accept('0'.repeat(64), 'D'), 'a stale hash').rejects.toMatchObject({ code: 'refused' });
      await expect(accept(waiting.contentHash, 'C'), 'a stale rung').rejects.toMatchObject({ code: 'refused' });
      expect((await accept(waiting.contentHash, 'D')).state, 'accepted once the flagged hunk is seen').toBe('accepted');
    });

    it('demotes below a floor only with a reason and the second call with its token', async () => {
      h.rules.set('worker', [catalogueReason('config.git', { subject: '.gitattributes' })]);
      const unit = capture('floor', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      expect([waiting.rung, waiting.floor], 'hard E').toEqual(['E', 'E']);
      const first = await h.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours' }, UI);
      expect(first.committed, 'the first call only asks').toBe(false);
      expect(detail(unit.id).changeset.rung, 'nothing changed yet').toBe('E');
      if (first.committed) return;
      await expect(h.manager.demote({ changesetId: unit.id, toRung: 'B', reason: 'the attributes file is ours', confirmToken: first.confirmToken }, UI), 'a token for another rung').rejects.toMatchObject({
        code: 'refused',
      });
      const again = await h.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours' }, UI);
      if (again.committed) throw new Error('expected a token');
      const done = await h.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours', confirmToken: again.confirmToken }, UI);
      expect(done.committed && [done.changeset.rung, done.changeset.floor], 'rung and floor lowered').toEqual(['C', 'C']);
    });

    it('keeps the decisions of the user away from agents and lets the agent only raise its own rung', async () => {
      const unit = capture('agent', { policyHash: NO_CHECK.hash });
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      await expect(h.manager.accept({ changesetId: unit.id, expectedHash: waiting.contentHash, expectedRung: waiting.rung, withoutReviewer: true }, WORKER), 'accept').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.reject({ changesetId: unit.id, expectedHash: waiting.contentHash, reason: 'no' }, WORKER), 'reject').rejects.toMatchObject({ code: 'out_of_scope' });
      expect(() => h.manager.seen({ changesetId: unit.id, level: 'summary', how: 'marked' }, WORKER), 'seen').toThrow();
      const helper: ReviewCaller = { kind: 'session', sessionId: 'session-helper', folderId: 'folder-swarm' };
      await expect(h.manager.requestEscalation({ changesetId: unit.id, toRung: 'E', reason: 'please' }, helper), 'another agent').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.requestEscalation({ changesetId: unit.id, toRung: 'B', reason: 'lower' }, WORKER), 'not a raise').rejects.toMatchObject({ code: 'refused' });
      expect((await h.manager.requestEscalation({ changesetId: unit.id, toRung: 'D', reason: 'touches auth' }, WORKER)).rung, 'raised by the agent').toBe('D');
      expect((await h.manager.requestEscalation({ changesetId: unit.id, toRung: 'E', reason: 'and more' }, STARTER)).rung, 'raised by the swarm caller').toBe('E');
    });

    it('reopens an accepted changeset that is escalated', async () => {
      const unit = capture('reopen');
      await h.manager.submit(unit);
      await reach(unit.id, 'accepted');
      const raised = await h.manager.escalate({ changesetId: unit.id, toRung: 'C', reason: 'look again' }, UI);
      expect([raised.state, raised.rung], 'reopened at C').toEqual(['awaiting_human', 'C']);
    });

    it('keeps seen marks of unchanged hunks in a superseding changeset and drops those of changed hunks', async () => {
      const files = (second: string) => [{ path: 'src/a.ts', hunks: [' a\n-b\n+c', ` x\n-y\n+${second}`] }];
      const first = capture('seen1', { policyHash: NO_CHECK.hash, files: files('z') });
      await h.manager.submit(first);
      await reach(first.id, 'awaiting_human');
      h.manager.seen({ changesetId: first.id, level: 'hunk', file: 0, hunk: 0, how: 'dwell' }, UI);
      h.manager.seen({ changesetId: first.id, level: 'hunk', file: 0, hunk: 1, how: 'dwell' }, UI);
      const second = await h.manager.submit(capture('seen2', { policyHash: NO_CHECK.hash, files: files('changed') }));
      const seen = detail(second.id).seen;
      expect(seen.files[0], 'one hunk still seen, the changed one not').toEqual({ idx: 0, seen: false, unseenHunks: 1 });
    });

    it('shows a working agent its own changesets only and a session the swarms in its folder', async () => {
      await h.manager.submit(capture('mine', { policyHash: NO_CHECK.hash }));
      await h.manager.submit(capture('theirs', { agent: 'helper', sessionId: 'session-helper', policyHash: NO_CHECK.hash }));
      expect(h.manager.list({ limit: 50 }, WORKER).map((summary) => summary.agent), 'the agent sees its own').toEqual(['worker']);
      expect(h.manager.list({ limit: 50 }, STARTER).length, 'the swarm caller sees both').toBe(2);
      const outside: ReviewCaller = { kind: 'session', sessionId: 'session-other', folderId: 'folder-other' };
      h.facts.addFolder('folder-other');
      expect(h.manager.list({ limit: 50 }, outside), 'a session elsewhere sees none').toEqual([]);
    });

    it('closes the merge gate until every worktree agent ended accepted, then merges and keeps the merged changeset', async () => {
      h.facts.setState('sw1', 'helper', 'running');
      const unit = capture('merge');
      await h.manager.submit(unit);
      await reach(unit.id, 'accepted');
      const closed = h.manager.mergeGate('sw1');
      expect(closed.open, 'a running agent closes the gate').toBe(false);
      await expect(h.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI), 'merge refused').rejects.toMatchObject({ code: 'refused' });
      h.facts.setState('sw1', 'helper', 'done');
      expect(h.manager.mergeGate('sw1').open, 'open once the helper ended without changes').toBe(true);
      await expect(h.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, WORKER), 'a swarm agent never merges').rejects.toMatchObject({ code: 'out_of_scope' });
      await expect(h.manager.merge({ swarmId: 'sw1', target: 'agide/sw1/worker', exclude: [], dryRun: false }, UI), 'an agent branch as target').rejects.toMatchObject({ code: 'refused' });
      const dry = await h.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: true }, UI);
      expect([dry.merged.length, detail(unit.id).changeset.mergedCommit], 'a dry run reports and merges nothing').toEqual([1, null]);
      const result = await h.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, STARTER);
      expect(result.merged.map((entry) => entry.agent), 'the worker merged').toEqual(['worker']);
      expect(detail(unit.id).changeset.mergedCommit, 'merged commit set').toBe(result.merged[0]?.commit);
      const later = await h.manager.submit(capture('after-merge'));
      expect([later.supersedes, detail(unit.id).changeset.state], 'a merged changeset is not superseded').toEqual([null, 'accepted']);
    });

    it('keeps the gate closed while repo.armed is open on a changeset not accepted by the user at E', async () => {
      const unit = capture('armed', { reasons: [catalogueReason('repo.armed', { evidence: { what: 'hooks' } })] });
      h.setReviewer(accepting);
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      expect(waiting.rung, 'repo.armed is E').toBe('E');
      expect(h.manager.mergeGate('sw1').agents.find((entry) => entry.agent === 'worker')?.ok, 'blocked').toBe(false);
      await expect(h.manager.accept({ changesetId: unit.id, expectedHash: waiting.contentHash, expectedRung: 'E', withoutReviewer: false }, UI), 'an unseen hunk at E').rejects.toMatchObject({
        code: 'refused',
      });
      h.manager.seen({ changesetId: unit.id, level: 'hunk', file: 0, hunk: 0, how: 'marked' }, UI);
      await h.manager.accept({ changesetId: unit.id, expectedHash: waiting.contentHash, expectedRung: 'E', withoutReviewer: false }, UI);
      expect(h.manager.mergeGate('sw1').open, 'open after the user accepted at E').toBe(true);
    });

    it('keeps the gate closed for repo.armed accepted after a demotion below E', async () => {
      const unit = capture('armed-low', { reasons: [catalogueReason('repo.armed', { evidence: { what: 'hooks' } })] });
      h.setReviewer(accepting);
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      const reason = 'the hook change is mine';
      const asked = await h.manager.demote({ changesetId: unit.id, toRung: 'C', reason }, UI);
      if (asked.committed) throw new Error('expected a token');
      await h.manager.demote({ changesetId: unit.id, toRung: 'C', reason, confirmToken: asked.confirmToken }, UI);
      await h.manager.accept({ changesetId: unit.id, expectedHash: waiting.contentHash, expectedRung: 'C', withoutReviewer: false }, UI);
      expect(h.manager.mergeGate('sw1').agents.find((entry) => entry.agent === 'worker')?.ok, 'repo.armed needs the accept at E').toBe(false);
    });

    it('waits for the user when a send-back cannot reach the agent', async () => {
      h.sendBack.unreachable.set('worker', 'the swarm is stopped');
      const failing = capture('unreachable');
      h.checks.set(failing.id, 'failed');
      await h.manager.submit(failing);
      const waiting = await reach(failing.id, 'awaiting_human');
      expect(detail(failing.id).decisions.at(-1)?.action, 'undeliverable').toBe('undeliverable');
      expect(waiting.state, 'state').toBe('awaiting_human');
    });
  });
}
