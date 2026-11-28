import { systemProcesses, type ProcessControl } from '../../swarm/manager/PersistentSwarmManager';
import type { ChangesetRecord, ReviewRunRecord } from '../schemas';
import type { CheckOutcomeSet } from '../types';
import { InMemoryReviewManager } from './InMemoryReviewManager';

/**
 * The review manager over the SQLite store (0041). The rules of the state machine, the actors and the merge gate are
 * the base class's, which reads everything it decides on from the store, including demotions, so a restart changes
 * none of them. This class adds what a process lifetime needs: picking up the work a crash or a quit left open
 * (0040 section 4.1) and starting the reviews that waited for budget. The base class runs one merge per swarm at a time.
 */
export class PersistentReviewManager extends InMemoryReviewManager {
  private releasing: Promise<void> = Promise.resolve();

  /**
   * At app start: running checks become `not_run` and run again, reviewer runs the crash cut short fail with
   * `app-exit` and follow the retry rule, steps that had not finished repeat, and queued reviews meet the budget.
   * Resolves when the work it started has ended.
   */
  async recover(processes: ProcessControl = systemProcesses): Promise<void> {
    const { store } = this.deps;
    const work: Promise<unknown>[] = [];
    const open = store.list({ states: ['captured', 'checking', 'assessed', 'in_review'] }).reverse();
    for (const changeset of open) {
      if (changeset.state === 'captured') work.push(this.guarded(this.pipeline(changeset.id)));
      else if (changeset.state === 'checking') {
        this.endRunningChecks(changeset);
        work.push(this.guarded(this.pipeline(changeset.id)));
      } else if (changeset.state === 'assessed') work.push(this.guarded(this.decide(changeset, this.storedChecks(changeset))));
      else work.push(this.guarded(this.recoverReview(changeset, processes)));
    }
    await Promise.all(work);
    await this.releaseQueued();
  }

  /**
   * Starts the reviews of `queued_for_budget` changesets, oldest first, while the budget pays: at a new day, after a
   * raised pot, and at start. A changeset the budget still cannot pay stays queued and the user may decide it.
   */
  releaseQueued(): Promise<number> {
    const run = this.releasing.then(() => this.releaseNow());
    this.releasing = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async releaseNow(): Promise<number> {
    let started = 0;
    for (const queued of this.deps.store.list({ states: ['queued_for_budget'] }).reverse()) {
      if (this.closed) break;
      const changeset = this.require(queued.id);
      if (changeset.state !== 'queued_for_budget') continue;
      await this.startReview(changeset);
      if (this.require(changeset.id).state !== 'queued_for_budget') started += 1;
    }
    return started;
  }

  /** A quit leaves its runs `cancelled` with `app-exit`, a crash leaves them `queued` or `running`; both count as a failed attempt. */
  private async recoverReview(changeset: ChangesetRecord, processes: ProcessControl): Promise<void> {
    const { store } = this.deps;
    for (const run of store.runs(changeset.id).filter((candidate) => candidate.state === 'queued' || candidate.state === 'running')) {
      if (run.pid !== null && run.sessionId !== null && processes.alive(run.pid) && processes.commandLine(run.pid)?.includes(run.sessionId) === true) processes.terminate(run.pid);
      store.putRun({ ...run, state: 'failed', failure: 'app-exit', endedAt: this.clock() });
      // The process reported nothing, so its reservation is what it may have spent.
      this.deps.budget.settle(run.id, run.reservedUsd);
    }
    const last: ReviewRunRecord | undefined = store.runs(changeset.id).at(-1);
    const report = last?.state === 'reported' ? store.reports(changeset.id).find((candidate) => candidate.runId === last.id) : undefined;
    if (report !== undefined) this.applyReport(report);
    else if (last === undefined) await this.startReview(changeset);
    else if (last.state === 'failed' || (last.state === 'cancelled' && last.failure === 'app-exit')) await this.afterFailedRun(last);
  }

  private endRunningChecks(changeset: ChangesetRecord): void {
    for (const check of this.deps.store.checks(changeset.id)) {
      if (check.outcome === 'running') this.deps.store.putCheck({ ...check, outcome: 'not_run', notRunReason: 'Agide was closed', endedAt: this.clock() });
    }
  }

  private storedChecks(changeset: ChangesetRecord): CheckOutcomeSet | undefined {
    const { store } = this.deps;
    const checkpoint = store.checks(changeset.id).findLast((check) => check.target === 'checkpoint');
    if (checkpoint === undefined) return undefined;
    const base = store.baseCheck(changeset.baseCommit, changeset.policyHash);
    const failures = this.deps.tests?.failureSets(checkpoint.id);
    const baseline = this.deps.tests?.baseline(changeset.baseCommit, changeset.policyHash);
    return { checkpoint, ...(base === undefined ? {} : { base }), ...(failures === undefined ? {} : { failures }), ...(baseline === undefined ? {} : { baseline }) };
  }

  private guarded(work: Promise<unknown>): Promise<void> {
    return work.then(
      () => undefined,
      (error: unknown) => {
        if (!this.closed) console.error('review recovery', error);
      },
    );
  }
}
