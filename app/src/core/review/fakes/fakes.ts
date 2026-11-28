import type { SessionId } from '../../session/types';
import type { SwarmId } from '../../swarm/types';
import type { SwarmPurpose } from '../../swarm/definition';
import type { NodeId } from '../../tree/types';
import { REASON_CATALOGUE, type ReasonId } from '../reasonCatalogue';
import type { Baseline, FailureSets, TestFailure, TestRunSummary } from '../reports/types';
import type { ChangesetId, CheckRecord, PolicySnapshot, Reason } from '../schemas';
import type {
  AssessInput,
  CaptureAgentFacts,
  CheckExecutor,
  CheckOutcomeSet,
  CheckRequest,
  Delivery,
  Merger,
  MergeOutcome,
  PolicyLoader,
  ReviewBudget,
  ReviewQuote,
  ReviewSwarmFacts,
  ReviewSwarmView,
  RiskRules,
  SendBackChannel,
} from '../types';
import { sha1Of } from './fixtures';

/** Test doubles of the review services. They keep what they were asked so tests can read it back. */

/** A reason from the catalogue with its default rung, or the given one. */
export function catalogueReason(id: ReasonId, patch: Partial<Reason> = {}): Reason {
  const definition = REASON_CATALOGUE[id];
  return { id, subject: '', source: definition.source, evidence: {}, minRung: definition.rung, hard: definition.hard, ...patch };
}

/** Answers every check with the outcome set for the changeset, or `passed`. */
export class FakeCheckExecutor implements CheckExecutor {
  readonly requests: CheckRequest[] = [];
  readonly cancelled: ChangesetId[] = [];
  private readonly outcomes = new Map<ChangesetId, { checkpoint: CheckRecord['outcome']; base?: CheckRecord['outcome'] }>();
  private readonly reruns = new Map<ChangesetId, CheckRecord['outcome']>();
  private readonly tests = new Map<ChangesetId, { summary: TestRunSummary; failures: readonly TestFailure[]; sets?: FailureSets; rerunSets?: FailureSets; baseline?: Baseline }>();

  set(changesetId: ChangesetId, checkpoint: CheckRecord['outcome'], base?: CheckRecord['outcome']): void {
    this.outcomes.set(changesetId, { checkpoint, ...(base === undefined ? {} : { base }) });
  }

  /** The outcome of the run that repeats the checkpoint run (`rerunOf` set); without it the repeat passes. */
  setRerun(changesetId: ChangesetId, outcome: CheckRecord['outcome']): void {
    this.reruns.set(changesetId, outcome);
  }

  /** Test counts and failing cases that every checkpoint run of the changeset reports, with the failure sets and baseline of the comparison when given (`rerunSets` for the run that repeats the checkpoint run). */
  setTests(changesetId: ChangesetId, summary: TestRunSummary, failures: readonly TestFailure[], comparison: { readonly sets?: FailureSets; readonly rerunSets?: FailureSets; readonly baseline?: Baseline } = {}): void {
    this.tests.set(changesetId, { summary, failures, ...comparison });
  }

  async run(request: CheckRequest): Promise<CheckOutcomeSet> {
    this.requests.push(request);
    const planned = request.rerunOf === undefined ? (this.outcomes.get(request.changesetId) ?? { checkpoint: 'passed' as const }) : { checkpoint: this.reruns.get(request.changesetId) ?? ('passed' as const) };
    const tests = this.tests.get(request.changesetId);
    const sets = request.rerunOf === undefined ? tests?.sets : (tests?.rerunSets ?? tests?.sets);
    const record = (target: 'checkpoint' | 'base', outcome: CheckRecord['outcome'], commitId: string): CheckRecord => ({
      id: `chk_${target}_${request.changesetId}${request.rerunOf === undefined || target === 'base' ? '' : '_rerun'}`,
      changesetId: target === 'checkpoint' ? request.changesetId : null,
      target,
      commitId,
      policyHash: request.policyHash,
      command: request.policy.check?.command ?? [],
      outcome,
      notRunReason: outcome === 'not_run' ? 'no command' : null,
      exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null,
      signal: null,
      durationMs: 1,
      outputPath: null,
      outputTail: outcome === 'failed' ? 'FAIL one test' : '',
      truncated: false,
      ...(target === 'checkpoint' && request.rerunOf !== undefined ? { rerunOf: request.rerunOf } : {}),
      ...(target === 'checkpoint' && tests !== undefined ? { tests: tests.summary } : {}),
      startedAt: '2026-11-21T10:00:00.000Z',
      endedAt: '2026-11-21T10:00:01.000Z',
    });
    return {
      checkpoint: record('checkpoint', planned.checkpoint, request.checkpointCommit),
      ...(planned.base === undefined ? {} : { base: record('base', planned.base, request.baseCommit) }),
      ...(tests === undefined ? {} : { testRun: { failures: tests.failures, listPath: null } }),
      ...(sets === undefined ? {} : { failures: sets }),
      ...(tests?.baseline === undefined ? {} : { baseline: tests.baseline }),
    };
  }

  async cancel(changesetId: ChangesetId): Promise<void> {
    this.cancelled.push(changesetId);
  }
}

/**
 * Rules that return the reasons set per changeset id (or per agent), plus `check.failed` for a failed checkpoint
 * that the base does not share, `check.base_red` when it does (also for a checkpoint that did not run), and `check.none` without a check command,
 * and `check.base_fix` for a changeset of a fix swarm, each at the policy's `rungs` entry when it has one.
 */
export class FakeRiskRules implements RiskRules {
  readonly inputs: AssessInput[] = [];
  private readonly planned = new Map<string, Reason[]>();

  /** Reasons for a changeset id, or for every changeset of an agent name. */
  set(key: string, reasons: readonly Reason[]): void {
    this.planned.set(key, [...reasons]);
  }

  assess(input: AssessInput): Reason[] {
    this.inputs.push(input);
    const reasons = [...(this.planned.get(input.changeset.id) ?? this.planned.get(input.changeset.agent) ?? [])];
    const check = input.check;
    const rungs = input.policy.effective.rungs;
    const fromPolicy = (id: ReasonId): Reason => catalogueReason(id, rungs[id] === undefined ? {} : { minRung: rungs[id] });
    if (input.policy.effective.check === undefined) reasons.push(fromPolicy('check.none'));
    else if (check?.checkpoint.outcome === 'failed') reasons.push(fromPolicy(check.base?.outcome === 'failed' ? 'check.base_red' : 'check.failed'));
    else if (check?.checkpoint.outcome === 'timed_out') reasons.push(fromPolicy('check.timed_out'));
    else if (check?.checkpoint.outcome === 'not_run') reasons.push(fromPolicy(check.base?.outcome === 'failed' ? 'check.base_red' : 'check.not_run'));
    if (input.swarmPurpose?.kind === 'base_fix') reasons.push(fromPolicy('check.base_fix'));
    return reasons;
  }
}

/** Returns the snapshot it was built with for every repository and base. */
export class FixedPolicyLoader implements PolicyLoader {
  constructor(private readonly snapshot: PolicySnapshot) {}

  async load(): Promise<PolicySnapshot> {
    return this.snapshot;
  }
}

/** A review pot per swarm and one daily amount; reservations are charged until settled. */
export class FakeReviewBudget implements ReviewBudget {
  readonly reservations = new Map<string, { swarmId: SwarmId; usd: number }>();
  readonly settled = new Map<string, number>();

  constructor(
    private pot: number,
    private daily: number = Number.POSITIVE_INFINITY,
  ) {}

  setPot(usd: number): void {
    this.pot = usd;
  }

  reserve(swarmId: SwarmId, runId: string, usdPerRun: number): ReviewQuote {
    if (this.pot <= 0) return { ok: false, why: 'pot' };
    const usd = Math.min(usdPerRun, this.pot);
    if (usd > this.daily) return { ok: false, why: 'daily' };
    this.pot -= usd;
    this.daily -= usd;
    this.reservations.set(runId, { swarmId, usd });
    return { ok: true, usd };
  }

  settle(runId: string, reportedUsd: number): void {
    const reservation = this.reservations.get(runId);
    if (reservation === undefined) return;
    this.pot += reservation.usd - reportedUsd;
    this.daily += reservation.usd - reportedUsd;
    this.reservations.delete(runId);
    this.settled.set(runId, reportedUsd);
  }
}

/** Records the send-backs; delivery fails for agents set as unreachable. */
export class FakeSendBackChannel implements SendBackChannel {
  readonly sent: { swarmId: SwarmId; agent: string; message: string }[] = [];
  readonly unreachable = new Map<string, string>();

  async deliver(swarmId: SwarmId, agent: string, message: string): Promise<Delivery> {
    const why = this.unreachable.get(agent);
    if (why !== undefined) return { delivered: false, why };
    this.sent.push({ swarmId, agent, message });
    return { delivered: true };
  }
}

/** Merges by naming a commit per step; conflicts for the agents set as conflicting. */
export class FakeMerger implements Merger {
  readonly calls: Parameters<Merger['merge']>[0][] = [];
  readonly conflicting = new Set<string>();

  async merge(input: Parameters<Merger['merge']>[0]): Promise<MergeOutcome> {
    this.calls.push(input);
    const from = sha1Of(`target:${input.target}`);
    const conflicts = input.steps.filter((step) => this.conflicting.has(step.agent));
    if (conflicts.length > 0) return { ok: false, from, conflicts: [{ agents: conflicts.map((step) => step.agent), files: ['src/a.ts'] }], why: 'conflict' };
    const commits = input.steps.map((step) => ({ changesetId: step.changesetId, commit: sha1Of(`merged:${step.changesetId}`) }));
    return { ok: true, from, to: commits.at(-1)?.commit ?? from, commits };
  }
}

interface FactAgent {
  name: string;
  sessionId?: SessionId;
  workspace: 'worktree' | 'readonly' | 'scratch';
  state: ReviewSwarmView['agents'][number]['state'];
  stage: number;
  task: string;
  owns: string[];
}

/** Swarms, their agents and folders as the review manager reads them. */
export class InMemorySwarmFacts implements ReviewSwarmFacts {
  private readonly swarms = new Map<SwarmId, { goal: string; folderId: NodeId; callerSessionId?: SessionId; defaultTarget?: string; purpose?: SwarmPurpose; agents: FactAgent[] }>();
  private readonly parents = new Map<NodeId, NodeId | null>();

  addFolder(id: NodeId, parentId: NodeId | null = null): void {
    this.parents.set(id, parentId);
  }

  addSwarm(swarmId: SwarmId, input: { goal?: string; folderId: NodeId; callerSessionId?: SessionId; defaultTarget?: string; purpose?: SwarmPurpose }): void {
    if (!this.parents.has(input.folderId)) this.addFolder(input.folderId);
    this.swarms.set(swarmId, {
      goal: input.goal ?? 'contract goal',
      folderId: input.folderId,
      agents: [],
      ...(input.callerSessionId === undefined ? {} : { callerSessionId: input.callerSessionId }),
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      defaultTarget: input.defaultTarget ?? 'main',
    });
  }

  addAgent(swarmId: SwarmId, agent: Partial<FactAgent> & { name: string }): void {
    this.swarms.get(swarmId)!.agents.push({ workspace: 'worktree', state: 'done', stage: 0, task: `task of ${agent.name}`, owns: [], ...agent });
  }

  setState(swarmId: SwarmId, agent: string, state: FactAgent['state']): void {
    const found = this.swarms.get(swarmId)!.agents.find((candidate) => candidate.name === agent)!;
    found.state = state;
  }

  agentOf(sessionId: SessionId): ReturnType<ReviewSwarmFacts['agentOf']> {
    for (const [swarmId, swarm] of this.swarms) {
      const agent = swarm.agents.find((candidate) => candidate.sessionId === sessionId);
      if (agent !== undefined) return { swarmId, agent: agent.name, workspace: agent.workspace };
    }
    return undefined;
  }

  callerSessionOf(swarmId: SwarmId): SessionId | undefined {
    return this.swarms.get(swarmId)?.callerSessionId;
  }

  folderOf(swarmId: SwarmId): NodeId | undefined {
    return this.swarms.get(swarmId)?.folderId;
  }

  inScope(folderId: NodeId, scope: NodeId): boolean {
    for (let at: NodeId | null | undefined = folderId; at !== null && at !== undefined; at = this.parents.get(at)) if (at === scope) return true;
    return false;
  }

  swarm(swarmId: SwarmId): ReviewSwarmView | undefined {
    const swarm = this.swarms.get(swarmId);
    if (swarm === undefined) return undefined;
    return {
      goal: swarm.goal,
      ...(swarm.defaultTarget === undefined ? {} : { defaultTarget: swarm.defaultTarget }),
      repository: { path: '/repo', baseCommit: sha1Of('base') },
      ...(swarm.purpose === undefined ? {} : { purpose: swarm.purpose }),
      agents: swarm.agents.map(({ name, stage, workspace, state, task, owns }) => ({ name, stage, workspace, state, task, owns })),
    };
  }

  captureFacts(swarmId: SwarmId, agent: string): CaptureAgentFacts | undefined {
    const found = this.swarms.get(swarmId)?.agents.find((candidate) => candidate.name === agent);
    if (found === undefined) return undefined;
    return {
      sessionId: found.sessionId ?? `session-${agent}`,
      workspace: found.workspace,
      ...(found.workspace === 'worktree' ? { worktreePath: `/repo-worktrees/${swarmId}/${agent}` } : {}),
      tier: 'mid',
      resultText: `done ${agent}`,
      telemetry: { endState: found.state === 'running' ? 'running' : 'done', turns: 1, retries: 0, denials: 0, deniedTools: [], toolErrors: 0, spendUsd: 0, backgroundStopped: 0 },
    };
  }
}

