import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import type { Effort, Tier, Workspace } from '../swarm/definition';
import type { AgentRunState, SwarmId } from '../swarm/types';
import type { TurnResult } from '../swarm/runtime/types';
import type { NodeId } from '../tree/types';
import type { ReviewCommandInput } from './commands';
import type { ReviewPolicy, UserPolicy } from './policy/schema';
import type {
  CaptureSubject,
  CaptureTrigger,
  ChangesetFile,
  ChangesetId,
  ChangesetRecord,
  ChangesetState,
  CheckRecord,
  Claim,
  CommentRecord,
  DecisionRecord,
  Hunk,
  PolicySnapshot,
  Reason,
  ReviewReport,
  ReviewRunRecord,
  Rung,
  RunFailure,
  SeenLevel,
  SeenMark,
  StoredReason,
  Telemetry,
} from './schemas';

/** Service interfaces of the review ladder (0040 section 18.1, 0041). */

export type ReviewErrorCode = 'invalid_input' | 'not_found' | 'out_of_scope' | 'limit_reached' | 'refused' | 'failed';

/** Maps onto `CommandErrorCode` with the same names. */
export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Callers

/**
 * Who calls the review manager. The review module derives it from the command `Caller`: a session's swarm agent
 * and reviewer run come from the swarm manager and the review runs. `reviewer` is a session of a running review run.
 */
export type ReviewCaller =
  | { readonly kind: 'ui' }
  | { readonly kind: 'session'; readonly sessionId: SessionId; readonly folderId: NodeId }
  | { readonly kind: 'reviewer'; readonly sessionId: SessionId };

/** What the review manager reads from the swarm manager. */
export interface ReviewSwarmFacts {
  /** The swarm agent a session is, if it is one. */
  agentOf(sessionId: SessionId): { readonly swarmId: SwarmId; readonly agent: string; readonly workspace: Workspace } | undefined;
  /** The session that started the swarm; absent when the user did. */
  callerSessionOf(swarmId: SwarmId): SessionId | undefined;
  /** The swarm's folder, for the folder scope of a session caller and the reviewer's grant. */
  folderOf(swarmId: SwarmId): NodeId | undefined;
  /** True when `folderId` is `scope` or below it. */
  inScope(folderId: NodeId, scope: NodeId): boolean;
  /** The swarm's goal and agents as the review needs them; undefined for an unknown swarm. */
  swarm(swarmId: SwarmId): ReviewSwarmView | undefined;
  /** What a capture of the agent reads; undefined for an unknown agent. */
  captureFacts(swarmId: SwarmId, agent: string): CaptureAgentFacts | undefined;
}

export interface ReviewSwarmView {
  /** User text. */
  readonly goal: string;
  /** `definition.repository.base` when it names a local branch: the default merge target. */
  readonly defaultTarget?: string;
  /** The user's repository and the base commit the swarm started from; absent for a swarm without a repository. */
  readonly repository?: { readonly path: string; readonly baseCommit: string };
  /** In definition order, which is the merge order within a stage. */
  readonly agents: readonly {
    readonly name: string;
    readonly stage: number;
    readonly workspace: Workspace;
    readonly state: AgentRunState;
    /** The agent's prompt, user text: the task the reviewer checks against. */
    readonly task: string;
    readonly owns: readonly string[];
  }[];
}

/** What a capture reads about one agent run (0040 sections 4.2 and 7.2); w-manager supplies it from the swarm manager. */
export interface CaptureAgentFacts {
  readonly sessionId: SessionId;
  readonly workspace: Workspace;
  /** The agent's worktree; absent for a readonly or scratch agent. */
  readonly worktreePath?: string;
  readonly tier: Tier;
  /** The latest `result` text of the run, agent text: the claim when no `report_outcome` came. */
  readonly resultText?: string;
  readonly telemetry: Telemetry;
}

// ---------------------------------------------------------------------------------------------------------------
// Capture (w-capture)

/** What the capture service hands the manager: a stored checkpoint with its files and hunks (0040 section 4.2). */
export interface CapturedChangeset {
  readonly id: ChangesetId;
  readonly subject: CaptureSubject;
  readonly sessionId: SessionId;
  readonly trigger: CaptureTrigger;
  readonly repoPath: string;
  readonly commonDir: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly checkpointCommit: string;
  readonly checkpointTree: string;
  readonly contentHash: string;
  readonly policyHash: string;
  readonly patchPath: string;
  readonly workerTier: Tier;
  /** The result text claim; the manager replaces it with the agent's latest `report_outcome` since the previous capture. */
  readonly claim: Claim | null;
  readonly telemetry: Telemetry;
  /** Files and hunks without `changesetId`; the store fills it in. */
  readonly files: readonly Omit<ChangesetFile, 'changesetId'>[];
  readonly hunks: readonly Omit<Hunk, 'changesetId'>[];
  /** Reasons the capture itself found (`repo.armed`, `repo.ref_moved`, `run.background_stopped`, `policy.base_differs`). */
  readonly reasons: readonly Reason[];
}

export type CaptureResult =
  | { readonly kind: 'captured'; readonly changeset: CapturedChangeset }
  | { readonly kind: 'no-change' }
  /** `reasons` holds `repo.armed` when a changed repository stopped the capture, so the manager posts the `high` alert. */
  | { readonly kind: 'failed'; readonly subject: CaptureSubject; readonly error: string; readonly reasons?: readonly Reason[] };

/** The policy of a swarm, read once at its start (0040 section 8.3). */
export interface SwarmReviewSetup {
  readonly policy: PolicySnapshot;
  /** A session started the swarm and the base policy differs from the policy at HEAD of the main checkout. */
  readonly baseDiffers: boolean;
}

/** Takes a checkpoint of an agent's worktree and parses its diff (0040 sections 4 and 5). */
export interface CaptureService {
  /**
   * At swarm start, before the first agent launches, for a swarm with a worktree agent: loads the policy from the
   * base commit with the profile's overlay through `PolicyLoader`, stores it, and takes the repository snapshot
   * (0040 sections 8.3 and 17). Every capture of the swarm carries this policy's hash, also after a merge moved its
   * base, and `policy.base_differs` when `baseDiffers` is set.
   */
  prepare(swarmId: SwarmId): Promise<SwarmReviewSetup>;
  capture(subject: CaptureSubject, trigger: CaptureTrigger): Promise<CaptureResult>;
  /** At app start: runs the capture jobs left `pending` again (0040 section 4.1) and returns their results for `submit`. */
  resumePending(): Promise<readonly CaptureResult[]>;
  /**
   * Compares the swarm's repository snapshot without reading a work tree (0040 sections 4.2, 15.3 and 17): `repo.armed`
   * and `repo.ref_moved` for a changed shared configuration, hooks directory, `info/attributes` or ref, and
   * `reviewer.user_config_changed` for a changed user-level Claude file. The manager calls it before a reviewer starts
   * and before a merge; `capture` runs it itself.
   */
  compareRepo(swarmId: SwarmId): Promise<readonly Reason[]>;
  /**
   * The user accepted a repository change from its alert: compares and stores one snapshot; later captures carry
   * `repo.armed` and `repo.ref_moved`. `expectedHash` is the `repoDifferenceHash` of the reasons shown, which covers
   * file content, every ref change and the user-level Claude content; another change is refused.
   */
  acceptRepoChange(swarmId: SwarmId, expectedHash: string): Promise<void>;
  /** The app's own merge moved `ref`: moves only that ref in the snapshot, when it still holds `expectedOld`. */
  refreshRef(swarmId: SwarmId, ref: string, expectedOld: string, newTip: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------------------------------
// Policy (w-capture)

export interface RepoRef {
  readonly repoPath: string;
  /** The common git directory; the policy is read from objects only. */
  readonly commonDir: string;
}

/**
 * Reads `.agide/review-policy.json` from the base commit with `ls-tree` and `cat-file`, never from a worktree
 * (0040 section 8.3), and merges the user-level overlay, which only tightens (section 8.4).
 */
export interface PolicyLoader {
  load(repo: RepoRef, baseCommit: string, overlay: UserPolicy | undefined): Promise<PolicySnapshot>;
}

// ---------------------------------------------------------------------------------------------------------------
// Check (w-capture)

export interface CheckRequest {
  readonly changesetId: ChangesetId;
  readonly swarmId: SwarmId;
  readonly commonDir: string;
  readonly checkpointCommit: string;
  readonly baseCommit: string;
  readonly policyHash: string;
  readonly policy: ReviewPolicy;
}

/** The checkpoint run and the base run, which ran first or is the stored green result of the pair (0040 section 6, base comparison). */
export interface CheckOutcomeSet {
  readonly checkpoint: CheckRecord;
  readonly base?: CheckRecord;
}

/** Runs the base policy's check in a fresh checkout of the checkpoint, never with more power than the agent had. */
export interface CheckExecutor {
  run(request: CheckRequest): Promise<CheckOutcomeSet>;
  /** Ends a running or queued check of the changeset; its record ends `not_run`. */
  cancel(changesetId: ChangesetId): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------
// Rules (w-capture)

export interface AssessInput {
  readonly changeset: ChangesetRecord;
  readonly files: readonly ChangesetFile[];
  readonly hunks: readonly Hunk[];
  readonly policy: PolicySnapshot;
  readonly check: CheckOutcomeSet | undefined;
  /** The agent's other changesets of this run that are not rejected, and the latest of every other agent of the swarm. */
  readonly runChangesets: readonly ChangesetRecord[];
  readonly swarmChangesets: readonly ChangesetRecord[];
  /** The agent's `owns` globs and the paths other agents changed, for `path.outside_owns` and `path.overlap`. */
  readonly owns: readonly string[];
  readonly otherAgentsPaths: Readonly<Record<string, readonly string[]>>;
}

/**
 * The rule reasons of a changeset (0040 section 7): check, size, file, path, config, deps, tests, secrets,
 * telemetry, claim and accumulation, with the policy's `rungs` applied and hard floors kept. Pure.
 */
export interface RiskRules {
  assess(input: AssessInput): Reason[];
}

// ---------------------------------------------------------------------------------------------------------------
// Reviewer (w-reviewer)

/** What one reviewer run needs (0040 section 10). The runner builds the checkout, settings, prompt and launch spec. */
export interface ReviewRunRequest {
  readonly runId: string;
  readonly changesetId: ChangesetId;
  readonly swarmId: SwarmId;
  readonly agent: string;
  readonly attempt: 1 | 2;
  /** App-chosen; the reviewer session's id and its grant (tool set `reviewer`). */
  readonly sessionId: SessionId;
  /** The swarm's folder; the grant is scoped to it. */
  readonly folderId: NodeId | undefined;
  readonly tier: Tier;
  readonly effort: Effort;
  readonly rung: Rung;
  readonly reservationUsd: number;
  readonly maxTurns: number;
  readonly timeoutMinutes: number;
  readonly commonDir: string;
  readonly baseCommit: string;
  readonly checkpointCommit: string;
  /** The working agent's task, user text. */
  readonly task: string;
  /** Prompt data (0040 section 10.3). The files and hunks give the diff or the per-file inputs named by index. */
  readonly files: readonly ChangesetFile[];
  readonly hunks: readonly Hunk[];
  /** The latest check of the checkpoint; its output tail is untrusted. */
  readonly check?: CheckRecord;
  readonly reasons: readonly StoredReason[];
  /** Agent text, introduced as a claim to verify. */
  readonly claim: Claim | null;
}

export type ReviewerEvent =
  /** `promptVersion` is the id of the prompt template the run used, stored on the run (0040 section 10.3). */
  | { readonly type: 'started'; readonly runId: string; readonly sessionId: SessionId; readonly pid?: number; readonly model: string; readonly promptVersion?: string }
  /** The process ended. The manager counts the run as failed without a stored report, whatever the result says (P41). */
  | {
      readonly type: 'ended';
      readonly runId: string;
      readonly sessionId: SessionId;
      readonly costUsd: number;
      readonly result?: TurnResult;
      /** Set when the runner knows why: timeout, spawn, budget, error-result, or a cancel. */
      readonly failure?: RunFailure;
      /** `can_use_tool` requests answered deny at once. */
      readonly deniedRequests: number;
    };

/**
 * Runs reviewer agents on the swarm's `AgentRuntime` (0040 section 10): one stream-json session per run with
 * `--tools Read,Grep,Glob`, `--allowedTools mcp__app__report_review`, every `can_use_tool` denied at once, in a
 * read-only checkout of the checkpoint. The report itself arrives through the `report_review` tool, so the runner
 * reports only the start and the end of the process.
 */
export interface ReviewerRuntime {
  start(request: ReviewRunRequest): Promise<void>;
  cancel(runId: string, why: RunFailure): Promise<void>;
  subscribe(listener: (event: ReviewerEvent) => void): Unsubscribe;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------
// Budget, send-back and merge (w-manager)

export type ReviewQuote = { readonly ok: true; readonly usd: number } | { readonly ok: false; readonly why: 'pot' | 'daily' };

/** The review pot of the swarm's ledger and the daily review budget (0040 section 16). */
export interface ReviewBudget {
  /** Reserves `min(usdPerRun, pot remainder)` from the pot and the day; refused when either cannot pay. */
  reserve(swarmId: SwarmId, runId: string, usdPerRun: number): ReviewQuote;
  /** Replaces the reservation with the reported cost in both. */
  settle(runId: string, reportedUsd: number): void;
}

export type Delivery = { readonly delivered: true } | { readonly delivered: false; readonly why: string };

/** Sends a send-back to the working agent through the swarm manager's `send` (0040 section 14). */
export interface SendBackChannel {
  deliver(swarmId: SwarmId, agent: string, message: string): Promise<Delivery>;
}

export interface MergeStep {
  readonly agent: string;
  readonly changesetId: ChangesetId;
  readonly baseCommit: string;
  readonly checkpointCommit: string;
  readonly checkpointTree: string;
  readonly patchPath: string;
}

export type MergeOutcome =
  | { readonly ok: true; readonly from: string; readonly to: string; readonly commits: readonly { readonly changesetId: ChangesetId; readonly commit: string }[] }
  | { readonly ok: false; readonly from: string; readonly conflicts?: readonly { readonly agents: readonly string[]; readonly files: readonly string[] }[]; readonly why: string };

/** The git mechanism of 0040 section 15.3: one squash commit per changeset, a compare-and-swap of the target. */
export interface Merger {
  merge(input: { readonly repoPath: string; readonly commonDir: string; readonly target: string; readonly goal: string; readonly steps: readonly MergeStep[]; readonly dryRun: boolean }): Promise<MergeOutcome>;
}

// ---------------------------------------------------------------------------------------------------------------
// Store (w-manager: SQLite; contracts: in memory)

export interface ChangesetFilter {
  readonly swarmId?: SwarmId;
  readonly agent?: string;
  readonly states?: readonly ChangesetState[];
  readonly limit?: number;
}

/** The fields a state or rung change writes, together with its decision row. */
export interface ChangesetUpdate {
  readonly state: ChangesetState;
  readonly rung: Rung;
  readonly floor: Rung;
  readonly attempt?: number;
  readonly mergedCommit?: string;
}

/**
 * The review tables (0040 section 3.3). Every write is atomic. `applyDecision` is a compare-and-swap on the
 * state and rung the decision names, so two writers cannot both move a changeset. Implementations:
 * `InMemoryChangesetStore` and w-manager's SQLite store; both pass `describeChangesetStoreContract`.
 */
export interface ChangesetStore {
  putPolicy(snapshot: PolicySnapshot): void;
  policy(hash: string): PolicySnapshot | undefined;

  /** Inserts the changeset with its files, hunks and first reasons. `refused` for a used id or (swarm, agent, seq). */
  insert(changeset: ChangesetRecord, files: readonly ChangesetFile[], hunks: readonly Hunk[]): void;
  get(id: ChangesetId): ChangesetRecord | undefined;
  /** Newest first. */
  list(filter?: ChangesetFilter): ChangesetRecord[];
  /** The agent's changeset with the highest `seq`. */
  latest(swarmId: SwarmId, agent: string): ChangesetRecord | undefined;
  files(id: ChangesetId): ChangesetFile[];
  /** In file and hunk order; one file's hunks with `fileIdx`. */
  hunks(id: ChangesetId, fileIdx?: number): Hunk[];

  /**
   * Writes the update and appends the decision when the changeset is still in `decision.fromState` at
   * `decision.fromRung`; returns the updated record, or undefined and writes nothing when it is not.
   */
  applyDecision(decision: DecisionRecord, update: ChangesetUpdate): ChangesetRecord | undefined;
  decisions(id: ChangesetId): DecisionRecord[];

  /** Adds reasons keyed by (changeset, id, subject); an existing key keeps its first row. Returns the rows added. */
  addReasons(id: ChangesetId, reasons: readonly Reason[], createdAt: string): StoredReason[];
  reasons(id: ChangesetId): StoredReason[];

  putCheck(check: CheckRecord): void;
  checks(id: ChangesetId): CheckRecord[];
  /** The latest base run for (commit, policy), shared by every changeset on that base. */
  baseCheck(commitId: string, policyHash: string): CheckRecord | undefined;

  putRun(run: ReviewRunRecord): void;
  run(runId: string): ReviewRunRecord | undefined;
  runs(id: ChangesetId): ReviewRunRecord[];
  runBySession(sessionId: SessionId): ReviewRunRecord | undefined;

  /** `refused` when the run already has a report. */
  putReport(report: ReviewReport): void;
  reports(id: ChangesetId): ReviewReport[];

  putComment(comment: CommentRecord): void;
  comment(commentId: string): CommentRecord | undefined;
  deleteComment(commentId: string): boolean;
  comments(id: ChangesetId): CommentRecord[];
  /** Marks the drafts sent in the send-back decision. */
  markSent(commentIds: readonly string[], decisionId: string): void;

  /** Inserts or replaces the mark of (scope, level, subject hash). */
  putSeen(mark: SeenMark): void;
  seen(scope: string): SeenMark[];
}

// ---------------------------------------------------------------------------------------------------------------
// Manager (w-manager)

export interface ChangesetSummary {
  readonly id: ChangesetId;
  readonly swarmId: SwarmId;
  readonly agent: string;
  readonly seq: number;
  readonly state: ChangesetState;
  readonly rung: Rung;
  readonly floor: Rung;
  readonly reasonCount: number;
  readonly checkOutcome?: CheckRecord['outcome'];
  readonly verdict?: ReviewReport['verdict'];
  readonly fileCount: number;
  readonly added: number;
  readonly removed: number;
  readonly contentHash: string;
  readonly merged: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SeenState {
  readonly summaryHash: string;
  readonly summary: boolean;
  /** Per file index: seen when every hunk is, or by its own mark when it has none. */
  readonly files: readonly { readonly idx: number; readonly seen: boolean; readonly unseenHunks: number }[];
  /** Hunk hashes with a mark in the agent's scope. */
  readonly hunks: readonly string[];
}

export interface ChangesetDetail {
  readonly changeset: ChangesetRecord;
  readonly files: readonly ChangesetFile[];
  /** Only with `hunks: true`. */
  readonly hunks?: readonly Hunk[];
  readonly reasons: readonly StoredReason[];
  readonly checks: readonly CheckRecord[];
  readonly runs: readonly ReviewRunRecord[];
  readonly report?: ReviewReport;
  readonly decisions: readonly DecisionRecord[];
  readonly comments: readonly CommentRecord[];
  readonly seen: SeenState;
}

export type DemoteResult = { readonly committed: true; readonly changeset: ChangesetRecord } | { readonly committed: false; readonly confirmToken: string; readonly expiresAt: string };

export interface MergeGateEntry {
  readonly agent: string;
  readonly changesetId?: ChangesetId;
  readonly ok: boolean;
  /** App text: why this agent blocks the merge. */
  readonly why?: string;
}

export interface MergeGate {
  readonly open: boolean;
  readonly agents: readonly MergeGateEntry[];
}

export interface SwarmMergeInput {
  readonly swarmId: SwarmId;
  readonly target?: string;
  readonly exclude: readonly string[];
  readonly dryRun: boolean;
}

export interface SwarmMergeResult {
  readonly target: string;
  readonly from: string;
  readonly to?: string;
  readonly merged: readonly { readonly agent: string; readonly changesetId: ChangesetId; readonly commit: string }[];
  readonly refused?: readonly { readonly agent?: string; readonly why: string }[];
  readonly conflicts?: readonly { readonly agents: readonly string[]; readonly files: readonly string[] }[];
}

export type ReviewEvent =
  | { readonly type: 'review.changed'; readonly changesetId: ChangesetId; readonly swarmId: SwarmId; readonly agent: string; readonly state: ChangesetState; readonly rung: Rung }
  | { readonly type: 'review.seen'; readonly changesetId: ChangesetId; readonly level: SeenLevel };

/**
 * The state machine and the actions of every actor (0040 sections 9 to 16). The commands call it with the
 * caller; capture hands it captures. Implementations: `InMemoryReviewManager` and w-manager's persistent
 * manager; both pass `describeReviewManagerContract`.
 */
export interface ReviewManager {
  /** Stores a capture, supersedes the agent's previous changeset and runs the pipeline: check, rules, reviewer. */
  submit(capture: CapturedChangeset): Promise<ChangesetRecord>;
  list(input: ReviewCommandInput<'review_list'>, caller: ReviewCaller): ChangesetSummary[];
  get(input: ReviewCommandInput<'review_get'>, caller: ReviewCaller): ChangesetDetail;
  accept(input: ReviewCommandInput<'review_accept'>, caller: ReviewCaller): Promise<ChangesetRecord>;
  reject(input: ReviewCommandInput<'review_reject'>, caller: ReviewCaller): Promise<ChangesetRecord>;
  sendBack(input: ReviewCommandInput<'review_send_back'>, caller: ReviewCaller): Promise<ChangesetRecord>;
  comment(input: ReviewCommandInput<'review_comment'>, caller: ReviewCaller): CommentRecord | { readonly deleted: true };
  escalate(input: ReviewCommandInput<'review_escalate'>, caller: ReviewCaller): Promise<ChangesetRecord>;
  requestEscalation(input: ReviewCommandInput<'review_request_escalation'>, caller: ReviewCaller): Promise<ChangesetRecord>;
  demote(input: ReviewCommandInput<'review_demote'>, caller: ReviewCaller): Promise<DemoteResult>;
  seen(input: ReviewCommandInput<'review_seen'>, caller: ReviewCaller): SeenMark;
  reportReview(input: ReviewCommandInput<'report_review'>, caller: ReviewCaller): Promise<{ readonly stored: true; readonly findings: number }>;
  reportOutcome(input: ReviewCommandInput<'report_outcome'>, caller: ReviewCaller): { readonly recorded: true; readonly appliesTo: string };
  /** The agent ended after a send-back without new work: its sent-back changeset goes to a person. Undefined when nothing was sent back. */
  noNewCapture(swarmId: SwarmId, agent: string, why: string): Promise<ChangesetRecord | undefined>;
  /** The gate of 0040 section 15.1 for the swarm. */
  mergeGate(swarmId: SwarmId, exclude?: readonly string[]): MergeGate;
  /** `swarm_merge`: refused while the gate is closed. The app.merge approval happens before the call. */
  merge(input: SwarmMergeInput, caller: ReviewCaller): Promise<SwarmMergeResult>;
  subscribe(listener: (event: ReviewEvent) => void): Unsubscribe;
  /** App quit: cancel reviewer runs and checks. */
  shutdown(): Promise<void>;
}

/** What the review module gives the other modules. */
export interface ReviewService {
  readonly manager: ReviewManager;
}

/** Inbox origin of the alert for a changed repository; its payload is `{ swarmId, repoDifferenceHash? }`. */
export const REPO_ALERT_ORIGIN = 'review:repo';

/** Inbox origin of the alert for a check that fails on the base commit; its payload is `{ swarmId, baseCommit, policyHash }`. */
export const BASE_ALERT_ORIGIN = 'review:base';

/** Inbox origin of review items (0040 section 12). */
export const REVIEW_ITEM_ORIGIN = 'review:changeset';

/** The `payload` of a review inbox item. The card's Accept sends `contentHash` and `rung` as the expected values. */
export interface ReviewItemPayload {
  readonly swarmId: SwarmId;
  readonly agent: string;
  readonly changesetId: ChangesetId;
  readonly rung: Rung;
  readonly contentHash: string;
  readonly state: ChangesetState;
  /** True at rung C or below when no report finding is `major` or above, so the card offers Accept. */
  readonly cardAccept: boolean;
  /** A reviewer report exists; without one an Accept at rung B or above carries the "without the reviewer" tick. */
  readonly hasReport: boolean;
}
