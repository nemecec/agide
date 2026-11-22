import type { Unsubscribe } from '../../events/EventBus';
import type { RunFailure } from '../schemas';
import type { ReviewBudget, ReviewRunRequest, ReviewerEvent, ReviewerRuntime } from '../types';

/** How a review of one changeset ended. `queued_for_budget` is never an accept: a person decides it. */
export type ReviewRunOutcome =
  | { readonly kind: 'reported'; readonly runId: string; readonly attempts: 1 | 2 }
  | { readonly kind: 'queued_for_budget'; readonly why: 'pot' | 'daily'; readonly attempts: 0 | 1 }
  | { readonly kind: 'failed'; readonly failures: readonly RunFailure[] }
  | { readonly kind: 'cancelled'; readonly why: RunFailure };

/** What the driver adds to the request: ids and the reservation are its own. */
export type ReviewRunTemplate = Omit<ReviewRunRequest, 'runId' | 'sessionId' | 'attempt' | 'reservationUsd'>;

export interface ReviewRunDriverDeps {
  readonly runtime: ReviewerRuntime;
  readonly budget: ReviewBudget;
  /** True once a valid report of the run is stored; a run without one failed whatever its result says (P41). */
  readonly hasReport: (runId: string) => boolean;
  readonly newRunId: () => string;
  readonly newSessionId: () => string;
  /** The run is about to start (after its reservation) or ended; the manager writes the run rows from these. */
  readonly onRunStart?: (request: ReviewRunRequest) => void;
  readonly onRunEnd?: (request: ReviewRunRequest, ended: Extract<ReviewerEvent, { type: 'ended' }> | { readonly failure: RunFailure; readonly costUsd: number }) => void;
  /** Extra time after `timeoutMinutes` before the driver gives up on a runtime that reports no end. Default 30 s. */
  readonly graceMs?: number;
}

const CANCEL_FAILURES: readonly RunFailure[] = ['superseded', 'user', 'app-exit'];
type Ended = Extract<ReviewerEvent, { type: 'ended' }>;

/**
 * Runs the reviewer for one changeset: reserves from the review pot and the day, starts the run, waits for its
 * end, settles the cost, and starts one more run with a fresh session when the first ended without a report
 * (0040 sections 10.5 and 16). A budget that cannot pay ends in `queued_for_budget`; no path from there accepts.
 */
export class ReviewRunDriver {
  private readonly waiting = new Map<string, (ended: Ended) => void>();
  private readonly active = new Map<string, { runId: string; cancelled?: RunFailure }>();
  private readonly off: Unsubscribe;

  constructor(private readonly deps: ReviewRunDriverDeps) {
    this.off = deps.runtime.subscribe((event) => {
      if (event.type === 'ended') this.waiting.get(event.runId)?.(event);
    });
  }

  async run(template: ReviewRunTemplate, usdPerRun: number): Promise<ReviewRunOutcome> {
    const failures: RunFailure[] = [];
    const entry: { runId: string; cancelled?: RunFailure } = { runId: '' };
    this.active.set(template.changesetId, entry);
    try {
      for (const attempt of [1, 2] as const) {
        if (entry.cancelled !== undefined) return { kind: 'cancelled', why: entry.cancelled };
        const runId = this.deps.newRunId();
        entry.runId = runId;
        const quote = this.deps.budget.reserve(template.swarmId, runId, usdPerRun);
        if (!quote.ok) return { kind: 'queued_for_budget', why: quote.why, attempts: attempt === 1 ? 0 : 1 };
        const request: ReviewRunRequest = { ...template, runId, sessionId: this.deps.newSessionId(), attempt, reservationUsd: quote.usd };
        const ended = await this.runOnce(request);
        this.deps.budget.settle(runId, ended.costUsd);
        this.deps.onRunEnd?.(request, ended);
        if (this.deps.hasReport(runId)) return { kind: 'reported', runId, attempts: attempt };
        const failure = ended.failure ?? 'no-report';
        if (entry.cancelled !== undefined || CANCEL_FAILURES.includes(failure)) return { kind: 'cancelled', why: entry.cancelled ?? failure };
        failures.push(failure);
      }
      return { kind: 'failed', failures };
    } finally {
      this.active.delete(template.changesetId);
    }
  }

  /** Ends the running review of the changeset; the driver then starts no further run for it. */
  async cancel(changesetId: string, why: RunFailure): Promise<void> {
    const entry = this.active.get(changesetId);
    if (entry === undefined || entry.runId === '') return;
    entry.cancelled = why;
    await this.deps.runtime.cancel(entry.runId, why);
  }

  dispose(): void {
    this.off();
  }

  private async runOnce(request: ReviewRunRequest): Promise<Ended> {
    const { runtime } = this.deps;
    const ended = new Promise<Ended>((resolve) => this.waiting.set(request.runId, resolve));
    const gaveUp = new Promise<Ended>((resolve) => {
      const timer = setTimeout(() => {
        void runtime.cancel(request.runId, 'timeout').finally(() => resolve({ type: 'ended', runId: request.runId, sessionId: request.sessionId, costUsd: 0, failure: 'timeout', deniedRequests: 0 }));
      }, request.timeoutMinutes * 60_000 + (this.deps.graceMs ?? 30_000));
      void ended.finally(() => clearTimeout(timer));
    });
    this.deps.onRunStart?.(request);
    try {
      await runtime.start(request);
    } catch {
      // the runtime reports a failed start as an ended event when it can; otherwise the run counts as a failed spawn
      this.waiting.get(request.runId)?.({ type: 'ended', runId: request.runId, sessionId: request.sessionId, costUsd: 0, failure: 'spawn', deniedRequests: 0 });
    }
    try {
      return await Promise.race([ended, gaveUp]);
    } finally {
      this.waiting.delete(request.runId);
    }
  }
}

/** What the manager does after a review ended (0040 sections 10.5 and 16). */
export type RunDisposition =
  | { readonly action: 'apply_report'; readonly runId: string }
  /** The unit waits for a person with `reviewer.skipped_budget`. The app never accepts it. */
  | { readonly action: 'queue_for_human'; readonly reasonId: 'reviewer.skipped_budget' }
  /** Two runs ended without a report: `reviewer.no_report`, and a person decides. */
  | { readonly action: 'human'; readonly reasonId: 'reviewer.no_report' }
  | { readonly action: 'none' };

export function dispositionOf(outcome: ReviewRunOutcome): RunDisposition {
  switch (outcome.kind) {
    case 'reported':
      return { action: 'apply_report', runId: outcome.runId };
    case 'queued_for_budget':
      return { action: 'queue_for_human', reasonId: 'reviewer.skipped_budget' };
    case 'failed':
      return { action: 'human', reasonId: 'reviewer.no_report' };
    case 'cancelled':
      return { action: 'none' };
  }
}
