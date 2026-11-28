import { randomBytes, randomUUID } from 'node:crypto';
import { EventBus, type Unsubscribe } from '../../events/EventBus';
import { untrustedBlock } from '../../swarm/manager/inputs';
import { ENDED_RUN_STATES, type SwarmId } from '../../swarm/types';
import { anchorInFile, anchorOf } from '../anchors';
import { escapePath } from '../rules/classify';
import type { ReviewCommandInput } from '../commands';
import { REASON_CATALOGUE, type ReasonDefinition, type ReasonId } from '../reasonCatalogue';
import type { FailureSets } from '../reports/types';
import { computeRung, maxRung, reviewerTier, rungIndex, summaryHash, type RungDemotion } from '../rungs';
import {
  BLOCKING_SEVERITIES,
  seenScope,
  type ChangesetId,
  type ChangesetRecord,
  type ChangesetState,
  type CheckRecord,
  type CommentRecord,
  type DecisionActor,
  type DecisionRecord,
  type Hunk,
  type Reason,
  type ReportOutcomeInput,
  type ReviewAction,
  type ReviewReport,
  type ReviewRunRecord,
  type Rung,
  type RunFailure,
  type SeenMark,
  type StoredFinding,
} from '../schemas';
import { checkTransition } from '../stateMachine';
import {
  ReviewError,
  type CapturedChangeset,
  type CaptureService,
  type ChangesetDetail,
  type ChangesetStore,
  type ChangesetSummary,
  type CheckExecutor,
  type DemoteResult,
  type MergeGate,
  type MergeGateEntry,
  type Merger,
  type ReviewBudget,
  type ReviewCaller,
  type ReviewerEvent,
  type ReviewerRuntime,
  type ReviewEvent,
  type ReviewManager,
  type ReviewSwarmFacts,
  type RiskRules,
  type SendBackChannel,
  type SwarmMergeInput,
  type SwarmMergeResult,
  type TestRunStore,
} from '../types';
import { DEFAULT_CHECK_DECISION, type CheckDecisionSeam } from './checkDecision';

export interface InMemoryReviewManagerDeps {
  readonly store: ChangesetStore;
  readonly facts: ReviewSwarmFacts;
  readonly rules: RiskRules;
  readonly checks: CheckExecutor;
  readonly reviewer: ReviewerRuntime;
  readonly budget: ReviewBudget;
  readonly sendBack: SendBackChannel;
  readonly merger: Merger;
  /** ISO times; must increase between calls, since a demotion compares reason times with its own. */
  readonly clock?: () => string;
  /**
   * The repository snapshot of the capture service: compared before a reviewer starts and before a merge, and moved
   * for the target after the app's own merge (0040 sections 15.1 and 17). Without it neither check runs.
   */
  readonly repo?: Pick<CaptureService, 'compareRepo' | 'refreshRef'>;
  /** A changed repository or user-level Claude file kept a reviewer from starting: the app tells the user, who can accept the change. */
  readonly repositoryStopped?: (swarmId: SwarmId) => void;
  /** Where the failing cases of a checkpoint run are stored with its record (0045 section 4.4); without it the counts on the record are all that is kept. */
  readonly tests?: TestRunStore;
  /** The decisions after a check, which w-rules fills in (0045 section 3.3); the default keeps the behaviour of a check without reports. */
  readonly checkDecision?: CheckDecisionSeam;
}

/** The check reasons for which the reviewer never accepts: the check did not pass, or its result says nothing about the change. */
const CHECK_BLOCKS: readonly ReasonId[] = ['check.failed', 'check.base_red', 'check.timed_out', 'check.not_run', 'check.no_tests', 'check.report_missing', 'check.known_failures'];
const USER_DECIDES: readonly ChangesetState[] = ['in_review', 'queued_for_budget', 'awaiting_human'];
const CONFIRM_MS = 2 * 60_000;
const UNANCHORED_LIMIT = 3;
const STALE = 'the changeset changed since you looked';
const REPO_REASONS = new Set(['repo.armed', 'repo.ref_moved']);
const ACCEPTING: readonly ReviewAction[] = ['accept', 'auto_accept', 'report'];

const id = (prefix: string): string => `${prefix}_${randomBytes(8).toString('hex')}`;
const untrusted = (text: string) => ({ untrusted: true, text });

/** The text of a diff line by side and number, for quoting the commented line in a send-back. */
function lineText(hunk: Pick<Hunk, 'oldStart' | 'newStart' | 'body'>, side: 'old' | 'new', target: number): string | undefined {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const line of hunk.body.split('\n')) {
    const mark = line[0];
    if (mark !== '+' && mark !== '-' && mark !== ' ') continue;
    if ((side === 'new' && mark !== '-' && newLine === target) || (side === 'old' && mark !== '+' && oldLine === target)) return line.slice(1);
    if (mark !== '-') newLine += 1;
    if (mark !== '+') oldLine += 1;
  }
  return undefined;
}

function monotonicClock(): () => string {
  let last = 0;
  return () => {
    last = Math.max(Date.now(), last + 1);
    return new Date(last).toISOString();
  };
}

/**
 * The review manager without persistence (0040 sections 9 to 16, 0041): the pipeline from a capture through the
 * check, the rules and the reviewer, every actor's actions with the checks of 0040 section 11.3, seen marks, the
 * merge gate and the merge. Inbox items, the budget ledger, the swarm's `send` and git are behind the injected
 * services. Passes `describeReviewManagerContract`.
 */
export class InMemoryReviewManager implements ReviewManager {
  private readonly events = new EventBus<ReviewEvent>();
  protected readonly clock: () => string;
  private readonly outcomes = new Map<string, ReportOutcomeInput>();
  private readonly tokens = new Map<string, { changesetId: ChangesetId; toRung: Rung; contentHash: string; expiresAt: number }>();
  private readonly pending = new Set<Promise<void>>();
  /** Swarms whose merge runs, with its end: decisions on their changesets wait or are refused meanwhile. */
  private readonly merging = new Map<SwarmId, Promise<unknown>>();
  private readonly off: Unsubscribe;
  protected closed = false;
  private readonly checkDecision: CheckDecisionSeam;

  constructor(protected readonly deps: InMemoryReviewManagerDeps) {
    this.clock = deps.clock ?? monotonicClock();
    this.checkDecision = deps.checkDecision ?? DEFAULT_CHECK_DECISION;
    this.off = deps.reviewer.subscribe((event) => this.track(this.onReviewer(event)));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Capture and pipeline

  async submit(capture: CapturedChangeset): Promise<ChangesetRecord> {
    const { store } = this.deps;
    const { swarmId, agent } = capture.subject;
    // A capture would supersede a changeset the running merge is moving onto the target.
    await this.merging.get(swarmId)?.catch(() => undefined);
    if (store.policy(capture.policyHash) === undefined) throw new ReviewError('not_found', `no policy ${capture.policyHash}`);
    const previous = store.latest(swarmId, agent);
    const scope = seenScope(swarmId, agent);
    const outcome = this.outcomes.get(scope);
    this.outcomes.delete(scope);
    const now = this.clock();
    const sentBack = previous !== undefined && store.decisions(previous.id).some((decision) => decision.toState === 'sent_back');
    const requested = outcome?.requestRung === undefined ? [] : [this.agentRequested(outcome.requestRung, 'the agent asked for this rung in report_outcome')];
    const reasons = [...capture.reasons, ...requested];
    const firstReasons = reasons.map((reason) => ({ ...reason, changesetId: capture.id, createdAt: now }));
    const { rung, floor } = computeRung(firstReasons);
    const record: ChangesetRecord = {
      id: capture.id,
      swarmId,
      agent,
      sessionId: capture.sessionId,
      seq: (previous?.seq ?? 0) + 1,
      attempt: (previous?.attempt ?? 0) + (sentBack ? 1 : 0),
      trigger: capture.trigger,
      repoPath: capture.repoPath,
      commonDir: capture.commonDir,
      baseCommit: capture.baseCommit,
      headCommit: capture.headCommit,
      checkpointCommit: capture.checkpointCommit,
      checkpointTree: capture.checkpointTree,
      contentHash: capture.contentHash,
      policyHash: capture.policyHash,
      patchPath: capture.patchPath,
      fileCount: capture.files.length,
      added: capture.files.reduce((sum, file) => sum + file.added, 0),
      removed: capture.files.reduce((sum, file) => sum + file.removed, 0),
      workerTier: capture.workerTier,
      claim: outcome === undefined ? capture.claim : { source: 'report_outcome', ...outcome },
      telemetry: capture.telemetry,
      state: 'captured',
      rung,
      floor,
      supersedes: previous !== undefined && this.supersedable(previous) ? previous.id : null,
      mergedCommit: null,
      createdAt: now,
      updatedAt: now,
    };
    store.insert(
      record,
      capture.files.map((file) => ({ ...file, changesetId: capture.id })),
      capture.hunks.map((hunk) => ({ ...hunk, changesetId: capture.id })),
    );
    store.addReasons(capture.id, reasons, now);
    this.emitChanged(record);
    if (previous !== undefined && this.supersedable(previous)) await this.supersede(previous);
    this.track(this.pipeline(capture.id));
    return record;
  }

  private supersedable(changeset: ChangesetRecord): boolean {
    return changeset.state !== 'rejected' && changeset.state !== 'superseded' && changeset.mergedCommit === null;
  }

  private async supersede(changeset: ChangesetRecord): Promise<void> {
    this.move(changeset, 'supersede', 'app', 'superseded');
    await this.stopWork(changeset.id, 'superseded');
  }

  protected async stopWork(changesetId: ChangesetId, why: RunFailure): Promise<void> {
    for (const run of this.deps.store.runs(changesetId)) {
      if (run.state !== 'queued' && run.state !== 'running') continue;
      this.deps.store.putRun({ ...run, state: 'cancelled', failure: why, endedAt: this.clock() });
      await this.deps.reviewer.cancel(run.id, why);
    }
    await this.deps.checks.cancel(changesetId);
  }

  protected async pipeline(changesetId: ChangesetId): Promise<void> {
    const { store, checks, rules } = this.deps;
    let changeset = this.require(changesetId);
    const policy = store.policy(changeset.policyHash)!;
    let outcome: Awaited<ReturnType<CheckExecutor['run']>> | undefined;
    if (policy.effective.check !== undefined) {
      if (changeset.state !== 'checking') changeset = this.move(changeset, 'start_check', 'app', 'checking');
      const request = {
        changesetId,
        swarmId: changeset.swarmId,
        commonDir: changeset.commonDir,
        checkpointCommit: changeset.checkpointCommit,
        baseCommit: changeset.baseCommit,
        policyHash: changeset.policyHash,
        policy: policy.effective,
      };
      outcome = await checks.run(request);
      this.storeOutcome(outcome);
      // One repeat of the checkpoint run per changeset, also across a restart.
      if (!store.checks(changesetId).some((check) => check.rerunOf != null) && this.checkDecision.rerun({ changeset, outcome, policy: policy.effective })) {
        outcome = await checks.run({ ...request, rerunOf: outcome.checkpoint.id });
        this.storeOutcome(outcome);
      }
      changeset = this.require(changesetId);
      if (changeset.state !== 'checking') return;
    }
    const swarm = this.deps.facts.swarm(changeset.swarmId);
    const others = store.list({ swarmId: changeset.swarmId }).filter((other) => other.id !== changesetId);
    const swarmChangesets = others.filter((other) => other.agent !== changeset.agent && store.latest(other.swarmId, other.agent)?.id === other.id);
    const otherAgentsPaths = Object.fromEntries(
      swarmChangesets.filter((other) => other.state !== 'rejected').map((other) => [other.agent, [...new Set(store.files(other.id).flatMap((file) => [file.oldPath, file.newPath]).filter((path): path is string => path !== null))]]),
    );
    const reasons = rules.assess({
      changeset,
      files: store.files(changesetId),
      hunks: store.hunks(changesetId),
      policy,
      check: outcome,
      runChangesets: others.filter((other) => other.agent === changeset.agent && other.state !== 'rejected'),
      swarmChangesets,
      owns: swarm?.agents.find((agent) => agent.name === changeset.agent)?.owns ?? [],
      otherAgentsPaths,
      ...(swarm?.purpose === undefined ? {} : { swarmPurpose: swarm.purpose }),
    });
    store.addReasons(changesetId, reasons, this.clock());
    changeset = this.move(changeset, 'assess', 'app', 'assessed', { ...this.rungNow(changesetId) });
    await this.decide(changeset, outcome);
  }

  /** The step after the rules: accept at A, send back a failed check, or start the review. */
  protected async decide(changeset: ChangesetRecord, outcome: Awaited<ReturnType<CheckExecutor['run']>> | undefined): Promise<void> {
    const { store } = this.deps;
    const policy = store.policy(changeset.policyHash)!;
    const ids = new Set(store.reasons(changeset.id).map((reason) => reason.id));
    const decision = this.checkDecision.decide({ changeset, reasonIds: ids, outcome, policy: policy.effective, retryLimit: policy.effective.retryLimit });
    if (decision.kind === 'accept') {
      this.move(changeset, 'auto_accept', 'app', 'accepted');
      return;
    }
    if (decision.kind === 'send_back') {
      await this.sendToAgent(this.move(changeset, 'auto_send_back', 'app', 'sent_back'), decision.message);
      return;
    }
    await this.startReview(changeset);
  }

  private storeOutcome(outcome: Awaited<ReturnType<CheckExecutor['run']>>): void {
    const { store, tests } = this.deps;
    store.putCheck(outcome.checkpoint);
    if (tests !== undefined && outcome.testRun !== undefined && outcome.checkpoint.tests != null)
      tests.putTestRun(outcome.checkpoint.id, outcome.checkpoint.tests, outcome.testRun.failures, outcome.testRun.listPath, outcome.failures ?? null);
    // A base run that did not run says nothing about the base, and the store returns the latest row of the pair: it must not hide an earlier result.
    if (outcome.base !== undefined && outcome.base.outcome !== 'not_run') store.putCheck(outcome.base);
  }

  protected async startReview(changeset: ChangesetRecord): Promise<void> {
    const { store, budget, facts } = this.deps;
    const policy = store.policy(changeset.policyHash)!.effective;
    if (this.deps.repo !== undefined && (await this.repositoryStopsReviewer(changeset))) return;
    const runs = store.runs(changeset.id);
    const attempt = (runs.length + 1) as 1 | 2;
    const runId = id('run');
    const quote = budget.reserve(changeset.swarmId, runId, policy.reviewer.usdPerRun);
    if (!quote.ok) {
      store.addReasons(changeset.id, [this.reason('reviewer.skipped_budget', { why: quote.why }, {}, changeset.policyHash)], this.clock());
      if (changeset.state !== 'queued_for_budget') this.move(changeset, 'queue_budget', 'app', 'queued_for_budget', this.rungNow(changeset.id));
      return;
    }
    // The CLI takes only a UUID as --session-id.
    const sessionId = randomUUID();
    const tier = reviewerTier(policy.reviewer.tier, changeset.workerTier);
    const effort = changeset.rung === 'B' ? policy.reviewer.effortB : policy.reviewer.effortHuman;
    const run: ReviewRunRecord = {
      id: runId,
      changesetId: changeset.id,
      attempt,
      sessionId,
      model: tier,
      effort,
      promptVersion: null,
      state: 'running',
      failure: null,
      pid: null,
      reservedUsd: quote.usd,
      reportedUsd: 0,
      rejectedCalls: 0,
      queuedAt: this.clock(),
      startedAt: null,
      endedAt: null,
    };
    store.putRun(run);
    if (changeset.state !== 'in_review') changeset = this.move(changeset, 'start_review', 'app', 'in_review');
    const swarm = facts.swarm(changeset.swarmId);
    const check = store.checks(changeset.id).at(-1);
    const failures = this.failuresOf(changeset.id);
    try {
      await this.deps.reviewer.start({
        runId,
        changesetId: changeset.id,
        swarmId: changeset.swarmId,
        agent: changeset.agent,
        attempt,
        sessionId,
        folderId: facts.folderOf(changeset.swarmId),
        tier,
        effort,
        rung: changeset.rung,
        reservationUsd: quote.usd,
        maxTurns: policy.reviewer.maxTurns,
        timeoutMinutes: policy.reviewer.timeoutMinutes,
        commonDir: changeset.commonDir,
        baseCommit: changeset.baseCommit,
        checkpointCommit: changeset.checkpointCommit,
        task: swarm?.agents.find((agent) => agent.name === changeset.agent)?.task ?? '',
        files: store.files(changeset.id),
        hunks: store.hunks(changeset.id),
        ...(check === undefined ? {} : { check }),
        ...(failures === undefined ? {} : { failures }),
        reasons: store.reasons(changeset.id),
        claim: changeset.claim,
      });
    } catch {
      // The runtime reports a failed start as an `ended` event with `spawn`.
    }
  }

  /**
   * A changed repository configuration or user-level Claude file would reach the reviewer's process: the changeset
   * gets the reasons and goes to a person without a reviewer run (0040 section 17).
   */
  private async repositoryStopsReviewer(changeset: ChangesetRecord): Promise<boolean> {
    let found: readonly Reason[] = [];
    try {
      found = (await this.deps.repo?.compareRepo(changeset.swarmId)) ?? [];
    } catch (error) {
      // A swarm without a snapshot has nothing to compare; the reviewer starts as before.
      console.warn('review: repository comparison', error);
    }
    const stopping = found.filter((reason) => reason.id === 'repo.armed' || reason.id === 'reviewer.user_config_changed');
    if (stopping.length === 0) return false;
    const { store } = this.deps;
    store.addReasons(changeset.id, stopping, this.clock());
    let current = this.require(changeset.id);
    if (current.state === 'assessed' || current.state === 'queued_for_budget') current = this.move(current, 'start_review', 'app', 'in_review');
    if (current.state === 'in_review') this.move(current, 'review_failed', 'app', 'awaiting_human', this.rungNow(changeset.id));
    this.deps.repositoryStopped?.(changeset.swarmId);
    return true;
  }

  private async onReviewer(event: ReviewerEvent): Promise<void> {
    const { store, budget } = this.deps;
    const run = store.run(event.runId);
    if (run === undefined) return;
    if (event.type === 'started') {
      if (run.state === 'running') store.putRun({ ...run, startedAt: this.clock(), pid: event.pid ?? null, model: event.model || run.model, promptVersion: event.promptVersion ?? null });
      return;
    }
    budget.settle(run.id, event.costUsd);
    if (run.state !== 'running') {
      store.putRun({ ...run, reportedUsd: event.costUsd });
      return;
    }
    store.putRun({ ...run, state: 'failed', failure: event.failure ?? 'no-report', reportedUsd: event.costUsd, endedAt: this.clock() });
    await this.afterFailedRun(run);
  }

  /** A run ended without a report: one more run, or the human after the second (0040 section 10.5). */
  protected async afterFailedRun(run: ReviewRunRecord): Promise<void> {
    const { store } = this.deps;
    const changeset = this.require(run.changesetId);
    if (changeset.state !== 'in_review' || this.closed) return;
    if (run.attempt === 1) {
      await this.startReview(changeset);
      return;
    }
    const failures = store.runs(changeset.id).map((each) => ({ runId: each.id, failure: each.failure }));
    store.addReasons(changeset.id, [this.reason('reviewer.no_report', { runs: failures }, {}, changeset.policyHash)], this.clock());
    this.move(changeset, 'review_failed', 'app', 'awaiting_human', this.rungNow(changeset.id));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Reports

  async reportReview(input: ReviewCommandInput<'report_review'>, caller: ReviewCaller): Promise<{ readonly stored: true; readonly findings: number }> {
    const { store } = this.deps;
    if (caller.kind === 'ui') throw new ReviewError('out_of_scope', 'report_review is for the reviewer of a running review');
    const run = store.runBySession(caller.sessionId);
    if (run === undefined || run.changesetId !== input.changesetId) throw new ReviewError('out_of_scope', 'this session does not review that changeset');
    if (store.reports(run.changesetId).some((report) => report.runId === run.id)) throw new ReviewError('refused', 'already reported');
    if (run.state !== 'running') throw new ReviewError('out_of_scope', 'the review run has ended');
    const files = store.files(run.changesetId);
    const hunks = store.hunks(run.changesetId);
    const anchored: StoredFinding[] = [];
    const unanchored: string[] = [];
    let droppedBlocking = 0;
    input.findings.forEach((finding) => {
      const anchor = anchorOf(files, hunks, finding);
      if (anchor === undefined) {
        unanchored.push(`${finding.path}:${finding.line} (${finding.side})`);
        if (BLOCKING_SEVERITIES.includes(finding.severity)) droppedBlocking += 1;
      }
      else anchored.push({ idx: anchored.length, ...anchor, side: finding.side, line: finding.line, severity: finding.severity, title: finding.title, body: finding.body });
    });
    if (unanchored.length > 0 && run.rejectedCalls + 1 < UNANCHORED_LIMIT) {
      store.putRun({ ...run, rejectedCalls: run.rejectedCalls + 1 });
      throw new ReviewError('invalid_input', `These findings do not point at a line of the diff: ${unanchored.join(', ')}. Correct them and call report_review again.`);
    }
    const report: ReviewReport = {
      id: id('rep'),
      runId: run.id,
      changesetId: run.changesetId,
      verdict: input.verdict,
      escalateTo: input.escalateTo ?? null,
      claimCheck: input.claimCheck,
      summary: input.summary,
      findings: anchored,
      droppedFindings: unanchored.length,
      receivedAt: this.clock(),
    };
    store.putReport(report);
    store.putRun({ ...run, state: 'reported', endedAt: this.clock() });
    // A blocking finding that never pointed at the diff still blocks: the report goes to a person.
    if (droppedBlocking > 0) store.addReasons(report.changesetId, [this.reason('reviewer.findings', { droppedBlocking, reportId: report.id }, { subject: 'unanchored' }, this.require(report.changesetId).policyHash)], this.clock());
    this.applyReport(report);
    return { stored: true, findings: anchored.length };
  }

  protected applyReport(report: ReviewReport): void {
    const { store } = this.deps;
    const changeset = this.require(report.changesetId);
    const blocking = report.findings.filter((finding) => BLOCKING_SEVERITIES.includes(finding.severity));
    const droppedBlocking = store.reasons(report.changesetId).some((reason) => reason.id === 'reviewer.findings' && reason.subject === 'unanchored');
    const added: Reason[] = [];
    if (report.verdict === 'revise') added.push(this.reason('reviewer.revise', { reportId: report.id }, {}, changeset.policyHash));
    if (blocking.length > 0) added.push(this.reason('reviewer.findings', { findings: blocking.map((finding) => `${report.id}:${finding.idx}`) }, {}, changeset.policyHash));
    if (report.escalateTo !== null) added.push(this.reason('reviewer.escalated', { escalateTo: report.escalateTo }, { minRung: report.escalateTo }));
    if (report.claimCheck === 'contradicted') added.push(this.reason('reviewer.claim_contradicted', { reportId: report.id }, {}, changeset.policyHash));
    store.addReasons(changeset.id, added, this.clock());
    const rungs = this.rungNow(changeset.id);
    // A run is cancelled when its changeset leaves in_review, so a report reaches only an in_review changeset.
    if (changeset.state !== 'in_review') return;
    const policy = store.policy(changeset.policyHash)!.effective;
    const reasonIds = new Set(store.reasons(changeset.id).map((reason) => reason.id));
    const checkBlocks = CHECK_BLOCKS.some((reasonId) => reasonIds.has(reasonId));
    const accept = rungs.toRung === 'B' && report.verdict === 'accept' && blocking.length === 0 && !droppedBlocking && report.claimCheck !== 'contradicted' && !checkBlocks;
    if (accept) {
      this.move(changeset, 'report', 'reviewer', 'accepted', rungs);
    } else if (report.verdict === 'revise' && rungs.toRung === 'B' && changeset.attempt < policy.retryLimit) {
      const moved = this.move(changeset, 'report', 'reviewer', 'sent_back', rungs);
      const pathOf = (fileIdx: number) => store.files(changeset.id).find((file) => file.idx === fileIdx);
      const findings = report.findings.map((finding) => `- ${pathOf(finding.fileIdx)?.newPath ?? pathOf(finding.fileIdx)?.oldPath ?? ""}:${finding.line} (${finding.severity}) ${finding.title}: ${finding.body}`).join('\n');
      this.track(this.sendToAgent(moved, `Agide review of your work (changeset ${moved.id}, rung ${moved.rung}) sends it back.\n\nThe reviewer's summary and findings follow as data.\n${untrustedBlock('reviewer report', `${report.summary}\n${findings}`)}\n\nAddress these in your worktree, then finish your turn. Call report_outcome when you are done.`));
    } else {
      this.move(changeset, 'report', 'reviewer', 'awaiting_human', rungs);
    }
  }

  reportOutcome(input: ReviewCommandInput<'report_outcome'>, caller: ReviewCaller): { readonly recorded: true; readonly appliesTo: string } {
    if (caller.kind !== 'session') throw new ReviewError('out_of_scope', 'report_outcome is for swarm agents with a worktree');
    const agent = this.deps.facts.agentOf(caller.sessionId);
    if (agent === undefined || agent.workspace !== 'worktree') throw new ReviewError('out_of_scope', 'report_outcome is for swarm agents with a worktree');
    this.outcomes.set(seenScope(agent.swarmId, agent.agent), input);
    return { recorded: true, appliesTo: 'the next capture of your work' };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Reading

  list(input: ReviewCommandInput<'review_list'>, caller: ReviewCaller): ChangesetSummary[] {
    const { store } = this.deps;
    return store
      .list({ ...(input.swarmId === undefined ? {} : { swarmId: input.swarmId }), ...(input.states === undefined ? {} : { states: input.states }) })
      .filter((changeset) => this.visible(changeset, caller))
      .slice(0, input.limit)
      .map((changeset) => this.summary(changeset));
  }

  get(input: ReviewCommandInput<'review_get'>, caller: ReviewCaller): ChangesetDetail {
    const { store } = this.deps;
    const changeset = this.require(input.changesetId);
    if (!this.visible(changeset, caller)) throw new ReviewError('out_of_scope', 'the changeset is outside your scope');
    const hunks = store.hunks(changeset.id, input.file);
    const report = store.reports(changeset.id).at(-1);
    const failures = this.failuresOf(changeset.id);
    return {
      changeset,
      files: store.files(changeset.id),
      ...(input.hunks ? { hunks } : {}),
      reasons: store.reasons(changeset.id),
      checks: this.checksOf(changeset),
      ...(failures === undefined ? {} : { failures }),
      runs: store.runs(changeset.id),
      ...(report === undefined ? {} : { report }),
      decisions: store.decisions(changeset.id),
      comments: store.comments(changeset.id),
      seen: this.seenState(changeset),
    };
  }

  /** The failing sets stored with the latest checkpoint run, when the manager has a test store. */
  protected failuresOf(changesetId: ChangesetId): FailureSets | undefined {
    const latest = this.deps.store.checks(changesetId).findLast((check) => check.target === 'checkpoint');
    return latest === undefined ? undefined : this.deps.tests?.failureSets(latest.id);
  }

  /** The checkpoint runs of the changeset and the base run of its base commit and policy, which the card compares them with. */
  private checksOf(changeset: ChangesetRecord): CheckRecord[] {
    const base = this.deps.store.baseCheck(changeset.baseCommit, changeset.policyHash);
    return [...this.deps.store.checks(changeset.id), ...(base === undefined ? [] : [base])];
  }

  private visible(changeset: ChangesetRecord, caller: ReviewCaller): boolean {
    if (caller.kind === 'ui') return true;
    if (caller.kind === 'reviewer') return false;
    const agent = this.deps.facts.agentOf(caller.sessionId);
    if (agent !== undefined) return agent.swarmId === changeset.swarmId && agent.agent === changeset.agent;
    const folder = this.deps.facts.folderOf(changeset.swarmId);
    return folder !== undefined && this.deps.facts.inScope(folder, caller.folderId);
  }

  private summary(changeset: ChangesetRecord): ChangesetSummary {
    const { store } = this.deps;
    const check = store.checks(changeset.id).at(-1);
    const report = store.reports(changeset.id).at(-1);
    return {
      id: changeset.id,
      swarmId: changeset.swarmId,
      agent: changeset.agent,
      seq: changeset.seq,
      state: changeset.state,
      rung: changeset.rung,
      floor: changeset.floor,
      reasonCount: store.reasons(changeset.id).length,
      ...(check === undefined ? {} : { checkOutcome: check.outcome }),
      ...(report === undefined ? {} : { verdict: report.verdict }),
      fileCount: changeset.fileCount,
      added: changeset.added,
      removed: changeset.removed,
      contentHash: changeset.contentHash,
      merged: changeset.mergedCommit !== null,
      createdAt: changeset.createdAt,
      updatedAt: changeset.updatedAt,
    };
  }

  private summaryHashOf(changeset: ChangesetRecord): string {
    const { store } = this.deps;
    return summaryHash(changeset.contentHash, changeset.rung, store.reasons(changeset.id).map((reason) => reason.id), store.reports(changeset.id).at(-1)?.id);
  }

  private seenState(changeset: ChangesetRecord): ChangesetDetail['seen'] {
    const { store } = this.deps;
    const marks = store.seen(seenScope(changeset.swarmId, changeset.agent));
    const has = (level: SeenMark['level'], hash: string) => marks.some((mark) => mark.level === level && mark.subjectHash === hash);
    const hunks = store.hunks(changeset.id);
    const summary = this.summaryHashOf(changeset);
    return {
      summaryHash: summary,
      summary: has('summary', summary),
      files: store.files(changeset.id).map((file) => {
        const own = hunks.filter((hunk) => hunk.fileIdx === file.idx);
        const unseenHunks = own.filter((hunk) => !has('hunk', hunk.hunkHash)).length;
        return { idx: file.idx, seen: own.length === 0 ? has('file', file.fileHash) : unseenHunks === 0, unseenHunks };
      }),
      hunks: hunks.filter((hunk) => has('hunk', hunk.hunkHash)).map((hunk) => hunk.hunkHash),
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // The user's decisions

  async accept(input: ReviewCommandInput<'review_accept'>, caller: ReviewCaller): Promise<ChangesetRecord> {
    this.requireUser(caller);
    const changeset = this.require(input.changesetId);
    if (changeset.contentHash !== input.expectedHash || changeset.rung !== input.expectedRung) throw new ReviewError('refused', STALE);
    const { store } = this.deps;
    if (rungIndex(changeset.rung) >= rungIndex('B') && store.reports(changeset.id).length === 0 && !input.withoutReviewer)
      throw new ReviewError('refused', 'the reviewer has not reported; tick "accept without the reviewer" to accept anyway');
    const seen = this.seenState(changeset);
    const seenHunks = new Set(seen.hunks);
    const hunks = store.hunks(changeset.id);
    const files = store.files(changeset.id);
    if (changeset.rung === 'D') {
      // Rules store the path escaped, so a name with control or bidirectional characters is compared escaped too.
      const flaggedPaths = new Set(store.reasons(changeset.id).map((reason) => reason.subject).filter((subject) => subject !== ''));
      const flagged = (path: string | null): boolean => path !== null && (flaggedPaths.has(path) || flaggedPaths.has(escapePath(path)));
      const flaggedFiles = new Set(files.filter((file) => flagged(file.newPath) || flagged(file.oldPath)).map((file) => file.idx));
      const findingHunks = new Set(store.reports(changeset.id).flatMap((report) => report.findings.map((finding) => finding.hunkHash)));
      const unseen = hunks.filter((hunk) => (flaggedFiles.has(hunk.fileIdx) || findingHunks.has(hunk.hunkHash)) && !seenHunks.has(hunk.hunkHash));
      if (unseen.length > 0) throw new ReviewError('refused', `look at every flagged hunk first; ${unseen.length} not seen`);
      // Nothing points at a hunk when the rung came from an escalation: then the summary or every hunk must be seen.
      const pointsAtNothing = flaggedFiles.size === 0 && findingHunks.size === 0;
      if (pointsAtNothing && !seen.summary && hunks.some((hunk) => !seenHunks.has(hunk.hunkHash))) throw new ReviewError('refused', 'look at the summary or every hunk first');
    }
    if (changeset.rung === 'E') {
      const unseenFiles = seen.files.filter((file) => !file.seen);
      if (unseenFiles.length > 0) throw new ReviewError('refused', `look at every hunk and file first; ${unseenFiles.length} files not seen`);
    }
    const note = input.withoutReviewer ? `accepted without the reviewer${input.note === undefined ? '' : `: ${input.note}`}` : (input.note ?? null);
    const accepted = this.move(changeset, 'accept', 'user', 'accepted', { reason: note });
    await this.stopWork(changeset.id, 'user');
    return accepted;
  }

  async reject(input: ReviewCommandInput<'review_reject'>, caller: ReviewCaller): Promise<ChangesetRecord> {
    this.requireUser(caller);
    const changeset = this.require(input.changesetId);
    if (changeset.contentHash !== input.expectedHash) throw new ReviewError('refused', STALE);
    const rejected = this.move(changeset, 'reject', 'user', 'rejected', { reason: input.reason });
    await this.stopWork(changeset.id, 'user');
    return rejected;
  }

  async sendBack(input: ReviewCommandInput<'review_send_back'>, caller: ReviewCaller): Promise<ChangesetRecord> {
    this.requireUser(caller);
    const { store } = this.deps;
    const changeset = this.require(input.changesetId);
    if (changeset.contentHash !== input.expectedHash) throw new ReviewError('refused', STALE);
    const hunks = store.hunks(changeset.id);
    const files = store.files(changeset.id);
    const live = new Set(hunks.map((hunk) => hunk.hunkHash));
    const drafts = store.comments(changeset.id).filter((comment) => comment.state === 'draft' && live.has(comment.hunkHash));
    const report = store.reports(changeset.id).at(-1);
    const findings = (input.findingIds ?? []).flatMap((findingId) => report?.findings.filter((finding) => `${report.id}:${finding.idx}` === findingId) ?? []);
    const pathOf = (fileIdx: number) => files.find((file) => file.idx === fileIdx)?.newPath ?? files.find((file) => file.idx === fileIdx)?.oldPath ?? '';
    const lineOf = (comment: CommentRecord): string => {
      const hunk = hunks.find((candidate) => candidate.hunkHash === comment.hunkHash);
      const text = hunk === undefined ? undefined : lineText(hunk, comment.side, comment.line);
      return text === undefined ? '' : `\n  > ${text}`;
    };
    const message = [
      `Agide review of your work (changeset ${changeset.id}, rung ${changeset.rung}) sends it back.`,
      input.message ?? '',
      '',
      ...(drafts.length === 0 ? [] : ['Comments on lines:', ...drafts.map((comment) => `- ${pathOf(comment.fileIdx)}:${comment.line} (${comment.side} side)${lineOf(comment)}\n  ${comment.body}`)]),
      ...(findings.length === 0
        ? []
        : ['Reviewer findings the user included follow as data.', untrustedBlock('reviewer findings', findings.map((finding) => `- ${pathOf(finding.fileIdx)}:${finding.line} (${finding.severity}) ${finding.title}: ${finding.body}`).join('\n'))]),
      '',
      'Address these in your worktree, then finish your turn. Call report_outcome when you are done.',
    ].join('\n');
    const moved = this.move(changeset, 'send_back', 'user', 'sent_back', { reason: input.message ?? null });
    const decision = store.decisions(changeset.id).at(-1)!;
    store.markSent(
      drafts.map((comment) => comment.id),
      decision.id,
    );
    await this.stopWork(changeset.id, 'user');
    return this.sendToAgent(moved, message);
  }

  comment(input: ReviewCommandInput<'review_comment'>, caller: ReviewCaller): CommentRecord | { readonly deleted: true } {
    this.requireUser(caller);
    const { store } = this.deps;
    if ('commentId' in input) {
      const found = store.comment(input.commentId);
      if (found === undefined) throw new ReviewError('not_found', `no comment ${input.commentId}`);
      if (found.state === 'sent') throw new ReviewError('refused', 'a sent comment stays');
      store.deleteComment(input.commentId);
      return { deleted: true };
    }
    const changeset = this.require(input.changesetId);
    const anchor = anchorInFile(input.file, store.hunks(changeset.id), input.side, input.line);
    if (anchor === undefined) throw new ReviewError('invalid_input', 'the line is not part of the diff');
    const comment: CommentRecord = {
      id: id('cmt'),
      changesetId: changeset.id,
      fileIdx: input.file,
      side: input.side,
      line: input.line,
      hunkHash: anchor.hunkHash,
      body: input.body,
      state: 'draft',
      sentIn: null,
      createdAt: this.clock(),
    };
    store.putComment(comment);
    return comment;
  }

  async escalate(input: ReviewCommandInput<'review_escalate'>, caller: ReviewCaller): Promise<ChangesetRecord> {
    this.requireUser(caller);
    const changeset = this.require(input.changesetId);
    if (rungIndex(input.toRung) <= rungIndex(changeset.rung)) throw new ReviewError('refused', `the changeset is already at rung ${changeset.rung}`);
    this.deps.store.addReasons(changeset.id, [this.reason('user.escalated', input.reason === undefined ? {} : { reason: input.reason }, { minRung: input.toRung, subject: `to:${input.toRung}@${this.clock()}` })], this.clock());
    return this.raiseInPlace(changeset, 'escalate', 'user', input.reason ?? null);
  }

  async requestEscalation(input: ReviewCommandInput<'review_request_escalation'>, caller: ReviewCaller): Promise<ChangesetRecord> {
    if (caller.kind !== 'session') throw new ReviewError('out_of_scope', 'review_request_escalation is for the working agent and the swarm caller');
    const changeset = this.require(input.changesetId);
    const agent = this.deps.facts.agentOf(caller.sessionId);
    const own = agent !== undefined && agent.swarmId === changeset.swarmId && agent.agent === changeset.agent;
    const starter = agent === undefined && this.deps.facts.callerSessionOf(changeset.swarmId) === caller.sessionId;
    if (!own && !starter) throw new ReviewError('out_of_scope', 'only the working agent or the session that started the swarm asks for escalation');
    if (!this.supersedable(changeset)) throw new ReviewError('refused', 'the changeset is final');
    if (rungIndex(input.toRung) <= rungIndex(changeset.rung)) throw new ReviewError('refused', `the changeset is already at rung ${changeset.rung}`);
    const added = this.deps.store.addReasons(
      changeset.id,
      [this.agentRequested(input.toRung, input.reason)],
      this.clock(),
    );
    if (added.length === 0) return changeset;
    return this.raiseInPlace(changeset, 'request_escalation', 'agent', input.reason, caller.sessionId);
  }

  private agentRequested(toRung: Rung, reason: string): Reason {
    return this.reason('agent.requested', { reason: untrusted(reason) }, { minRung: toRung, subject: `request:${toRung}` });
  }

  /**
   * The agent ended after a send-back and its work tree gave no new capture (nothing changed, or the capture failed):
   * the changeset goes to a person with the reason, since nothing else would move it.
   */
  async noNewCapture(swarmId: SwarmId, agent: string, why: string): Promise<ChangesetRecord | undefined> {
    const latest = this.deps.store.latest(swarmId, agent);
    if (latest === undefined || latest.state !== 'sent_back') return undefined;
    return this.move(latest, 'no_new_capture', 'app', 'awaiting_human', { reason: why });
  }

  async demote(input: ReviewCommandInput<'review_demote'>, caller: ReviewCaller): Promise<DemoteResult> {
    this.requireUser(caller);
    const changeset = this.require(input.changesetId);
    if (!USER_DECIDES.includes(changeset.state)) throw new ReviewError('refused', `a ${changeset.state} changeset is not demoted`);
    if (rungIndex(input.toRung) >= rungIndex(changeset.rung)) throw new ReviewError('refused', 'a demotion lowers the rung');
    const belowFloor = rungIndex(input.toRung) < rungIndex(changeset.floor);
    if (belowFloor) {
      if (input.confirmToken === undefined) {
        const confirmToken = randomBytes(16).toString('hex');
        const expiresAt = Date.now() + CONFIRM_MS;
        this.tokens.set(confirmToken, { changesetId: changeset.id, toRung: input.toRung, contentHash: changeset.contentHash, expiresAt });
        return { committed: false, confirmToken, expiresAt: new Date(expiresAt).toISOString() };
      }
      const token = this.tokens.get(input.confirmToken);
      this.tokens.delete(input.confirmToken);
      if (token === undefined || token.changesetId !== changeset.id || token.toRung !== input.toRung || token.contentHash !== changeset.contentHash || token.expiresAt < Date.now())
        throw new ReviewError('refused', 'the confirmation does not match; ask again');
    }
    const floor = belowFloor ? input.toRung : changeset.floor;
    const moved = this.move(changeset, 'demote', 'user', changeset.state, { toRung: input.toRung, floor, reason: input.reason, floorConfirmed: belowFloor });
    return { committed: true, changeset: moved };
  }

  seen(input: ReviewCommandInput<'review_seen'>, caller: ReviewCaller): SeenMark {
    this.requireUser(caller);
    const { store } = this.deps;
    const changeset = this.require(input.changesetId);
    let subjectHash: string;
    if (input.level === 'summary') subjectHash = this.summaryHashOf(changeset);
    else if (input.level === 'file') {
      const file = store.files(changeset.id).find((candidate) => candidate.idx === input.file);
      if (file === undefined) throw new ReviewError('not_found', `no file ${input.file}`);
      if (store.hunks(changeset.id, file.idx).length > 0) throw new ReviewError('invalid_input', 'a file with hunks is seen through its hunks');
      subjectHash = file.fileHash;
    } else {
      const hunk = store.hunks(changeset.id, input.file).find((candidate) => candidate.idx === input.hunk);
      if (hunk === undefined) throw new ReviewError('not_found', `no hunk ${input.file}/${input.hunk}`);
      subjectHash = hunk.hunkHash;
    }
    const mark: SeenMark = { scope: seenScope(changeset.swarmId, changeset.agent), level: input.level, subjectHash, changesetId: changeset.id, how: input.how, seenAt: this.clock() };
    store.putSeen(mark);
    this.events.emit({ type: 'review.seen', changesetId: changeset.id, level: input.level });
    return mark;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Merge

  mergeGate(swarmId: SwarmId, exclude: readonly string[] = []): MergeGate {
    const { store, facts } = this.deps;
    const swarm = facts.swarm(swarmId);
    if (swarm === undefined) throw new ReviewError('not_found', `no swarm ${swarmId}`);
    const entries: MergeGateEntry[] = swarm.agents
      .filter((agent) => agent.workspace === 'worktree')
      .map((agent) => {
        const latest = store.latest(swarmId, agent.name);
        const base = latest === undefined ? { agent: agent.name } : { agent: agent.name, changesetId: latest.id };
        if (!ENDED_RUN_STATES.includes(agent.state)) return { ...base, ok: false, why: 'the agent has not ended' };
        if (latest === undefined) return { ...base, ok: true };
        const repoReason = store.reasons(latest.id).find((reason) => REPO_REASONS.has(reason.id));
        if (repoReason !== undefined && !(latest.state === 'accepted' && this.lastAccept(latest)?.actor === 'user' && latest.rung === 'E'))
          return { ...base, ok: false, why: `${repoReason.id} is open; accept it at rung E first` };
        if (latest.state === 'rejected' && exclude.includes(agent.name)) return { ...base, ok: true };
        if (latest.state !== 'accepted') return { ...base, ok: false, why: `the latest changeset is ${latest.state}` };
        const lastAccept = this.lastAccept(latest);
        if (lastAccept === undefined || lastAccept.toRung !== latest.rung || lastAccept.contentHash !== latest.contentHash)
          return { ...base, ok: false, why: 'it was accepted at a lower rung or on other content' };
        return { ...base, ok: true };
      });
    return { open: entries.every((entry) => entry.ok), agents: entries };
  }

  private lastAccept(changeset: ChangesetRecord): DecisionRecord | undefined {
    return this.deps.store
      .decisions(changeset.id)
      .filter((decision) => decision.toState === 'accepted' && ACCEPTING.includes(decision.action))
      .at(-1);
  }

  async merge(input: SwarmMergeInput, caller: ReviewCaller): Promise<SwarmMergeResult> {
    const { facts } = this.deps;
    if (caller.kind === 'reviewer') throw new ReviewError('out_of_scope', 'reviewers never merge');
    if (caller.kind === 'session' && (facts.agentOf(caller.sessionId) !== undefined || facts.callerSessionOf(input.swarmId) !== caller.sessionId))
      throw new ReviewError('out_of_scope', 'only the user or the session that started the swarm merges it');
    const swarm = facts.swarm(input.swarmId);
    if (swarm === undefined) throw new ReviewError('not_found', `no swarm ${input.swarmId}`);
    const target = input.target ?? swarm.defaultTarget;
    if (target === undefined) throw new ReviewError('invalid_input', 'name a target branch');
    if (target.startsWith('agide/')) throw new ReviewError('refused', 'an agent branch is never a merge target');
    if (this.merging.has(input.swarmId)) throw new ReviewError('refused', 'a merge of this swarm is already running');
    // The hold starts before the gate is read, so no decision slips in between the gate and the ref move.
    let ended: () => void = () => undefined;
    if (!input.dryRun)
      this.merging.set(
        input.swarmId,
        new Promise<void>((resolve) => (ended = resolve)),
      );
    try {
      const gate = this.mergeGate(input.swarmId, input.exclude);
      const repoReasons = ((await this.deps.repo?.compareRepo(input.swarmId)) ?? []).filter((reason) => REPO_REASONS.has(reason.id));
      if (!gate.open || repoReasons.length > 0) {
        const refused = [
          ...gate.agents.filter((entry) => !entry.ok).map((entry) => ({ agent: entry.agent, why: entry.why ?? 'blocked' })),
          ...repoReasons.map((reason) => ({ why: `${reason.id}: the repository changed outside the agents' worktrees since the swarm started` })),
        ];
        throw new ReviewError('refused', 'the merge gate is closed', { refused });
      }
      return await this.mergeSteps(input, swarm, target, caller);
    } finally {
      if (!input.dryRun) {
        this.merging.delete(input.swarmId);
        ended();
      }
    }
  }

  /** The git steps and the merge decisions; while they run no person or agent decides on the swarm's changesets. */
  private async mergeSteps(input: SwarmMergeInput, swarm: NonNullable<ReturnType<ReviewSwarmFacts['swarm']>>, target: string, caller: ReviewCaller): Promise<SwarmMergeResult> {
    const { store, merger } = this.deps;
    const order = [...swarm.agents].map((agent, position) => ({ agent, position })).sort((a, b) => a.agent.stage - b.agent.stage || a.position - b.position);
    const steps = order
      .filter(({ agent }) => agent.workspace === 'worktree' && !input.exclude.includes(agent.name))
      .map(({ agent }) => store.latest(input.swarmId, agent.name))
      .filter((latest): latest is ChangesetRecord => latest !== undefined && latest.state === 'accepted' && latest.mergedCommit === null)
      .map((latest) => ({ agent: latest.agent, changesetId: latest.id, baseCommit: latest.baseCommit, checkpointCommit: latest.checkpointCommit, checkpointTree: latest.checkpointTree, patchPath: latest.patchPath }));
    if (steps.length === 0) throw new ReviewError('refused', 'nothing accepted is waiting to be merged');
    const first = store.get(steps[0]!.changesetId)!;
    const outcome = await merger.merge({ repoPath: first.repoPath, commonDir: first.commonDir, target, goal: swarm.goal, steps, dryRun: input.dryRun });
    if (!outcome.ok) return { target, from: outcome.from, merged: [], refused: [{ why: outcome.why }], ...(outcome.conflicts === undefined ? {} : { conflicts: outcome.conflicts }) };
    const merged = outcome.commits.map((commit) => ({ agent: steps.find((step) => step.changesetId === commit.changesetId)!.agent, changesetId: commit.changesetId, commit: commit.commit }));
    if (input.dryRun) return { target, from: outcome.from, to: outcome.to, merged };
    for (const step of merged) {
      const changeset = this.require(step.changesetId);
      this.move(changeset, 'merge', 'app', 'accepted', { mergedCommit: step.commit, ...(caller.kind === 'session' ? { actorSessionId: caller.sessionId } : {}) });
    }
    await this.deps.repo?.refreshRef(input.swarmId, `refs/heads/${target}`, outcome.from, outcome.to);
    return { target, from: outcome.from, to: outcome.to, merged };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Lifecycle

  subscribe(listener: (event: ReviewEvent) => void): Unsubscribe {
    return this.events.onAny(listener);
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const changeset of this.deps.store.list({ states: ['checking', 'in_review'] })) await this.stopWork(changeset.id, 'app-exit');
    await Promise.allSettled([...this.pending]);
    this.off();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Helpers

  protected track(work: Promise<unknown>): void {
    const done: Promise<void> = work.then(
      () => undefined,
      (error: unknown) => {
        if (!this.closed) console.error('review pipeline', error);
      },
    );
    this.pending.add(done);
    void done.finally(() => this.pending.delete(done));
  }

  protected require(changesetId: ChangesetId): ChangesetRecord {
    const found = this.deps.store.get(changesetId);
    if (found === undefined) throw new ReviewError('not_found', `no changeset ${changesetId}`);
    return found;
  }

  private requireUser(caller: ReviewCaller): void {
    if (caller.kind !== 'ui') throw new ReviewError('out_of_scope', 'agents never decide reviews');
  }

  /** A catalogue reason; with `policyHash`, the policy's `rungs` entry for the id applies, and a hard reason only rises (0040 section 7.2). */
  private reason(reasonId: ReasonId, evidence: Record<string, unknown>, patch: Partial<Reason> = {}, policyHash?: string): Reason {
    const definition: ReasonDefinition = REASON_CATALOGUE[reasonId];
    const set = policyHash === undefined || definition.variable === true ? undefined : this.deps.store.policy(policyHash)?.effective.rungs[reasonId];
    const minRung = set === undefined ? definition.rung : definition.hard ? maxRung(set, definition.rung) : set;
    return { id: reasonId, subject: '', source: definition.source, evidence, minRung, hard: definition.hard, ...patch };
  }

  protected rungNow(changesetId: ChangesetId): { toRung: Rung; floor: Rung } {
    const { rung, floor } = computeRung(this.deps.store.reasons(changesetId), this.demotionOf(changesetId));
    return { toRung: rung, floor };
  }

  /** The latest demotion, read from its decision row so it holds after a restart; the floor is the changeset's, which a later hard reason only raises. */
  private demotionOf(changesetId: ChangesetId): RungDemotion | undefined {
    const { store } = this.deps;
    const decision = store.decisions(changesetId).findLast((candidate) => candidate.action === 'demote');
    const changeset = store.get(changesetId);
    return decision === undefined || changeset === undefined ? undefined : { toRung: decision.toRung, floor: changeset.floor, at: decision.createdAt };
  }

  /** Applies the reasons added so far as a rung change in the same state, then reopens an accept the raise outdated. */
  private raiseInPlace(changeset: ChangesetRecord, action: 'escalate' | 'request_escalation', actor: DecisionActor, reason: string | null = null, actorSessionId?: string): ChangesetRecord {
    const rungs = this.rungNow(changeset.id);
    if (rungs.toRung === changeset.rung) return changeset;
    let moved = this.move(changeset, action, actor, changeset.state, { ...rungs, reason, ...(actorSessionId === undefined ? {} : { actorSessionId }) });
    if (moved.state === 'accepted' && moved.mergedCommit === null) moved = this.move(moved, 'reopen', 'app', 'awaiting_human');
    return moved;
  }

  private async sendToAgent(changeset: ChangesetRecord, message: string): Promise<ChangesetRecord> {
    const delivery = await this.deps.sendBack.deliver(changeset.swarmId, changeset.agent, message);
    if (delivery.delivered) return changeset;
    const current = this.require(changeset.id);
    if (current.state !== 'sent_back') return current;
    return this.move(current, 'undeliverable', 'app', 'awaiting_human', { reason: delivery.why });
  }

  protected move(
    changeset: ChangesetRecord,
    action: ReviewAction,
    actor: DecisionActor,
    to: ChangesetState,
    options: { toRung?: Rung; floor?: Rung; reason?: string | null; actorSessionId?: string; floorConfirmed?: boolean; mergedCommit?: string } = {},
  ): ChangesetRecord {
    if (this.merging.has(changeset.swarmId) && (actor === 'user' || actor === 'agent')) throw new ReviewError('refused', 'a merge of this swarm is running; decide again when it has ended');
    const toRung = options.toRung ?? changeset.rung;
    const floor = options.floor ?? changeset.floor;
    const verdict = checkTransition({
      action,
      actor,
      from: changeset.state,
      to,
      fromRung: changeset.rung,
      toRung,
      floor: changeset.floor,
      merged: changeset.mergedCommit !== null,
      ...(options.floorConfirmed === undefined ? {} : { floorConfirmed: options.floorConfirmed }),
    });
    if (!verdict.ok) throw new ReviewError('refused', verdict.why);
    const decision: DecisionRecord = {
      id: id('dec'),
      changesetId: changeset.id,
      actor,
      actorSessionId: options.actorSessionId ?? null,
      action,
      fromState: changeset.state,
      toState: to,
      fromRung: changeset.rung,
      toRung,
      contentHash: changeset.contentHash,
      reason: options.reason ?? null,
      createdAt: this.clock(),
    };
    const updated = this.deps.store.applyDecision(decision, { state: to, rung: toRung, floor, ...(options.mergedCommit === undefined ? {} : { mergedCommit: options.mergedCommit }) });
    if (updated === undefined) throw new ReviewError('refused', 'the changeset changed meanwhile');
    this.emitChanged(updated);
    return updated;
  }

  private emitChanged(changeset: ChangesetRecord): void {
    this.events.emit({ type: 'review.changed', changesetId: changeset.id, swarmId: changeset.swarmId, agent: changeset.agent, state: changeset.state, rung: changeset.rung });
  }
}
