import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRig, gitTestEnv, makeRepo, type ManagerRig } from '../../swarm/manager/testRig';
import type { SwarmCaller, SwarmId } from '../../swarm/types';
import { FakeCheckExecutor, FakeRiskRules, catalogueReason } from '../fakes/fakes';
import { changesetIdOf, policySnapshot, sha256Of, capturedFiles } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import { InMemoryReviewerRuntime } from '../reviewer/InMemoryReviewerRuntime';
import { SqliteChangesetStore } from '../store/SqliteChangesetStore';
import type { CapturedChangeset, ReviewCaller } from '../types';
import { GitMerger } from './GitMerger';
import { PersistentReviewManager } from './PersistentReviewManager';
import { SqliteReviewBudget } from './SqliteReviewBudget';
import { SwarmReviewFacts, SwarmSendBack } from './SwarmReviewFacts';
import { execFileSync } from 'node:child_process';

const UI_SWARM: SwarmCaller = { kind: 'ui' };
const UI: ReviewCaller = { kind: 'ui' };
const POLICY = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }), 'integration');

let rig: ManagerRig;
let repo: ReturnType<typeof makeRepo>;
let manager: PersistentReviewManager;
let store: SqliteChangesetStore;
let facts: SwarmReviewFacts;
let reviewer: InMemoryReviewerRuntime;
const rules = new FakeRiskRules();

beforeEach(() => {
  repo = makeRepo();
  rig = createRig();
  store = new SqliteChangesetStore(rig.db);
  facts = new SwarmReviewFacts(rig.manager, { isWithin: (folderId, scope) => rig.folders.isWithin(folderId, scope) });
  reviewer = new InMemoryReviewerRuntime({ runtime: rig.runtime, script: () => '/text nothing', onReportCall: async () => undefined });
  const budget = new SqliteReviewBudget({ db: rig.db, potUsd: () => 10, dailyUsd: () => 10, dayOf: (at) => at.toISOString().slice(0, 10) });
  manager = new PersistentReviewManager({
    store,
    facts,
    rules,
    checks: new FakeCheckExecutor(),
    reviewer,
    budget,
    sendBack: new SwarmSendBack(rig.manager),
    merger: new GitMerger(gitTestEnv),
  });
});
afterEach(async () => {
  await manager.shutdown();
  await reviewer.dispose();
  await rig.close();
  rmSync(repo.dir, { recursive: true, force: true });
});

async function startAndFinish(): Promise<{ swarmId: SwarmId; cwd: string; sessionId: string }> {
  const started = await rig.manager.start(
    { definition: { version: 1, goal: 'add a file\nsecond line', repository: { path: repo.dir, base: 'main' }, budget: { usdTotal: 5, usdPerAgent: 1 }, agents: [{ name: 'one', prompt: '/text done', owns: ['docs/**'] }] } },
    UI_SWARM,
  );
  const deadline = Date.now() + 5_000;
  while (rig.manager.status(started.swarmId, UI_SWARM).agents[0]?.state !== 'done') {
    if (Date.now() > deadline) throw new Error('the agent did not end');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const agent = rig.manager.status(started.swarmId, UI_SWARM).agents[0]!;
  return { swarmId: started.swarmId, cwd: agent.cwd!, sessionId: agent.sessionId! };
}

/** The agent's work as a checkpoint commit made in its worktree, handed over the way the capture service would. */
function capture(swarmId: SwarmId, cwd: string, sessionId: string, seed: string): CapturedChangeset {
  writeFileSync(join(cwd, `${seed}.txt`), `${seed}\n`);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, env: gitTestEnv(), encoding: 'utf8' }).trim();
  git('add', '-A');
  git('commit', '-m', seed);
  const parsed = capturedFiles([{ path: `${seed}.txt`, hunks: [`+${seed}`] }], seed);
  return {
    id: changesetIdOf(seed),
    subject: { kind: 'swarm-agent', swarmId, agent: 'one' },
    sessionId,
    trigger: 'quiet-result',
    repoPath: repo.dir,
    commonDir: join(repo.dir, '.git'),
    baseCommit: repo.commit,
    headCommit: git('rev-parse', 'HEAD'),
    checkpointCommit: git('rev-parse', 'HEAD'),
    checkpointTree: git('rev-parse', 'HEAD^{tree}'),
    contentHash: sha256Of(`content:${seed}`),
    policyHash: POLICY.hash,
    patchPath: `review/${swarmId}/${seed}.patch`,
    workerTier: 'mid',
    claim: { source: 'result', text: 'done' },
    telemetry: { endState: 'done', turns: 1, retries: 0, denials: 0, deniedTools: [], toolErrors: 0, spendUsd: 0.01, backgroundStopped: 0 },
    files: parsed.files,
    hunks: parsed.hunks,
    reasons: [],
  };
}

describe('review over a real swarm manager', () => {
  it('reads the swarm through the facts: goal, default target, repository, agents and capture facts', async () => {
    store.putPolicy(POLICY);
    const { swarmId, cwd, sessionId } = await startAndFinish();
    expect(facts.swarm(swarmId), 'the view of the swarm').toMatchObject({
      goal: 'add a file\nsecond line',
      defaultTarget: 'main',
      repository: { path: repo.dir, baseCommit: repo.commit },
      agents: [{ name: 'one', workspace: 'worktree', state: 'done', task: '/text done', owns: ['docs/**'] }],
    });
    expect(facts.agentOf(sessionId), 'the agent of its session').toEqual({ swarmId, agent: 'one', workspace: 'worktree' });
    expect(facts.captureFacts(swarmId, 'one'), 'what a capture reads').toMatchObject({ sessionId, workspace: 'worktree', worktreePath: cwd, tier: expect.any(String), resultText: expect.any(String) });
    expect(facts.folderOf(swarmId), 'the swarm folder').toEqual(expect.any(String));
  });

  it('scopes session callers by folder, refuses report_outcome to a readonly agent and gives no default target for a commit base', async () => {
    store.putPolicy(POLICY);
    const started = await rig.manager.start(
      {
        definition: {
          version: 1,
          goal: 'scoped',
          repository: { path: repo.dir, base: repo.commit },
          budget: { usdTotal: 5, usdPerAgent: 1 },
          agents: [
            { name: 'one', prompt: '/text done', workspace: 'worktree' },
            { name: 'two', prompt: '/text read', workspace: 'readonly', stage: 1 },
          ],
        },
      },
      UI_SWARM,
    );
    const deadline = Date.now() + 5_000;
    while (rig.manager.status(started.swarmId, UI_SWARM).agents.some((agent) => agent.state !== 'done')) {
      if (Date.now() > deadline) throw new Error('the agents did not end');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const [one, two] = rig.manager.status(started.swarmId, UI_SWARM).agents;
    expect(facts.swarm(started.swarmId)?.defaultTarget, 'a commit id is no merge target').toBeUndefined();
    expect(facts.agentOf(two!.sessionId!), 'the readonly agent').toMatchObject({ workspace: 'readonly' });
    const reportAs = (sessionId: string) => manager.reportOutcome({ summary: 'all good', confidence: 'high', testsRun: [], unverified: [] }, { kind: 'session', sessionId, folderId: started.folderId });
    expect(() => reportAs(two!.sessionId!), 'a readonly agent has no work to claim').toThrow(/worktree/);
    expect(reportAs(one!.sessionId!), 'the worktree agent may').toMatchObject({ recorded: true });

    const unit = capture(started.swarmId, one!.cwd!, one!.sessionId!, 'scoped');
    await manager.submit(unit);
    const sibling = rig.folders.create('sibling', null);
    const outsider: ReviewCaller = { kind: 'session', sessionId: 'session-outside', folderId: sibling };
    expect(manager.list({ swarmId: started.swarmId, limit: 20 } as never, outsider), 'a session in a sibling folder sees nothing').toEqual([]);
    expect(() => manager.get({ changesetId: unit.id, hunks: false } as never, outsider), 'nor reads the changeset').toThrow(/outside your scope/);
    const insider: ReviewCaller = { kind: 'session', sessionId: 'session-inside', folderId: started.folderId };
    expect(manager.list({ swarmId: started.swarmId, limit: 20 } as never, insider).map((entry) => entry.id), 'a session in the swarm folder sees it').toEqual([unit.id]);
  });

  it('accepts a passed check at rung A, opens the gate and merges into the checked-out branch', async () => {
    store.putPolicy(POLICY);
    const { swarmId, cwd, sessionId } = await startAndFinish();
    const unit = capture(swarmId, cwd, sessionId, 'feature');
    await manager.submit(unit);
    await until(() => store.get(unit.id)?.state === 'accepted', 'the auto accept');
    expect(manager.mergeGate(swarmId).open, 'the gate opens').toBe(true);
    const result = await manager.merge({ swarmId, exclude: [], dryRun: false }, UI);
    expect(result.merged.map((entry) => entry.agent), 'the agent merged').toEqual(['one']);
    expect(repo.git('log', '-1', '--format=%an|%s'), 'one squash commit by the app with the first line of the goal').toBe('Agide|Agide: one (add a file)');
    expect(repo.git('show', 'HEAD:feature.txt'), 'the file is in the branch').toBe('feature');
    expect(store.get(unit.id)?.mergedCommit, 'the changeset knows its commit').toBe(result.merged[0]?.commit);
  });

  it('sends the work back through the swarm manager, which resumes the agent with the message and the comments', async () => {
    store.putPolicy(POLICY);
    rules.set('one', [catalogueReason('size.large')]);
    const { swarmId, cwd, sessionId } = await startAndFinish();
    const unit = capture(swarmId, cwd, sessionId, 'rework');
    await manager.submit(unit);
    await until(() => store.get(unit.id)?.state === 'in_review' || store.get(unit.id)?.state === 'awaiting_human', 'the pipeline');
    const current = store.get(unit.id)!;
    manager.comment({ changesetId: unit.id, file: 0, side: 'new', line: 1, body: 'use a better name' }, UI);
    const launches = rig.runtime.launches.length;
    const moved = await manager.sendBack({ changesetId: unit.id, expectedHash: current.contentHash, message: 'please rename it' }, UI);
    expect(moved.state, 'sent back').toBe('sent_back');
    await until(() => rig.runtime.launches.length > launches || rig.manager.status(swarmId, UI_SWARM).agents[0]?.state === 'running', 'the agent to resume');
    expect(JSON.stringify(rig.runtime.launches.at(-1)), 'the resume carries the user message and the comment').toEqual(expect.stringContaining('use a better name'));
    expect(store.comments(unit.id).map((comment) => comment.state), 'the comment is marked sent').toEqual(['sent']);
  });

  it('carries the permission denials of the agent into the capture facts, so run.denials can fire', async () => {
    const started = await rig.manager.start(
      { definition: { version: 1, goal: 'denied', repository: { path: repo.dir, base: 'main' }, budget: { usdTotal: 5, usdPerAgent: 1 }, agents: [{ name: 'one', prompt: '/tool Bash {"command":"rm -rf build"}\n/text gave up' }] } },
      UI_SWARM,
    );
    const deadline = Date.now() + 5_000;
    let waiting;
    while ((waiting = rig.manager.status(started.swarmId, UI_SWARM).agents[0]!.openApprovals[0]) === undefined) {
      if (Date.now() > deadline) throw new Error('no approval was asked for');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    rig.manager.answerApproval(started.swarmId, 'one', waiting.requestId, 'deny');
    await until(() => rig.manager.status(started.swarmId, UI_SWARM).agents[0]?.state === 'done', 'the agent to end');
    const telemetry = facts.captureFacts(started.swarmId, 'one')?.telemetry;
    expect([telemetry?.denials, telemetry?.deniedTools], 'one denied call to Bash').toEqual([1, ['Bash']]);
  });

  it('counts the denials of the current run only, so a send-back does not inherit them', async () => {
    const started = await rig.manager.start(
      { definition: { version: 1, goal: 'denied once', repository: { path: repo.dir, base: 'main' }, budget: { usdTotal: 5, usdPerAgent: 1 }, agents: [{ name: 'one', prompt: '/tool Bash {"command":"rm -rf build"}\n/text gave up' }] } },
      UI_SWARM,
    );
    const deadline = Date.now() + 5_000;
    let waiting;
    while ((waiting = rig.manager.status(started.swarmId, UI_SWARM).agents[0]!.openApprovals[0]) === undefined) {
      if (Date.now() > deadline) throw new Error('no approval was asked for');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    rig.manager.answerApproval(started.swarmId, 'one', waiting.requestId, 'deny');
    await until(() => rig.manager.status(started.swarmId, UI_SWARM).agents[0]?.state === 'done', 'the first run to end');
    expect(facts.captureFacts(started.swarmId, 'one')?.telemetry.denials, 'the first run was denied once').toBe(1);
    const launches = rig.runtime.launches.length;
    expect(await new SwarmSendBack(rig.manager).deliver(started.swarmId, 'one', '/text all good'), 'the send-back arrives').toEqual({ delivered: true });
    await until(() => rig.runtime.launches.length > launches && rig.manager.status(started.swarmId, UI_SWARM).agents[0]?.state === 'done', 'the second run to end');
    expect([facts.captureFacts(started.swarmId, 'one')?.telemetry.denials, facts.captureFacts(started.swarmId, 'one')?.telemetry.deniedTools], 'the second run had no denial').toEqual([0, []]);
  });

  it('keeps the denials of a run that was interrupted and resumed after its process ended', async () => {
    const started = await rig.manager.start(
      { definition: { version: 1, goal: 'denied then interrupted', repository: { path: repo.dir, base: 'main' }, budget: { usdTotal: 5, usdPerAgent: 1 }, agents: [{ name: 'one', prompt: '/tool Bash {"command":"rm -rf build"}\n/sleep 600000' }] } },
      UI_SWARM,
    );
    const deadline = Date.now() + 5_000;
    let waiting;
    while ((waiting = rig.manager.status(started.swarmId, UI_SWARM).agents[0]!.openApprovals[0]) === undefined) {
      if (Date.now() > deadline) throw new Error('no approval was asked for');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    rig.manager.answerApproval(started.swarmId, 'one', waiting.requestId, 'deny');
    await rig.manager.interrupt(started.swarmId, { agent: 'one' }, UI_SWARM);
    await until(() => facts.captureFacts(started.swarmId, 'one')?.telemetry.denials === 1, 'the denial to be counted');
    const sessionId = rig.manager.status(started.swarmId, UI_SWARM).agents[0]!.sessionId!;
    expect(rig.runtime.isLive(sessionId), 'the interrupted process is still there').toBe(true);
    await rig.runtime.end(sessionId);
    const launches = rig.runtime.launches.length;
    expect(await new SwarmSendBack(rig.manager).deliver(started.swarmId, 'one', '/text all good'), 'the message resumes the agent').toEqual({ delivered: true });
    await until(() => rig.runtime.launches.length > launches && rig.manager.status(started.swarmId, UI_SWARM).agents[0]?.state === 'done', 'the resumed run to end');
    expect([facts.captureFacts(started.swarmId, 'one')?.telemetry.denials, facts.captureFacts(started.swarmId, 'one')?.telemetry.deniedTools], 'the denial of the first part of the run is still counted').toEqual([1, ['Bash']]);
  });

  it('reports a send-back the swarm manager refuses as not delivered, with its reason', async () => {
    const { swarmId } = await startAndFinish();
    const channel = new SwarmSendBack(rig.manager);
    expect(await channel.deliver(swarmId, 'ghost', 'hello'), 'an agent the swarm does not have').toMatchObject({ delivered: false, why: expect.any(String) });
    expect(await channel.deliver('no-such-swarm', 'one', 'hello'), 'a swarm that does not exist').toMatchObject({ delivered: false });
    expect(await channel.deliver(swarmId, 'one', 'hello'), 'the agent that ended can take a message').toEqual({ delivered: true });
  });
});

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
