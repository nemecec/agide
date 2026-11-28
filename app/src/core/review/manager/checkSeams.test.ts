import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import { catalogueReason, FakeCheckExecutor, FakeMerger, FakeReviewBudget, FakeRiskRules, FakeSendBackChannel, InMemorySwarmFacts } from '../fakes/fakes';
import { captureFixture, policySnapshot, sha1Of, sha256Of } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import type { Baseline, FailureSets, TestFailure, TestRunSummary } from '../reports/types';
import { InMemoryReviewerRuntime } from '../reviewer/InMemoryReviewerRuntime';
import { reportReviewInputSchema, type ChangesetRecord, type ChangesetState } from '../schemas';
import { InMemoryChangesetStore } from '../store/InMemoryChangesetStore';
import type { ReviewRunRequest } from '../types';
import { InMemoryReviewManager } from './InMemoryReviewManager';
import { reportStep } from './reviewManagerContract';
import { DEFAULT_CHECK_DECISION, type CheckDecision, type CheckDecisionSeam } from './checkDecision';

const WITH_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }), 'seams-check');
const WITH_REPORTS = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'], reports: { junit: ['reports/*.xml'] } } }), 'seams-reports');
const NO_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1 }), 'seams-none');
const FIX = { kind: 'base_fix' as const, commitId: sha1Of('red base'), policyHash: sha256Of('red policy') };
const UI = { kind: 'ui' } as const;

const summary: TestRunSummary = { source: 'junit', status: 'parsed', refusal: null, files: 1, bytes: 300, executed: 4, passed: 3, failed: 1, skipped: 0 };
const ref = { key: sha256Of('t1'), suite: 'suite', name: 'test one', message: 'expected 1 to be 2' };
const sets: FailureSets = { against: 'baseline', baselineState: 'clean', new: [ref], known: [], flaky: [], fixed: [], missing: 0, truncated: false };
const baseline: Baseline = { commitId: sha1Of('base'), policyHash: sha256Of('p'), jobId: 'bjob_1', state: 'clean', known: [], flaky: [], executed: 4 };
const failure: TestFailure = { key: sha256Of('t1'), suite: 'suite', name: 'test one', status: 'failed', message: 'expected 1 to be 2' };

describe('the check seams of the review manager', () => {
  let store: InMemoryChangesetStore;
  let facts: InMemorySwarmFacts;
  let checks: FakeCheckExecutor;
  let rules: FakeRiskRules;
  let sendBack: FakeSendBackChannel;
  let agents: InMemoryAgentRuntime;
  let reviewer: InMemoryReviewerRuntime;
  let manager: InMemoryReviewManager;
  let reviewRequests: ReviewRunRequest[];

  const build = (extra: { checkDecision?: CheckDecisionSeam; withTests?: boolean } = {}) => {
    manager = new InMemoryReviewManager({
      store,
      facts,
      rules,
      checks,
      reviewer,
      budget: new FakeReviewBudget(10),
      sendBack,
      merger: new FakeMerger(),
      ...(extra.checkDecision === undefined ? {} : { checkDecision: extra.checkDecision }),
      ...(extra.withTests === true ? { tests: store } : {}),
    });
  };

  beforeEach(() => {
    store = new InMemoryChangesetStore();
    store.putPolicy(WITH_CHECK);
    store.putPolicy(NO_CHECK);
    store.putPolicy(WITH_REPORTS);
    facts = new InMemorySwarmFacts();
    facts.addFolder('folder-user');
    facts.addSwarm('sw1', { folderId: 'folder-user', callerSessionId: 'session-starter' });
    facts.addAgent('sw1', { name: 'worker', sessionId: 'session-worker' });
    facts.addSwarm('fix', { folderId: 'folder-user', purpose: FIX });
    facts.addAgent('fix', { name: 'worker', sessionId: 'session-fix-worker' });
    checks = new FakeCheckExecutor();
    rules = new FakeRiskRules();
    sendBack = new FakeSendBackChannel();
    agents = new InMemoryAgentRuntime();
    reviewRequests = [];
    reviewer = new InMemoryReviewerRuntime({ runtime: agents, script: (request) => (reviewRequests.push(request), '/text nothing'), onReportCall: async () => undefined });
  });
  afterEach(async () => {
    await manager.shutdown();
    await reviewer.dispose();
    await agents.dispose();
  });

  const capture = (seed: string, swarmId = 'sw1', policyHash = WITH_CHECK.hash) => captureFixture({ seed, swarmId, policyHash, sessionId: swarmId === 'fix' ? 'session-fix-worker' : 'session-worker' });
  const until = async (changesetId: string, check: (changeset: ChangesetRecord) => boolean): Promise<ChangesetRecord> => {
    const deadline = Date.now() + 3_000;
    for (;;) {
      const found = store.get(changesetId)!;
      if (check(found)) return found;
      if (Date.now() > deadline) throw new Error(`timed out; ${found.state} at ${found.rung}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const reach = (changesetId: string, state: ChangesetState) => until(changesetId, (changeset) => changeset.state === state);

  describe('the purpose of the swarm', () => {
    it('gives the rules the purpose of a fix swarm and holds each of its changesets at rung C', async () => {
      build();
      const first = capture('fix-one', 'fix');
      await manager.submit(first);
      const held = await until(first.id, (changeset) => changeset.state !== 'captured' && changeset.state !== 'checking' && changeset.state !== 'assessed');
      expect(rules.inputs[0]?.swarmPurpose, 'the rules see the purpose').toEqual(FIX);
      expect(store.reasons(first.id).map((reason) => reason.id), 'check.base_fix is stored').toContain('check.base_fix');
      expect(held.rung, 'a passed check does not accept a fix at rung A: a person reviews it').toBe('C');
      expect(held.state, 'it waits for the reviewer and the person').not.toBe('accepted');
    });

    it('gives the rules no purpose for a plain swarm, whose changeset is accepted at rung A', async () => {
      build();
      const plain = capture('plain-one');
      await manager.submit(plain);
      await reach(plain.id, 'accepted');
      expect(rules.inputs[0]?.swarmPurpose, 'no purpose').toBeUndefined();
      expect('swarmPurpose' in (rules.inputs[0] ?? {}), 'the key is absent').toBe(false);
      expect(store.reasons(plain.id).map((reason) => reason.id), 'no check.base_fix').not.toContain('check.base_fix');
    });
  });

  describe('the repeat of a checkpoint run', () => {
    const repeating: CheckDecisionSeam = { ...DEFAULT_CHECK_DECISION, rerun: ({ outcome }) => outcome.checkpoint.outcome === 'failed' };

    it('runs the check again with the id of the first run, stores both rows and assesses the second outcome', async () => {
      build({ checkDecision: repeating });
      const changeset = capture('flaky');
      checks.set(changeset.id, 'failed');
      checks.setRerun(changeset.id, 'passed');
      await manager.submit(changeset);
      await reach(changeset.id, 'accepted');
      expect(checks.requests.map((request) => request.rerunOf ?? null), 'the second request names the first run').toEqual([null, `chk_checkpoint_${changeset.id}`]);
      expect(store.checks(changeset.id).map((check) => [check.id, check.outcome, check.rerunOf ?? null]), 'both rows are stored').toEqual([
        [`chk_checkpoint_${changeset.id}`, 'failed', null],
        [`chk_checkpoint_${changeset.id}_rerun`, 'passed', `chk_checkpoint_${changeset.id}`],
      ]);
      expect(rules.inputs[0]?.check?.checkpoint.outcome, 'the rules see the outcome of the repeat').toBe('passed');
      expect(sendBack.sent, 'nothing was sent back').toEqual([]);
    });

    it('repeats at most once for a changeset, however the seam answers', async () => {
      build({ checkDecision: { ...DEFAULT_CHECK_DECISION, rerun: () => true } });
      const changeset = capture('always');
      checks.set(changeset.id, 'failed');
      checks.setRerun(changeset.id, 'failed');
      await manager.submit(changeset);
      await until(changeset.id, (found) => found.state !== 'captured' && found.state !== 'checking' && found.state !== 'assessed');
      expect(checks.requests.length, 'one run and one repeat').toBe(2);
    });

    it('does not repeat the run of a changeset that already has a repeat, as when the pipeline runs again after a restart', async () => {
      class Rig extends InMemoryReviewManager {
        runPipelineAgain(changesetId: string): Promise<void> {
          return this.pipeline(changesetId);
        }
      }
      manager = new Rig({ store, facts, rules, checks, reviewer, budget: new FakeReviewBudget(10), sendBack, merger: new FakeMerger(), checkDecision: { ...DEFAULT_CHECK_DECISION, rerun: () => true } });
      const changeset = capture('restart');
      checks.set(changeset.id, 'failed');
      checks.setRerun(changeset.id, 'failed');
      await manager.submit(changeset);
      const settled = await until(changeset.id, (found) => found.state !== 'captured' && found.state !== 'checking' && found.state !== 'assessed');
      expect(checks.requests.length, 'the first pass ran the check and its repeat').toBe(2);
      store.applyDecision(
        { id: 'dec_reset', changesetId: changeset.id, actor: 'app', actorSessionId: null, action: 'start_check', fromState: settled.state, toState: 'checking', fromRung: settled.rung, toRung: settled.rung, contentHash: settled.contentHash, reason: null, createdAt: new Date().toISOString() },
        { state: 'checking', rung: settled.rung, floor: settled.floor },
      );
      await (manager as Rig).runPipelineAgain(changeset.id);
      expect(checks.requests.map((request) => request.rerunOf ?? null).slice(2), 'the second pass ran the check once and no repeat').toEqual([null]);
    });

    it('does not ask the seam when there is no check to repeat', async () => {
      const asked: string[] = [];
      build({ checkDecision: { ...DEFAULT_CHECK_DECISION, rerun: () => (asked.push('asked'), false) } });
      const changeset = capture('none', 'sw1', NO_CHECK.hash);
      await manager.submit(changeset);
      await until(changeset.id, (found) => found.state === 'in_review' || found.state === 'awaiting_human' || found.state === 'accepted');
      expect(asked, 'no check, no question').toEqual([]);
      expect(checks.requests, 'no run').toEqual([]);
    });
  });

  describe('the decision after the check', () => {
    it('sends the message of the seam to the agent', async () => {
      const decide = (): CheckDecision => ({ kind: 'send_back', message: 'a message from the seam' });
      build({ checkDecision: { rerun: () => false, decide } });
      const changeset = capture('seam-send');
      await manager.submit(changeset);
      await reach(changeset.id, 'sent_back');
      expect(sendBack.sent.map((sent) => [sent.agent, sent.message]), 'the text of the seam, as given').toEqual([['worker', 'a message from the seam']]);
    });

    it('goes to review when the seam holds the changeset, even for a failed check with attempts left', async () => {
      build({ checkDecision: { rerun: () => false, decide: () => ({ kind: 'review' }) } });
      const changeset = capture('seam-hold');
      checks.set(changeset.id, 'failed');
      await manager.submit(changeset);
      await until(changeset.id, (found) => found.state === 'in_review' || found.state === 'awaiting_human');
      expect(sendBack.sent, 'a held changeset is not sent back').toEqual([]);
      expect(store.runs(changeset.id).length, 'a reviewer run was started').toBeGreaterThan(0);
    });

    it('hands the seam the reason ids, the outcome, the effective policy and its retry limit', async () => {
      const seen: { ids: string[]; outcome: string | undefined; limit: number; attempt: number; command: readonly string[] | undefined; reports: unknown }[] = [];
      build({
        checkDecision: {
          rerun: () => false,
          decide: (input) => {
            seen.push({ ids: [...input.reasonIds].sort(), outcome: input.outcome?.checkpoint.outcome, limit: input.retryLimit, attempt: input.changeset.attempt, command: input.policy.check?.command, reports: input.policy.check?.reports });
            return { kind: 'review' };
          },
        },
      });
      const changeset = capture('seam-input', 'sw1', WITH_REPORTS.hash);
      checks.set(changeset.id, 'failed');
      await manager.submit(changeset);
      await until(changeset.id, (found) => found.state === 'in_review' || found.state === 'awaiting_human');
      expect(seen, 'the input of the decision, with the effective policy and its report globs').toEqual([
        { ids: ['check.failed'], outcome: 'failed', limit: 2, attempt: 0, command: ['pnpm', 'test'], reports: { junit: ['reports/*.xml'], libtest: false } },
      ]);
    });
  });

  describe('the reviewer at rung B over a check condition', () => {
    it.each([
      ['check.no_tests', 'awaiting_human'],
      ['check.report_missing', 'awaiting_human'],
      ['check.known_failures', 'awaiting_human'],
      ['check.flaky_pass', 'accepted'],
      ['check.base_no_tests', 'accepted'],
    ] as const)('with %s the changeset ends %s after an accepting report', async (reasonId, expected) => {
      await reviewer.dispose();
      reviewer = new InMemoryReviewerRuntime({
        runtime: agents,
        script: (request) => reportStep(request.changesetId),
        onReportCall: async (sessionId, input) => {
          const parsed = reportReviewInputSchema.safeParse(input);
          if (parsed.success) await manager.reportReview(parsed.data, { kind: 'reviewer', sessionId }).catch(() => undefined);
        },
      });
      build();
      rules.set('worker', [catalogueReason(reasonId, { minRung: 'B' })]);
      const changeset = capture(`blocks-${reasonId}`);
      await manager.submit(changeset);
      const settled = await until(changeset.id, (found) => found.state === 'accepted' || found.state === 'awaiting_human');
      expect([settled.rung, settled.state], 'the rung stays B and the reviewer decides by the reason').toEqual(['B', expected]);
    });
  });

  describe('the stored test run of a checkpoint run', () => {
    it('stores the failing cases with the record when the manager has a test store', async () => {
      build({ withTests: true });
      const changeset = capture('tests-stored');
      checks.setTests(changeset.id, summary, [failure]);
      await manager.submit(changeset);
      await reach(changeset.id, 'accepted');
      const stored = store.checks(changeset.id)[0];
      expect(stored?.tests, 'the counts are read back on the record').toEqual(summary);
      expect(store.testFailures(stored!.id), 'the failing cases are stored').toEqual([failure]);
    });

    it('stores the failure sets of the outcome with the run, shows them in the detail and gives them to the reviewer', async () => {
      build({ withTests: true, checkDecision: { rerun: () => false, decide: () => ({ kind: 'review' }) } });
      const changeset = capture('sets-stored');
      checks.set(changeset.id, 'failed');
      checks.setTests(changeset.id, summary, [failure], { sets });
      await manager.submit(changeset);
      await until(changeset.id, (found) => found.state === 'in_review' || found.state === 'awaiting_human');
      const stored = store.checks(changeset.id)[0]!;
      expect(store.failureSets(stored.id), 'the sets are stored with the run').toEqual(sets);
      expect(manager.get({ changesetId: changeset.id, hunks: false }, UI).failures, 'the detail carries them').toEqual(sets);
      expect(reviewRequests[0]?.failures, 'the reviewer request carries them').toEqual(sets);
    });

    it('leaves the sets out of the detail and the reviewer request when the outcome has none', async () => {
      build({ withTests: true, checkDecision: { rerun: () => false, decide: () => ({ kind: 'review' }) } });
      const changeset = capture('sets-none');
      checks.set(changeset.id, 'failed');
      checks.setTests(changeset.id, summary, [failure]);
      await manager.submit(changeset);
      await until(changeset.id, (found) => found.state === 'in_review' || found.state === 'awaiting_human');
      expect('failures' in manager.get({ changesetId: changeset.id, hunks: false }, UI), 'no sets in the detail').toBe(false);
      expect('failures' in (reviewRequests[0] ?? {}), 'no sets in the request').toBe(false);
    });

    it('keeps the sets of the repeat of a checkpoint run apart from those of the first run and shows the latest in the detail', async () => {
      build({ withTests: true, checkDecision: { ...DEFAULT_CHECK_DECISION, rerun: ({ outcome }) => outcome.checkpoint.outcome === 'failed' } });
      const changeset = capture('sets-rerun');
      const repeated: FailureSets = { ...sets, new: [], fixed: [ref], missing: 3 };
      checks.set(changeset.id, 'failed');
      checks.setTests(changeset.id, summary, [failure], { sets, rerunSets: repeated, baseline });
      await manager.submit(changeset);
      await reach(changeset.id, 'accepted');
      const [first, second] = store.checks(changeset.id);
      expect(store.failureSets(first!.id), 'the first run keeps its sets').toEqual(sets);
      expect(store.failureSets(second!.id), 'the repeat has its own').toEqual(repeated);
      expect(manager.get({ changesetId: changeset.id, hunks: false }, UI).failures, 'the detail reads the latest run').toEqual(repeated);
    });

    it('keeps no counts and no failures without a test store', async () => {
      build();
      const changeset = capture('tests-dropped');
      checks.setTests(changeset.id, summary, [failure]);
      await manager.submit(changeset);
      await reach(changeset.id, 'accepted');
      expect(store.checks(changeset.id)[0]?.tests ?? null, 'no counts').toBeNull();
      expect(store.testFailures(store.checks(changeset.id)[0]!.id), 'no failures').toEqual([]);
    });

    it('stores nothing for a check without reports', async () => {
      build({ withTests: true });
      const changeset = capture('tests-none');
      await manager.submit(changeset);
      await reach(changeset.id, 'accepted');
      expect(store.checks(changeset.id)[0]?.tests ?? null, 'a check without reports has no counts').toBeNull();
    });
  });

  it('lets a caller read the stored check through the ui caller as before', async () => {
    build();
    const changeset = capture('read');
    await manager.submit(changeset);
    await reach(changeset.id, 'accepted');
    expect(manager.get({ changesetId: changeset.id, hunks: false }, UI).checks.map((check) => check.outcome), 'the check of the changeset').toEqual(['passed']);
  });
});
