import { randomBytes } from 'node:crypto';
import { EventBus, type Unsubscribe } from '../../events/EventBus';
import type { SwarmId } from '../../swarm/types';
import type { ReviewPolicy } from '../policy/schema';
import { failuresOf, summaryOf, type Baseline, type ParsedRun } from '../reports/types';
import type { CheckRecord } from '../schemas';
import { ReviewError, type ChangesetStore, type TestRunStore } from '../types';
import { OPEN_BASE_STATES, type BaseChecks, type BaseJobRecord, type BaseJobState, type BaseRequest, type BaseRunner, type BaseVerdict, type ComputeBaseline } from './types';

export interface InMemoryBaseChecksDeps {
  /** Runs the check on a base commit; the executor's `runBase` in the app. */
  readonly runner: BaseRunner;
  /** Where the base rows, the test runs and the baselines go, so `baseCheck` finds a green row of the pair. */
  readonly store: Pick<ChangesetStore, 'putCheck'> & TestRunStore;
  /** `computeBaseline` of w-reports; without it a job stores no baseline. */
  readonly computeBaseline?: ComputeBaseline;
  /** Runs at the same time; `review.maxConcurrentChecks` in the app. Default 1. */
  readonly slots?: number;
  readonly clock?: () => string;
  /** Open jobs of an earlier instance (`openJobs`) that start again, as a durable implementation does after a restart. */
  readonly resume?: readonly ResumableJob[];
}

/** What a restart needs of an open job: the job, the request it ran for and the swarms that still want it. */
export interface ResumableJob {
  readonly record: BaseJobRecord;
  readonly request: BaseRequest;
  readonly swarms: readonly SwarmId[];
}

interface Job {
  record: BaseJobRecord;
  readonly request: BaseRequest;
  readonly swarms: Set<SwarmId>;
  readonly controller: AbortController;
  readonly checks: CheckRecord[];
  readonly runs: ParsedRun[];
  baseline: Baseline | undefined;
  readonly done: Promise<void>;
  end(): void;
}

/** The runner rejected: an app failure, as opposed to a check that failed. */
class RunnerFailure extends Error {
  constructor(readonly reason: unknown) {
    super('the base runner failed');
  }
}

type JobEvent = { readonly type: 'job'; readonly job: BaseJobRecord };

const pairKey = (commitId: string, policyHash: string): string => `${commitId}\0${policyHash}`;
const isOpen = (state: BaseJobState): boolean => OPEN_BASE_STATES.includes(state);
const hasReportSource = (policy: ReviewPolicy): boolean => (policy.check?.reports?.junit.length ?? 0) > 0 || policy.check?.reports?.libtest === true;

function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * The base check jobs without persistence (0045 section 3.1): one open job per pair, a confirm rerun of a first red
 * run unless the pair is known red, a baseline run after a passed first run when the policy names a report source,
 * and cancelling when no requesting swarm is left. Passes `describeBaseChecksContract`.
 */
export class InMemoryBaseChecks implements BaseChecks {
  private readonly jobs: Job[] = [];
  private readonly lastRequest = new Map<string, BaseRequest>();
  private readonly queue: Job[] = [];
  private readonly events = new EventBus<JobEvent>();
  private readonly clock: () => string;
  private running = 0;
  private closed = false;

  constructor(private readonly deps: InMemoryBaseChecksDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
    for (const job of deps.resume ?? []) if (job.swarms.length > 0) this.queueJob(job.request, job);
  }

  /** The open jobs with their requesters: the state a durable implementation keeps for a restart. */
  openJobs(): ResumableJob[] {
    return this.jobs.filter((job) => isOpen(job.record.state)).map((job) => ({ record: structuredClone(job.record), request: job.request, swarms: [...job.swarms] }));
  }

  request(input: BaseRequest): BaseJobRecord {
    if (this.closed) throw new ReviewError('refused', 'the base checks are shut down');
    const open = this.openJob(input.commitId, input.policyHash);
    if (open !== undefined) {
      open.swarms.add(input.swarmId);
      return structuredClone(open.record);
    }
    return this.queueJob(input);
  }

  verdict(commitId: string, policyHash: string): BaseVerdict {
    const open = this.openJob(commitId, policyHash);
    if (open !== undefined) return { state: 'pending', job: structuredClone(open.record), check: undefined, baseline: undefined };
    return this.finalVerdict(commitId, policyHash);
  }

  verdictsOfCommit(commitId: string): readonly (BaseVerdict & { readonly policyHash: string })[] {
    const pairs = [...new Set(this.jobs.filter((job) => job.record.commitId === commitId).map((job) => job.record.policyHash))];
    return pairs
      .map((policyHash) => ({ ...this.finalVerdict(commitId, policyHash), policyHash }))
      .filter((verdict) => verdict.job !== undefined)
      .sort((a, b) => (b.job?.endedAt ?? '').localeCompare(a.job?.endedAt ?? '') || this.position(b) - this.position(a));
  }

  async await(commitId: string, policyHash: string, signal: AbortSignal): Promise<BaseVerdict> {
    for (let open = this.openJob(commitId, policyHash); open !== undefined && !signal.aborted; open = this.openJob(commitId, policyHash)) {
      await Promise.race([open.done, aborted(signal)]);
    }
    return this.verdict(commitId, policyHash);
  }

  rerun(swarmId: SwarmId, commitId: string, policyHash: string): BaseJobRecord {
    if (this.openJob(commitId, policyHash) !== undefined) throw new ReviewError('refused', 'a base check of this commit and policy is already queued or running');
    const earlier = this.lastRequest.get(pairKey(commitId, policyHash));
    if (earlier === undefined) throw new ReviewError('not_found', 'no base check was requested for this commit and policy');
    return this.request({ ...earlier, swarmId, trigger: 'user' });
  }

  async release(swarmId: SwarmId): Promise<void> {
    const ending: Promise<void>[] = [];
    for (const job of this.jobs) {
      if (isOpen(job.record.state) && job.swarms.delete(swarmId) && job.swarms.size === 0) ending.push(this.cancel(job));
    }
    await Promise.all(ending);
  }

  subscribe(listener: (job: BaseJobRecord) => void): Unsubscribe {
    return this.events.on('job', (event) => listener(structuredClone(event.job)));
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.all(this.jobs.filter((job) => isOpen(job.record.state)).map((job) => this.cancel(job)));
  }

  // -------------------------------------------------------------------------------------------------------------

  private position(verdict: BaseVerdict): number {
    return this.jobs.findIndex((job) => job.record.id === verdict.job?.id);
  }

  private openJob(commitId: string, policyHash: string): Job | undefined {
    return this.jobs.find((job) => job.record.commitId === commitId && job.record.policyHash === policyHash && isOpen(job.record.state));
  }

  /** The newest ended job of the pair that is not cancelled; a cancelled job says nothing about the base. */
  private finalVerdict(commitId: string, policyHash: string): BaseVerdict {
    const job = this.jobs.findLast((candidate) => candidate.record.commitId === commitId && candidate.record.policyHash === policyHash && ['green', 'red', 'not_run'].includes(candidate.record.state));
    if (job === undefined) return { state: 'unknown', job: undefined, check: undefined, baseline: undefined };
    const decided = job.record.state === 'green' ? job.checks.find((check) => check.outcome === 'passed') : job.checks.at(-1);
    return {
      state: job.record.state as 'green' | 'red' | 'not_run',
      job: structuredClone(job.record),
      check: decided === undefined ? undefined : structuredClone(decided),
      baseline: job.baseline === undefined ? undefined : structuredClone(job.baseline),
    };
  }

  private queueJob(input: BaseRequest, resumed?: ResumableJob): BaseJobRecord {
    let end!: () => void;
    const done = new Promise<void>((resolve) => {
      end = resolve;
    });
    const job: Job = {
      record: {
        id: resumed?.record.id ?? `bjob_${randomBytes(8).toString('hex')}`,
        swarmId: input.swarmId,
        commitId: input.commitId,
        policyHash: input.policyHash,
        trigger: input.trigger,
        state: 'queued',
        checkIds: [],
        requestedAt: resumed?.record.requestedAt ?? this.clock(),
        endedAt: null,
      },
      request: input,
      swarms: new Set(resumed?.swarms ?? [input.swarmId]),
      controller: new AbortController(),
      checks: [],
      runs: [],
      baseline: undefined,
      done,
      end,
    };
    this.jobs.push(job);
    this.lastRequest.set(pairKey(input.commitId, input.policyHash), input);
    this.emit(job);
    const queued = structuredClone(job.record);
    this.queue.push(job);
    this.pump();
    return queued;
  }

  private pump(): void {
    while (this.running < (this.deps.slots ?? 1)) {
      const job = this.queue.shift();
      if (job === undefined) return;
      this.running += 1;
      void this.execute(job).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async cancel(job: Job): Promise<void> {
    job.controller.abort();
    const at = this.queue.indexOf(job);
    if (at >= 0) {
      this.queue.splice(at, 1);
      this.finish(job, 'cancelled');
    }
    await job.done;
  }

  private emit(job: Job): void {
    this.events.emit({ type: 'job', job: job.record });
  }

  private update(job: Job, state: BaseJobState): void {
    job.record = { ...job.record, state };
    this.emit(job);
  }

  private finish(job: Job, state: BaseJobState): void {
    job.record = { ...job.record, state, endedAt: this.clock() };
    this.emit(job);
    job.end();
  }

  /** One run of the check; undefined when the job was cancelled meanwhile, whatever the runner answered. */
  private async run(job: Job): Promise<CheckRecord | undefined> {
    const { runner, store } = this.deps;
    const { trigger: _trigger, ...request } = job.request;
    const result = await runner.runBase(request, job.controller.signal).catch((error: unknown) => {
      throw new RunnerFailure(error);
    });
    if (job.controller.signal.aborted) return undefined;
    job.checks.push(result.check);
    job.record = { ...job.record, checkIds: [...job.record.checkIds, result.check.id] };
    // A run that did not run says nothing about the base: its row must not hide the earlier result of the pair.
    if (result.check.outcome !== 'not_run') {
      store.putCheck(result.check);
      if (result.tests !== undefined) {
        store.putTestRun(result.check.id, summaryOf(result.tests), failuresOf(result.tests), null);
        job.runs.push(result.tests);
      }
    }
    return result.check;
  }

  private async execute(job: Job): Promise<void> {
    try {
      this.update(job, 'running');
      const state = await this.decide(job);
      if (state === 'cancelled' || job.controller.signal.aborted) {
        this.finish(job, 'cancelled');
        return;
      }
      this.storeBaseline(job, state);
      this.finish(job, state);
    } catch (error) {
      // The runner failed in the app, not in the project: the job did not run.
      if (!(error instanceof RunnerFailure)) console.error('base check', error);
      this.finish(job, job.controller.signal.aborted ? 'cancelled' : 'not_run');
    }
  }

  private async decide(job: Job): Promise<'green' | 'red' | 'not_run' | 'cancelled'> {
    const first = await this.run(job);
    if (first === undefined) return 'cancelled';
    if (first.outcome === 'not_run') return 'not_run';
    if (first.outcome === 'passed') {
      // The second run finds the tests that fail only sometimes; the first run has decided the base.
      if (hasReportSource(job.request.policy) && (await this.run(job)) === undefined) return 'cancelled';
      return 'green';
    }
    if (this.knownRed(job)) return 'red';
    this.update(job, 'confirming');
    const second = await this.run(job);
    if (second === undefined) return 'cancelled';
    return second.outcome === 'passed' ? 'green' : second.outcome === 'not_run' ? 'not_run' : 'red';
  }

  /** The newest earlier job of the pair that is not cancelled ended red. */
  private knownRed(job: Job): boolean {
    const earlier = this.jobs.filter((candidate) => candidate !== job && candidate.record.commitId === job.record.commitId && candidate.record.policyHash === job.record.policyHash && candidate.record.state !== 'cancelled' && !isOpen(candidate.record.state));
    return earlier.at(-1)?.record.state === 'red';
  }

  private storeBaseline(job: Job, state: 'green' | 'red' | 'not_run'): void {
    const { computeBaseline, store } = this.deps;
    if (computeBaseline === undefined || state === 'not_run' || job.runs.length === 0) return;
    job.baseline = computeBaseline(job.record, job.runs, job.request.policy.check?.minTests ?? 1);
    store.putBaseline(job.baseline);
  }
}
