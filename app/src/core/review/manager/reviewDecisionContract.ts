import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFixture, policySnapshot, type CaptureFixture } from '../fakes/fixtures';
import { catalogueReason } from '../fakes/fakes';
import { reviewPolicySchema } from '../policy/schema';
import { escapePath } from '../rules/classify';
import type { ChangesetRecord, ChangesetState } from '../schemas';
import type { ChangesetDetail, ReviewCaller } from '../types';
import { NO_CHECK, reportStep, UI, WORKER, type ReviewManagerHarness } from './reviewManagerContract';

/** A rung A policy without a check: nothing in it raises the rung, and nothing in it passes a check. */
const RUNG_A_WITHOUT_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1, rungs: { 'check.none': 'A' } }), 'rung-a-no-check');

const REVIEWER: ReviewCaller = { kind: 'reviewer', sessionId: 'session-reviewer' };

/** The refusals and the checks of the decisions of the review ladder that the main contract does not cover. */
export function describeReviewDecisionContract(name: string, setup: () => Promise<ReviewManagerHarness>): void {
  describe(`${name} (review decisions)`, () => {
    let h: ReviewManagerHarness;
    beforeEach(async () => {
      h = await setup();
      h.putPolicy(NO_CHECK);
      h.putPolicy(RUNG_A_WITHOUT_CHECK);
      h.facts.addFolder('folder-user');
      h.facts.addFolder('folder-swarm', 'folder-user');
      h.facts.addSwarm('sw1', { folderId: 'folder-swarm', callerSessionId: 'session-starter', defaultTarget: 'main' });
      h.facts.addAgent('sw1', { name: 'worker', sessionId: 'session-worker' });
      h.facts.addAgent('sw1', { name: 'helper', sessionId: 'session-helper' });
      h.setReviewer(() => '/text I looked and said nothing');
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await h.manager.shutdown();
      await h.close();
    });

    const capture = (seed: string, patch: Partial<CaptureFixture> = {}) => captureFixture({ seed, policyHash: NO_CHECK.hash, ...patch });
    const helperCapture = (seed: string, patch: Partial<CaptureFixture> = {}) => capture(seed, { agent: 'helper', sessionId: 'session-helper', ...patch });
    const detail = (changesetId: string): ChangesetDetail => h.manager.get({ changesetId, hunks: true }, UI);
    const reach = async (changesetId: string, state: ChangesetState): Promise<ChangesetRecord> => {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const found = detail(changesetId).changeset;
        if (found.state === state) return found;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${state}; ${found.state} at ${found.rung}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const accept = (changeset: ChangesetRecord, patch: { expectedHash?: string } = {}) =>
      h.manager.accept({ changesetId: changeset.id, expectedHash: patch.expectedHash ?? changeset.contentHash, expectedRung: changeset.rung, withoutReviewer: true }, UI);
    const hard = (path: string) => [catalogueReason('config.git', { subject: path })];

    it('commits a demotion below the floor only with the token of the same changeset that has not expired', async () => {
      h.rules.set('worker', hard('.gitattributes'));
      h.rules.set('helper', hard('.gitattributes'));
      const worker = capture('floor-worker');
      const helper = helperCapture('floor-helper');
      await h.manager.submit(worker);
      await h.manager.submit(helper);
      await reach(worker.id, 'awaiting_human');
      await reach(helper.id, 'awaiting_human');
      const reason = 'the attributes file is ours';
      const ask = async (changesetId: string): Promise<{ confirmToken: string }> => {
        const asked = await h.manager.demote({ changesetId, toRung: 'C', reason }, UI);
        if (asked.committed) throw new Error('expected a token');
        return asked;
      };
      const workerToken = await ask(worker.id);
      await expect(h.manager.demote({ changesetId: helper.id, toRung: 'C', reason, confirmToken: workerToken.confirmToken }, UI), 'the token of another changeset').rejects.toMatchObject({ code: 'refused' });
      expect(detail(helper.id).changeset.rung, 'nothing was lowered').toBe('E');

      const stale = await ask(helper.id);
      const later = Date.now() + 5 * 60_000;
      vi.spyOn(Date, 'now').mockReturnValue(later);
      await expect(h.manager.demote({ changesetId: helper.id, toRung: 'C', reason, confirmToken: stale.confirmToken }, UI), 'an expired token').rejects.toMatchObject({ code: 'refused' });
      vi.restoreAllMocks();
      expect(detail(helper.id).changeset.rung, 'still raised after the expired token').toBe('E');
    });

    it('refuses an escalation to the rung the changeset has and a demotion that does not lower it', async () => {
      const unit = capture('same-rung');
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      await expect(h.manager.escalate({ changesetId: unit.id, toRung: waiting.rung }, UI), 'an escalation to the same rung').rejects.toMatchObject({ code: 'refused' });
      expect(detail(unit.id).reasons.map((reason) => reason.id), 'the refused escalation leaves no reason').not.toContain('user.escalated');
      await expect(h.manager.demote({ changesetId: unit.id, toRung: waiting.rung, reason: 'it is fine as it is' }, UI), 'a demotion to the same rung').rejects.toMatchObject({ code: 'refused' });
      await expect(h.manager.demote({ changesetId: unit.id, toRung: 'E', reason: 'it is fine as it is' }, UI), 'a demotion upwards').rejects.toMatchObject({ code: 'refused' });
    });

    it('shows a running reviewer no changeset', async () => {
      const unit = capture('hidden');
      await h.manager.submit(unit);
      await reach(unit.id, 'awaiting_human');
      expect(h.manager.list({ limit: 50 }, REVIEWER), 'the list is empty').toEqual([]);
      expect(() => h.manager.get({ changesetId: unit.id, hunks: false }, REVIEWER), 'a changeset by id').toThrow(expect.objectContaining({ code: 'out_of_scope' }));
    });

    it('marks a file without hunks as a whole and refuses that for a file with hunks', async () => {
      const unit = capture('marks', { files: [{ path: 'src/a.ts', hunks: ['+a'] }, { path: 'assets/logo.png', hunks: [] }] });
      await h.manager.submit(unit);
      await reach(unit.id, 'awaiting_human');
      expect(() => h.manager.seen({ changesetId: unit.id, level: 'file', file: 0, how: 'marked' }, UI), 'a file with hunks').toThrow(expect.objectContaining({ code: 'invalid_input' }));
      expect(() => h.manager.seen({ changesetId: unit.id, level: 'file', file: 7, how: 'marked' }, UI), 'a file that is not there').toThrow(expect.objectContaining({ code: 'not_found' }));
      expect(() => h.manager.seen({ changesetId: unit.id, level: 'hunk', file: 0, hunk: 7, how: 'marked' }, UI), 'a hunk that is not there').toThrow(expect.objectContaining({ code: 'not_found' }));
      h.manager.seen({ changesetId: unit.id, level: 'file', file: 1, how: 'marked' }, UI);
      expect(detail(unit.id).seen.files.map((file) => file.seen), 'the file without hunks is seen, the other not').toEqual([false, true]);
    });

    it('refuses a reject on content that changed and records a reject on the content seen', async () => {
      const unit = capture('reject');
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      await expect(h.manager.reject({ changesetId: unit.id, expectedHash: '0'.repeat(64), reason: 'no' }, UI), 'a stale hash').rejects.toMatchObject({ code: 'refused' });
      expect(detail(unit.id).changeset.state, 'unchanged').toBe('awaiting_human');
      expect((await h.manager.reject({ changesetId: unit.id, expectedHash: waiting.contentHash, reason: 'no' }, UI)).state, 'rejected on the shown content').toBe('rejected');
    });

    it('holds an accept at D until the hunks of the reviewer findings are seen, flagged or not', async () => {
      h.rules.set('worker', [catalogueReason('path.sensitive', { subject: 'src/a.ts' })]);
      const finding = { path: 'src/b.ts', line: 1, side: 'new', severity: 'minor', title: 'name', body: 'rename this' };
      h.setReviewer((request) => reportStep(request.changesetId, { findings: [finding] }));
      const unit = capture('finding', { files: [{ path: 'src/a.ts', hunks: ['+a'] }, { path: 'src/b.ts', hunks: ['+b'] }] });
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      expect(waiting.rung, 'path.sensitive is D').toBe('D');
      h.manager.seen({ changesetId: unit.id, level: 'hunk', file: 0, hunk: 0, how: 'marked' }, UI);
      await expect(accept(waiting), 'the flagged hunk is seen, the one with the finding is not').rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('1 not seen') });
      h.manager.seen({ changesetId: unit.id, level: 'hunk', file: 1, hunk: 0, how: 'marked' }, UI);
      expect((await accept(waiting)).state, 'accepted once both are seen').toBe('accepted');
    });

    it('holds an accept at D on a file whose name has a control or bidirectional character, as it does for a plain name', async () => {
      const names = ['src/auth/login.ts', 'src/auth/\tlogin.ts', 'src/auth/\u202egnp.ts'];
      for (const [index, name] of names.entries()) {
        h.rules.set('worker', [catalogueReason('path.sensitive', { subject: escapePath(name) })]);
        const unit = capture(`odd-${index}`, { files: [{ path: name, hunks: ['+a'] }, { path: 'src/other.ts', hunks: ['+b'] }] });
        await h.manager.submit(unit);
        const waiting = await reach(unit.id, 'awaiting_human');
        expect(waiting.rung, `path.sensitive is D for ${JSON.stringify(name)}`).toBe('D');
        await expect(accept(waiting), `the flagged hunk of ${JSON.stringify(name)} is not seen`).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('look at every flagged hunk') });
        h.manager.seen({ changesetId: unit.id, level: 'hunk', file: 0, hunk: 0, how: 'marked' }, UI);
        expect((await accept(waiting)).state, `accepted once the flagged hunk of ${JSON.stringify(name)} is seen`).toBe('accepted');
      }
    });

    it('holds an accept at D that came from an escalation until the summary or every hunk is seen', async () => {
      const unit = capture('escalated-d', { files: [{ path: 'src/a.ts', hunks: ['+a'] }] });
      await h.manager.submit(unit);
      await reach(unit.id, 'awaiting_human');
      await h.manager.escalate({ changesetId: unit.id, toRung: 'D', reason: 'look closer' }, UI);
      const escalated = detail(unit.id).changeset;
      expect(escalated.rung, 'the escalation raised the rung').toBe('D');
      await expect(accept(escalated), 'nothing was looked at').rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('summary or every hunk') });
      h.manager.seen({ changesetId: unit.id, level: 'summary', how: 'marked' }, UI);
      expect((await accept(escalated)).state, 'accepted once the summary is seen').toBe('accepted');
    });

    it('applies the rung an agent asks for in report_outcome to its next capture as agent.requested', async () => {
      h.manager.reportOutcome({ summary: 'touched auth', confidence: 'medium', testsRun: [], unverified: [], requestRung: 'D' }, WORKER);
      const unit = capture('requested', { policyHash: RUNG_A_WITHOUT_CHECK.hash });
      const submitted = await h.manager.submit(unit);
      expect(submitted.rung, 'the capture starts at the requested rung').toBe('D');
      const requested = detail(unit.id).reasons.find((reason) => reason.id === 'agent.requested');
      expect([requested?.minRung, requested?.subject, requested?.hard], 'the reason of the request').toEqual(['D', 'request:D', false]);
      const next = capture('not-requested', { policyHash: RUNG_A_WITHOUT_CHECK.hash });
      const second = await h.manager.submit(next);
      expect(detail(second.id).reasons.map((reason) => reason.id), 'the request applies to one capture').not.toContain('agent.requested');
    });

    it('moves a sent-back changeset to the person when the agent ends without new work, and lets the user reject it meanwhile', async () => {
      const unit = capture('stuck');
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      await h.manager.sendBack({ changesetId: unit.id, expectedHash: waiting.contentHash, message: 'fix it' }, UI);
      expect(detail(unit.id).changeset.state, 'sent back').toBe('sent_back');
      await expect(h.manager.noNewCapture('sw1', 'helper', 'nothing'), 'an agent with no changeset').resolves.toBeUndefined();
      const moved = await h.manager.noNewCapture('sw1', 'worker', 'the agent ended without changing its work tree');
      expect(moved?.state, 'the person decides now').toBe('awaiting_human');
      expect(detail(unit.id).decisions.at(-1), 'the decision is the app\'s and carries the reason').toMatchObject({ actor: 'app', action: 'no_new_capture', reason: 'the agent ended without changing its work tree' });
      await expect(h.manager.noNewCapture('sw1', 'worker', 'again'), 'a changeset that is not sent back stays').resolves.toBeUndefined();
      expect((await h.manager.reject({ changesetId: unit.id, expectedHash: waiting.contentHash, reason: 'give up' }, UI)).state, 'the user can reject it').toBe('rejected');

      const other = helperCapture('stuck-reject');
      await h.manager.submit(other);
      const waitingOther = await reach(other.id, 'awaiting_human');
      await h.manager.sendBack({ changesetId: other.id, expectedHash: waitingOther.contentHash }, UI);
      expect((await h.manager.reject({ changesetId: other.id, expectedHash: waitingOther.contentHash, reason: 'no' }, UI)).state, 'a reject straight from sent_back').toBe('rejected');
    });

    it('applies a second escalation to a rung the changeset was escalated to before a demotion', async () => {
      const unit = capture('re-escalate');
      await h.manager.submit(unit);
      await reach(unit.id, 'awaiting_human');
      await h.manager.escalate({ changesetId: unit.id, toRung: 'D' }, UI);
      expect(detail(unit.id).changeset.rung, 'raised to D').toBe('D');
      await h.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the escalation was too strong' }, UI);
      expect(detail(unit.id).changeset.rung, 'demoted to C').toBe('C');
      await h.manager.escalate({ changesetId: unit.id, toRung: 'D', reason: 'after all, look again' }, UI);
      expect(detail(unit.id).changeset.rung, 'the second escalation raises again').toBe('D');
    });

    it('does not accept a rung A changeset on its own when no check passed', async () => {
      const unit = capture('no-check', { policyHash: RUNG_A_WITHOUT_CHECK.hash });
      h.setReviewer(() => '/sleep 2000');
      await h.manager.submit(unit);
      const started = await reach(unit.id, 'in_review');
      expect(started.rung, 'nothing raised the rung').toBe('A');
      expect(detail(unit.id).decisions.map((decision) => decision.action), 'the app did not accept').not.toContain('auto_accept');
    });

    it('leaves a rejected agent in the merge gate unless the merge excludes it', async () => {
      const unit = capture('rejected-agent');
      await h.manager.submit(unit);
      const waiting = await reach(unit.id, 'awaiting_human');
      await h.manager.reject({ changesetId: unit.id, expectedHash: waiting.contentHash, reason: 'wrong approach' }, UI);
      const entry = (exclude: string[]) => h.manager.mergeGate('sw1', exclude).agents.find((candidate) => candidate.agent === 'worker');
      expect(entry([])?.ok, 'a rejected agent blocks the merge').toBe(false);
      expect(entry([])?.why, 'the gate names the state').toContain('rejected');
      expect(entry(['helper'])?.ok, 'excluding another agent does not help').toBe(false);
      expect(entry(['worker'])?.ok, 'excluding the rejected agent opens its entry').toBe(true);
    });

    it('lets neither a reviewer nor a swarm agent merge', async () => {
      await expect(h.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: true }, REVIEWER), 'a reviewer').rejects.toMatchObject({ code: 'out_of_scope', message: 'reviewers never merge' });
      await expect(h.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: true }, WORKER), 'a swarm agent').rejects.toMatchObject({ code: 'out_of_scope' });
    });
  });
}
