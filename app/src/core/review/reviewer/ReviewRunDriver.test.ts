import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeReviewBudget } from '../fakes/fakes';
import type { RunFailure } from '../schemas';
import type { ReviewRunRequest, ReviewerEvent, ReviewerRuntime } from '../types';
import { EventBus } from '../../events/EventBus';
import { dispositionOf, ReviewRunDriver, type ReviewRunOutcome, type ReviewRunTemplate } from './ReviewRunDriver';
import { runRequest } from './reviewerRuntimeContract';

type Behaviour =
  | { readonly kind: 'report'; readonly cost?: number }
  | { readonly kind: 'ends'; readonly failure?: RunFailure; readonly cost?: number }
  | { readonly kind: 'hangs' }
  | { readonly kind: 'throws' };

/** A reviewer runtime that plays one behaviour per started run. */
class ScriptedRuntime implements ReviewerRuntime {
  readonly started: ReviewRunRequest[] = [];
  readonly cancelled: { runId: string; why: RunFailure }[] = [];
  readonly reported = new Set<string>();
  private readonly events = new EventBus<ReviewerEvent>();
  constructor(private readonly behaviours: Behaviour[]) {}

  async start(request: ReviewRunRequest): Promise<void> {
    this.started.push(request);
    const behaviour = this.behaviours.shift() ?? { kind: 'ends' };
    if (behaviour.kind === 'throws') throw new Error('cannot start');
    if (behaviour.kind === 'hangs') return;
    if (behaviour.kind === 'report') this.reported.add(request.runId);
    const cost = behaviour.cost ?? 0.1;
    queueMicrotask(() => this.events.emit({ type: 'ended', runId: request.runId, sessionId: request.sessionId, costUsd: cost, ...(behaviour.kind === 'ends' && behaviour.failure !== undefined ? { failure: behaviour.failure } : {}), deniedRequests: 0 }));
  }

  async cancel(runId: string, why: RunFailure): Promise<void> {
    this.cancelled.push({ runId, why });
    const request = this.started.find((candidate) => candidate.runId === runId);
    if (request !== undefined) this.events.emit({ type: 'ended', runId, sessionId: request.sessionId, costUsd: 0.02, failure: why, deniedRequests: 0 });
  }

  subscribe(listener: (event: ReviewerEvent) => void): () => void {
    return this.events.onAny(listener);
  }

  async dispose(): Promise<void> {}
}

const template = (): ReviewRunTemplate => {
  const { runId: _runId, sessionId: _sessionId, attempt: _attempt, reservationUsd: _reservation, ...rest } = runRequest({ timeoutMinutes: 1 });
  return rest;
};

let ids = 0;
function driverOver(runtime: ScriptedRuntime, budget: FakeReviewBudget, graceMs = 100): ReviewRunDriver {
  return new ReviewRunDriver({ runtime, budget, hasReport: (runId) => runtime.reported.has(runId), newRunId: () => `r${++ids}`, newSessionId: () => `s${ids}`, graceMs });
}

describe('review run driver', () => {
  let budget: FakeReviewBudget;
  beforeEach(() => {
    budget = new FakeReviewBudget(10);
  });
  afterEach(() => vi.useRealTimers());

  it('reports a run that stored a report and settles its cost against the reservation', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'report', cost: 0.2 }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome.kind, 'a stored report ends the review').toBe('reported');
    expect(runtime.started.length, 'one run').toBe(1);
    expect(runtime.started[0]?.reservationUsd, 'the reservation is the per-run amount').toBe(1);
    expect([...budget.settled.values()], 'the reported cost replaced the reservation').toEqual([0.2]);
  });

  it('counts a run that ended with a success but no stored report as failed and tries once more with a fresh session', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'ends' }, { kind: 'report' }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome, 'the second run reported').toMatchObject({ kind: 'reported', attempts: 2 });
    expect(runtime.started.map((request) => request.attempt), 'attempts one and two').toEqual([1, 2]);
    expect(new Set(runtime.started.map((request) => request.sessionId)).size, 'each run has its own session').toBe(2);
  });

  it('ends in failed after two runs without a report, with the failure of each', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'ends', failure: 'error-result' }, { kind: 'ends' }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome, 'a reviewer that never reports').toEqual({ kind: 'failed', failures: ['error-result', 'no-report'] });
    expect(runtime.started.length, 'no third run').toBe(2);
    expect(dispositionOf(outcome), 'a person decides with reviewer.no_report').toEqual({ action: 'human', reasonId: 'reviewer.no_report' });
  });

  it('treats a failed start as a spawn failure and retries', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'throws' }, { kind: 'report' }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome, 'the retry reported').toMatchObject({ kind: 'reported', attempts: 2 });
  });

  it('keeps a report that arrived before a timeout ended the process', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'ends', failure: 'timeout' }]);
    runtime.reported.add('r-next');
    const driver = new ReviewRunDriver({ runtime, budget, hasReport: () => true, newRunId: () => 'r-next', newSessionId: () => 'sx' });
    expect((await driver.run(template(), 1)).kind, 'a stored report is final').toBe('reported');
  });

  it('gives up on a runtime that never reports an end, after the timeout and the grace, and cancels the run', async () => {
    vi.useFakeTimers();
    const runtime = new ScriptedRuntime([{ kind: 'hangs' }, { kind: 'hangs' }]);
    const pending = driverOver(runtime, budget, 1_000).run(template(), 1);
    await vi.advanceTimersByTimeAsync(60_000 + 1_000 + 10);
    await vi.advanceTimersByTimeAsync(60_000 + 1_000 + 10);
    expect(await pending, 'both runs timed out').toEqual({ kind: 'failed', failures: ['timeout', 'timeout'] });
    expect(runtime.cancelled.map((call) => call.why), 'each hung run was cancelled as a timeout').toEqual(['timeout', 'timeout']);
  });

  it('does not retry a run that was cancelled because the changeset was superseded', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'hangs' }]);
    const driver = driverOver(runtime, budget);
    const pending = driver.run(template(), 1);
    await vi.waitFor(() => expect(runtime.started.length, 'the run started').toBe(1));
    await driver.cancel(runtime.started[0]!.changesetId, 'superseded');
    expect(await pending, 'cancelled').toEqual({ kind: 'cancelled', why: 'superseded' });
    expect(runtime.started.length, 'no second run').toBe(1);
  });
});

describe('review budget', () => {
  it('queues for a person when the review pot is spent and starts no run', async () => {
    const budget = new FakeReviewBudget(0);
    const runtime = new ScriptedRuntime([{ kind: 'report' }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome, 'the pot cannot pay').toEqual({ kind: 'queued_for_budget', why: 'pot', attempts: 0 });
    expect(runtime.started, 'no process started').toEqual([]);
  });

  it('queues for a person when the daily budget is spent', async () => {
    const budget = new FakeReviewBudget(10, 0.5);
    const runtime = new ScriptedRuntime([{ kind: 'report' }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome, 'the day cannot pay a run of one dollar').toEqual({ kind: 'queued_for_budget', why: 'daily', attempts: 0 });
  });

  it('queues the retry when the first run spent the rest of the day', async () => {
    const budget = new FakeReviewBudget(10, 1.2);
    const runtime = new ScriptedRuntime([{ kind: 'ends', cost: 1 }]);
    const outcome = await driverOver(runtime, budget).run(template(), 1);
    expect(outcome, 'the first run left too little for a second').toMatchObject({ kind: 'queued_for_budget', why: 'daily', attempts: 1 });
  });

  it('never turns a budget outcome into an accept, whatever the pot or the day allows', async () => {
    const outcomes: ReviewRunOutcome[] = [];
    for (const [pot, day] of [[0, 5], [5, 0], [0, 0]] as const) outcomes.push(await driverOver(new ScriptedRuntime([]), new FakeReviewBudget(pot, day)).run(template(), 1));
    for (const outcome of outcomes) {
      expect(outcome.kind, 'the budget stopped the review').toBe('queued_for_budget');
      expect(dispositionOf(outcome), 'a person decides; the app accepts nothing').toEqual({ action: 'queue_for_human', reasonId: 'reviewer.skipped_budget' });
    }
  });

  it('reserves the smaller of the per-run amount and the pot remainder', async () => {
    const runtime = new ScriptedRuntime([{ kind: 'report' }]);
    await driverOver(runtime, new FakeReviewBudget(0.3)).run(template(), 2);
    expect(runtime.started[0]?.reservationUsd, 'the remainder of the pot').toBe(0.3);
  });
});
