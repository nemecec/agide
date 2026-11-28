import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import { FakeCheckExecutor, FakeMerger, FakeReviewBudget, FakeRiskRules, FakeSendBackChannel, InMemorySwarmFacts } from '../fakes/fakes';
import { captureFixture, policySnapshot, sha256Of } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import type { Baseline, FailureSets, TestFailure, TestRunSummary } from '../reports/types';
import { InMemoryReviewerRuntime } from '../reviewer/InMemoryReviewerRuntime';
import { InMemoryChangesetStore } from '../store/InMemoryChangesetStore';
import type { CheckDecisionInput, CheckDecisionSeam } from './checkDecision';
import { PersistentReviewManager } from './PersistentReviewManager';

const POLICY = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'], reports: { junit: ['reports/*.xml'] } } }), 'recover-checks');
const summary: TestRunSummary = { source: 'junit', status: 'parsed', refusal: null, files: 1, bytes: 300, executed: 4, passed: 3, failed: 1, skipped: 0 };
const failure: TestFailure = { key: sha256Of('t1'), suite: 'suite', name: 'test one', status: 'failed', message: 'expected 1 to be 2' };
const sets: FailureSets = { against: 'baseline', baselineState: 'clean', new: [{ key: failure.key, suite: 'suite', name: 'test one', message: 'expected 1 to be 2' }], known: [], flaky: [], fixed: [], missing: 0, truncated: false };

describe('the decision of a changeset that was assessed when the app stopped', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    vi.restoreAllMocks();
  });

  function manager(store: InMemoryChangesetStore, checks: FakeCheckExecutor, checkDecision: CheckDecisionSeam, facts: InMemorySwarmFacts): PersistentReviewManager {
    const agents = new InMemoryAgentRuntime();
    const reviewer = new InMemoryReviewerRuntime({ runtime: agents, script: () => '/text nothing', onReportCall: async () => undefined });
    const built = new PersistentReviewManager({ store, facts, rules: new FakeRiskRules(), checks, reviewer, budget: new FakeReviewBudget(10), sendBack: new FakeSendBackChannel(), merger: new FakeMerger(), tests: store, checkDecision });
    closers.push(async () => {
      await built.shutdown();
      await reviewer.dispose();
      await agents.dispose();
    });
    return built;
  }

  it('gets the stored failure sets and baseline of the pair, as the decision of the first run would', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new InMemoryChangesetStore();
    store.putPolicy(POLICY);
    const facts = new InMemorySwarmFacts();
    facts.addFolder('folder-user');
    facts.addSwarm('sw1', { folderId: 'folder-user' });
    facts.addAgent('sw1', { name: 'worker', sessionId: 'session-worker' });
    const capture = captureFixture({ seed: 'recover-sets', policyHash: POLICY.hash, sessionId: 'session-worker' });
    const baseline: Baseline = { commitId: capture.baseCommit, policyHash: POLICY.hash, jobId: 'bjob_1', state: 'clean', known: [], flaky: [], executed: 4 };
    const checks = new FakeCheckExecutor();
    checks.setTests(capture.id, summary, [failure], { sets, baseline });
    checks.set(capture.id, 'failed');

    const first = manager(store, checks, {
      rerun: () => false,
      decide: () => {
        throw new Error('the app stopped before the decision');
      },
    }, facts);
    store.putBaseline(baseline);
    await first.submit(capture);
    for (let turn = 0; turn < 100 && store.get(capture.id)?.state !== 'assessed'; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(store.get(capture.id)?.state, 'the first manager stopped after the rules').toBe('assessed');

    const seen: CheckDecisionInput[] = [];
    const second = manager(store, checks, { rerun: () => false, decide: (input) => (seen.push(input), { kind: 'review' }) }, facts);
    await second.recover();
    expect(seen.length, 'the decision is asked once after the restart').toBe(1);
    expect(seen[0]?.outcome?.failures, 'the stored failure sets').toEqual(sets);
    expect(seen[0]?.outcome?.baseline, 'the stored baseline of the pair').toEqual(baseline);
    expect(seen[0]?.outcome?.checkpoint.outcome, 'the stored checkpoint run').toBe('failed');
    expect(seen[0]?.policy.check?.reports?.junit, 'the effective policy with its report globs').toEqual(['reports/*.xml']);
  });

  it('gets the checkpoint run alone when no failure sets or baseline were stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new InMemoryChangesetStore();
    store.putPolicy(POLICY);
    const facts = new InMemorySwarmFacts();
    facts.addFolder('folder-user');
    facts.addSwarm('sw1', { folderId: 'folder-user' });
    facts.addAgent('sw1', { name: 'worker', sessionId: 'session-worker' });
    const capture = captureFixture({ seed: 'recover-plain', policyHash: POLICY.hash, sessionId: 'session-worker' });
    const checks = new FakeCheckExecutor();
    checks.set(capture.id, 'failed');
    const first = manager(store, checks, {
      rerun: () => false,
      decide: () => {
        throw new Error('the app stopped before the decision');
      },
    }, facts);
    await first.submit(capture);
    for (let turn = 0; turn < 100 && store.get(capture.id)?.state !== 'assessed'; turn += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const seen: CheckDecisionInput[] = [];
    await manager(store, checks, { rerun: () => false, decide: (input) => (seen.push(input), { kind: 'review' }) }, facts).recover();
    expect(Object.keys(seen[0]?.outcome ?? {}), 'nothing but the checkpoint run').toEqual(['checkpoint']);
  });
});
