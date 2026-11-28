import type { Unsubscribe } from '../../events/EventBus';
import type { SwarmDefinitionInput } from '../../swarm/definition';
import type { SwarmId } from '../../swarm/types';
import type { ReviewPolicy } from '../policy/schema';
import type { Baseline, ParsedRun, TestRunSummary } from '../reports/types';
import type { CheckRecord } from '../schemas';

/**
 * The base check as a background job (0045 sections 3.1, 3.2 and 4.3). A job is the work for one pair of base
 * commit and policy hash, requested by a swarm. `InMemoryBaseChecks` is the reference implementation and
 * `describeBaseChecksContract` the suite every implementation passes.
 */

export const BASE_TRIGGERS = ['swarm_start', 'merge', 'capture', 'user'] as const;
export type BaseTrigger = (typeof BASE_TRIGGERS)[number];

export const BASE_JOB_STATES = ['queued', 'running', 'confirming', 'green', 'red', 'not_run', 'cancelled'] as const;
export type BaseJobState = (typeof BASE_JOB_STATES)[number];

/** A job in one of these states is open: it has no end time and a request for its pair joins it. */
export const OPEN_BASE_STATES: readonly BaseJobState[] = ['queued', 'running', 'confirming'];

export interface BaseJobRecord {
  /** `bjob_` and hex. */
  readonly id: string;
  /** The swarm that requested it first. */
  readonly swarmId: SwarmId;
  readonly commitId: string;
  readonly policyHash: string;
  readonly trigger: BaseTrigger;
  readonly state: BaseJobState;
  /** The base rows of the job in run order: the first run, then the confirm run or the baseline run. */
  readonly checkIds: readonly string[];
  readonly requestedAt: string;
  /** Null while the job is queued, running or confirming. */
  readonly endedAt: string | null;
}

export interface BaseVerdict {
  /** `pending` while a job of the pair is open; `unknown` when no job of the pair has ended. */
  readonly state: 'green' | 'red' | 'not_run' | 'pending' | 'unknown';
  readonly job: BaseJobRecord | undefined;
  /** The deciding run of the newest final job. */
  readonly check: CheckRecord | undefined;
  readonly baseline: Baseline | undefined;
}

/** One pair of base commit and policy hash in the result of `review_base_status` (0045 section 4.7). */
export interface BaseStatusEntry {
  readonly commitId: string;
  readonly policyHash: string;
  /** `swarm` for the base of the swarm itself, `changeset` for the pair of an undecided changeset of the swarm. */
  readonly use: 'swarm' | 'changeset';
  readonly state: BaseVerdict['state'];
  /** The newest job of the pair; null when none exists. */
  readonly job: {
    readonly id: string;
    readonly state: BaseJobState;
    readonly trigger: BaseTrigger;
    readonly requestedAt: string;
    readonly endedAt: string | null;
  } | null;
  /** The counts of the deciding run; null when it read no report. The result holds no test names. */
  readonly tests: TestRunSummary | null;
  /** The state of the baseline of the pair, `none` when it has none. */
  readonly baseline: Baseline['state'] | 'none';
}

/** The result of `review_base_status`. */
export interface BaseStatusResult {
  readonly swarmId: SwarmId;
  readonly pairs: readonly BaseStatusEntry[];
}

/** The result of `review_base_verdict`: what `BaseChecks.verdictsOfCommit` returns, for the red-base banner of the start dialog. */
export type BaseVerdictResult = ReturnType<BaseChecks['verdictsOfCommit']>;

/** The result of `review_base_fix_draft`: a definition for the start dialog. The failing test names, if any, are inside the prompt as an untrusted-data block (0045 section 3.5). */
export interface BaseFixDraft {
  readonly definition: SwarmDefinitionInput;
}

export interface BaseRequest {
  readonly swarmId: SwarmId;
  readonly commonDir: string;
  readonly commitId: string;
  readonly policyHash: string;
  readonly policy: ReviewPolicy;
  readonly trigger: BaseTrigger;
}

export interface BaseChecks {
  /** Queues a job for the pair, or joins the open job of the pair and records the swarm as a requester. */
  request(input: BaseRequest): BaseJobRecord;
  /** The verdict of the newest final job of the pair; a cancelled job says nothing. */
  verdict(commitId: string, policyHash: string): BaseVerdict;
  /** The newest final verdict of each stored pair of the commit, newest first; the start dialog's red-base banner. */
  verdictsOfCommit(commitId: string): readonly (BaseVerdict & { readonly policyHash: string })[];
  /** Resolves when no job of the pair is open; the executor calls it before it decides about a base run. */
  await(commitId: string, policyHash: string, signal: AbortSignal): Promise<BaseVerdict>;
  /** "Run base again": a new job with trigger `user`; refused while a job of the pair is open. */
  rerun(swarmId: SwarmId, commitId: string, policyHash: string): BaseJobRecord;
  /** A swarm ended or was removed: its open jobs that no other swarm requested end `cancelled`. */
  release(swarmId: SwarmId): Promise<void>;
  subscribe(listener: (job: BaseJobRecord) => void): Unsubscribe;
  shutdown(): Promise<void>;
}

/** What the executor's base run needs; the same inputs as a job request without the trigger. */
export type BaseRunRequest = Omit<BaseRequest, 'trigger'>;

/** The result of one base run: the check row and, when the reports were looked for, the parsed run. */
export interface BaseRun {
  readonly check: CheckRecord;
  readonly tests?: ParsedRun;
}

/**
 * The seam to the executor (`ProcessCheckExecutor.runBase`): runs the check on the base commit in its own checkout
 * with the rules of a base run (0040 section 6) and takes a check slot ahead of the queued checkpoint runs.
 * Rejects only for an app failure; a run that could not run is a `not_run` check. The signal ends the run.
 */
export interface BaseRunner {
  runBase(request: BaseRunRequest, signal: AbortSignal): Promise<BaseRun>;
}

/** The baseline of a job from the parsed runs of its checks (0045 section 3.7); `computeBaseline` of w-reports. */
export type ComputeBaseline = (job: BaseJobRecord, runs: readonly ParsedRun[], minTests: number) => Baseline;

/** The `review.base_changed` event: a job of the pair changed state. */
export interface BaseChangedEvent {
  readonly type: 'review.base_changed';
  readonly swarmId: SwarmId;
  readonly commitId: string;
  readonly policyHash: string;
  readonly jobId: string;
  readonly state: BaseJobState;
}
