import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsedRun, type RecordingBaseline, type ScriptedBaseRunner } from '../fakes/fakeBase';
import { sha1Of, sha256Of } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import type { SwarmId } from '../../swarm/types';
import type { ChangesetStore, TestRunStore } from '../types';
import type { BaseChecks, BaseJobRecord, BaseRequest } from './types';

/**
 * What the suite gets per test. The checks must run one base run at a time (one check slot), take their runs from
 * `runner` and write their rows to `store`; `baseline` is the baseline computer they were built with.
 */
export interface BaseChecksHarness {
  readonly checks: BaseChecks;
  readonly runner: ScriptedBaseRunner;
  readonly store: Pick<ChangesetStore, 'baseCheck'> & TestRunStore;
  readonly baseline: RecordingBaseline;
  close(): Promise<void> | void;
  /**
   * Present for an implementation that keeps its jobs across a restart. Stands for a quit or a crash followed by a
   * start: the returned harness reads the state the first one stored, and only the swarms in `liveSwarms` still exist
   * (a removed swarm is gone from the job's requesters). The suite does not use the first harness afterwards and
   * closes it; ending the first instance (its shutdown or a drop) is the hook's part. The restart cases are skipped
   * when the hook is absent.
   */
  restart?(liveSwarms: readonly SwarmId[]): Promise<BaseChecksHarness>;
}

const A = sha1Of('commit a');
const B = sha1Of('commit b');
const P1 = sha256Of('policy one');
const P2 = sha256Of('policy two');
const PLAIN = reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } });
const WITH_REPORTS = reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'], reports: { junit: ['reports/*.xml'] } } });
const WITH_MIN_TESTS = reviewPolicySchema.parse({ version: 1, check: { command: ['cargo', 'test'], reports: { libtest: true }, minTests: 3 } });
const never = (): AbortSignal => new AbortController().signal;

/** Behaviour every `BaseChecks` shows (0045 sections 3.1 and 3.2). */
export function describeBaseChecksContract(name: string, setup: () => Promise<BaseChecksHarness>, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (BaseChecks contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    let h: BaseChecksHarness;
    beforeEach(async () => {
      h = await setup();
    });
    afterEach(async () => {
      await h.checks.shutdown();
      await h.close();
    });

    const ask = (patch: Partial<BaseRequest> = {}): BaseJobRecord =>
      h.checks.request({ swarmId: 'sw1', commonDir: '/repo/.git', commitId: A, policyHash: P1, policy: PLAIN, trigger: 'swarm_start', ...patch });
    const verdict = (commit = A, policy = P1) => h.checks.verdict(commit, policy);
    const ended = (commit = A, policy = P1) => h.checks.await(commit, policy, never());

    it('queues a job, runs it when a slot is free and ends it green when the first run passes', async () => {
      const states: string[] = [];
      h.checks.subscribe((job) => states.push(job.state));
      const queued = ask();
      expect(queued, 'the record of a request').toMatchObject({ state: 'queued', trigger: 'swarm_start', swarmId: 'sw1', commitId: A, policyHash: P1, checkIds: [], endedAt: null });
      expect(queued.id, 'the id').toMatch(/^bjob_[0-9a-f]+$/);
      const call = await h.runner.next();
      expect(call.request, 'the run is for the pair of the request').toMatchObject({ swarmId: 'sw1', commonDir: '/repo/.git', commitId: A, policyHash: P1 });
      expect(verdict(), 'while the run is open').toMatchObject({ state: 'pending', job: { id: queued.id, state: 'running', endedAt: null } });
      call.finish('passed');
      const result = await ended();
      expect(result.state, 'a passed first run').toBe('green');
      expect(result.check?.id, 'the passing run is the deciding run').toBe(call.check.id);
      expect(result.job, 'the ended job lists its run and has an end time').toMatchObject({ id: queued.id, state: 'green', checkIds: [call.check.id] });
      expect(result.job?.endedAt, 'the end time is set').not.toBeNull();
      expect(states, 'one event per state').toEqual(['queued', 'running', 'green']);
      expect(h.store.baseCheck(A, P1)?.id, 'the green row is where the executor reuses it from').toBe(call.check.id);
    });

    it('reports unknown for a pair that never ran and returns copies of its records', async () => {
      expect(verdict(), 'no job of the pair').toEqual({ state: 'unknown', job: undefined, check: undefined, baseline: undefined });
      const queued = ask();
      (queued as { state: string }).state = 'green';
      const call = await h.runner.next();
      expect(verdict().job?.state, 'a changed copy does not change the job').toBe('running');
      call.finish('passed');
      await ended();
    });

    it('runs the first run again when it failed and ends green when the rerun passes', async () => {
      const states: string[] = [];
      h.checks.subscribe((job) => states.push(job.state));
      ask();
      const first = await h.runner.next();
      first.finish('failed');
      const second = await h.runner.next();
      expect(verdict().job?.state, 'a failed first run is confirmed, not decided').toBe('confirming');
      second.finish('passed');
      const result = await ended();
      expect(result.state, 'the rerun passed: the base is green').toBe('green');
      expect(result.check?.id, 'the passing run decided').toBe(second.check.id);
      expect(result.job?.checkIds, 'both runs in order').toEqual([first.check.id, second.check.id]);
      expect(states, 'the states of the job').toEqual(['queued', 'running', 'confirming', 'green']);
    });

    it('ends red when the rerun fails too, and also after a timeout', async () => {
      ask();
      (await h.runner.next()).finish('failed');
      const second = await h.runner.next();
      second.finish('timed_out');
      const result = await ended();
      expect(result.state, 'two runs without a pass').toBe('red');
      expect(result.check?.id, 'the confirming run is the deciding run').toBe(second.check.id);
      ask({ commitId: B });
      (await h.runner.next()).finish('timed_out');
      const rerun = await h.runner.next();
      expect(verdict(B).job?.state, 'a timeout is confirmed like a failure').toBe('confirming');
      rerun.finish('failed');
      expect((await ended(B)).state, 'and ends red when the rerun fails').toBe('red');
    });

    it('does not confirm a pair that is known red: one red run ends the job red', async () => {
      ask();
      (await h.runner.next()).finish('failed');
      (await h.runner.next()).finish('failed');
      expect((await ended()).state, 'the first job is red').toBe('red');
      h.checks.rerun('sw1', A, P1);
      const call = await h.runner.next();
      call.finish('failed');
      const result = await ended();
      expect(result.state, 'one red run is enough for a known red pair').toBe('red');
      expect(result.job?.checkIds, 'one run only').toEqual([call.check.id]);
      expect(await h.runner.idle(), 'no confirm run starts').toBe(false);
    });

    it('confirms a red run again after a green job in between', async () => {
      ask();
      (await h.runner.next()).finish('failed');
      (await h.runner.next()).finish('failed');
      await ended();
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('passed');
      await ended();
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('failed');
      expect((await h.runner.next()).request.commitId, 'a pair that turned green is confirmed again').toBe(A);
      expect(verdict().job?.state, 'the job confirms').toBe('confirming');
    });

    it('skips a cancelled job when it looks for the newest earlier job of a pair: the pair stays known red', async () => {
      ask();
      (await h.runner.next()).finish('failed');
      (await h.runner.next()).finish('failed');
      expect((await ended()).state, 'the first job is red').toBe('red');
      h.checks.rerun('sw1', A, P1);
      const cancelled = await h.runner.next();
      await h.checks.release('sw1');
      expect(cancelled.signal.aborted, 'the second job is cancelled').toBe(true);
      h.checks.rerun('sw1', A, P1);
      const third = await h.runner.next();
      third.finish('failed');
      const result = await ended();
      expect(result.state, 'the cancelled job says nothing, the red job before it still counts').toBe('red');
      expect(result.job?.checkIds, 'one run only').toEqual([third.check.id]);
      expect(await h.runner.idle(), 'no confirm run starts').toBe(false);
    });

    it('confirms a red run again when the newest earlier job did not run, since it says nothing about the base', async () => {
      ask();
      (await h.runner.next()).finish('failed');
      (await h.runner.next()).finish('failed');
      await ended();
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('not_run');
      expect((await ended()).state, 'the second job did not run').toBe('not_run');
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('failed');
      const confirm = await h.runner.next();
      expect(confirm.request.commitId, 'the newest earlier job is not red, so the run is confirmed').toBe(A);
      expect(verdict().job?.state, 'the job confirms').toBe('confirming');
      confirm.finish('failed');
      expect((await ended()).state, 'and ends red when the confirm run fails').toBe('red');
    });

    it('ends not_run when a run did not run and keeps the earlier green row of the pair', async () => {
      ask();
      const green = await h.runner.next();
      green.finish('passed');
      await ended();
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('not_run');
      const result = await ended();
      expect(result.state, 'a first run that did not run').toBe('not_run');
      expect(await h.runner.idle(), 'no confirm run after a run that did not run').toBe(false);
      expect(h.store.baseCheck(A, P1)?.id, 'the row of a run that did not run does not hide the green row').toBe(green.check.id);
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('failed');
      (await h.runner.next()).finish('not_run');
      expect((await ended()).state, 'a confirm run that did not run').toBe('not_run');
    });

    it('ends not_run when the runner fails in the app', async () => {
      ask();
      (await h.runner.next()).crash(new Error('no checkout'));
      expect((await ended()).state, 'an app failure is not a verdict on the project').toBe('not_run');
    });

    it('runs a second time for the baseline only when the policy names a report source, and the first run decides', async () => {
      ask({ policy: WITH_REPORTS });
      (await h.runner.next()).finish('passed', parsedRun({ passed: ['a', 'b'] }));
      const second = await h.runner.next();
      expect(verdict().job?.state, 'the job stays running until the baseline run ends').toBe('running');
      second.finish('failed', parsedRun({ passed: ['a'], failed: ['b'] }));
      const result = await ended();
      expect(result.state, 'a failing second run leaves the base green').toBe('green');
      expect(result.job?.checkIds.length, 'two runs').toBe(2);
      expect(result.check?.id, 'the first run decided').toBe(result.job?.checkIds[0]);
      expect(h.baseline.calls.map((call) => [call.jobId, call.runs.map((run) => run.failed), call.minTests]), 'the baseline was computed from both runs, with the default minimum').toEqual([[result.job?.id, [0, 1], 1]]);
      expect(result.baseline, 'the verdict carries the baseline').toMatchObject({ jobId: result.job?.id, commitId: A, policyHash: P1 });
      expect(h.store.baseline(A, P1)?.jobId, 'the baseline is stored').toBe(result.job?.id);
    });

    it('runs once without a report source, as the first run says all a second could', async () => {
      ask();
      (await h.runner.next()).finish('passed');
      expect((await ended()).state, 'green').toBe('green');
      expect(await h.runner.idle(), 'no baseline run').toBe(false);
      expect(h.baseline.calls, 'no baseline without reports').toEqual([]);
      expect(h.checks.verdict(A, P1).baseline, 'the verdict has none').toBeUndefined();
    });

    it('treats a report entry that names no source like a policy without one: no baseline run', async () => {
      ask({ policy: reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'], reports: {} } }) });
      (await h.runner.next()).finish('passed');
      expect((await ended()).state, 'green after the first run').toBe('green');
      expect(await h.runner.idle(), 'a second run finds no test names to compare').toBe(false);
      expect(h.baseline.calls, 'no baseline').toEqual([]);
    });

    it('stores the counts and the failing tests of a run with its row and hands the minimum of the policy to the baseline', async () => {
      ask({ policy: WITH_MIN_TESTS });
      const first = await h.runner.next();
      first.finish('failed', parsedRun({ passed: ['a'], failed: ['b', 'c'] }));
      const second = await h.runner.next();
      second.finish('failed', parsedRun({ passed: ['a', 'b'], failed: ['c'] }));
      const result = await ended();
      expect(result.state, 'red after the confirm run').toBe('red');
      expect(h.store.baseCheck(A, P1)?.tests, 'the counts of the newest row').toMatchObject({ executed: 3, failed: 1, passed: 2 });
      expect(h.store.testFailures(first.check.id).map((row) => row.name), 'the failures of the first run').toEqual(['b', 'c']);
      expect(h.store.testFailures(second.check.id).map((row) => row.name), 'the failures of the confirm run').toEqual(['c']);
      expect(h.baseline.calls[0]?.minTests, 'the policy minimum').toBe(3);
      expect(h.baseline.calls[0]?.runs.length, 'both runs').toBe(2);
    });

    it('stores no baseline for a job that did not run, also when an earlier run of the job had reports', async () => {
      ask({ policy: WITH_REPORTS });
      (await h.runner.next()).finish('not_run', parsedRun({ status: 'not_configured' }));
      expect((await ended()).state, 'not_run').toBe('not_run');
      expect(h.baseline.calls, 'no baseline computed').toEqual([]);
      expect(h.store.baseline(A, P1), 'none stored').toBeUndefined();
      h.checks.rerun('sw1', A, P1);
      (await h.runner.next()).finish('failed', parsedRun({ passed: ['a'], failed: ['b'] }));
      (await h.runner.next()).finish('not_run');
      expect((await ended()).state, 'a confirm run that did not run').toBe('not_run');
      expect(h.baseline.calls, 'the report of the first run is not enough for a baseline').toEqual([]);
      expect(h.store.baseline(A, P1), 'none stored after the second job').toBeUndefined();
    });

    it('keeps one open job per pair and lets a later request for the pair join it', async () => {
      const first = ask();
      const joined = ask({ swarmId: 'sw2', trigger: 'capture' });
      expect(joined.id, 'the open job is returned').toBe(first.id);
      expect(joined.swarmId, 'the swarm that requested it first stays on the record').toBe('sw1');
      const other = ask({ commitId: B });
      expect(other.id, 'another commit has its own job').not.toBe(first.id);
      expect(ask({ policyHash: P2 }).id, 'another policy has its own job').not.toBe(first.id);
      (await h.runner.next()).finish('passed');
      await ended();
      const after = ask();
      expect(after.id, 'a request after the end is a new job').not.toBe(first.id);
      expect(after.trigger, 'with its own trigger').toBe('swarm_start');
    });

    it('runs one job at a time with one check slot and takes the queued jobs in the order they were requested', async () => {
      ask();
      ask({ commitId: B });
      ask({ commitId: sha1Of('commit c') });
      const first = await h.runner.next();
      expect(verdict(B).job?.state, 'the second job waits for the slot').toBe('queued');
      expect(await h.runner.idle(), 'no second run yet').toBe(false);
      first.finish('passed');
      const second = await h.runner.next();
      expect(second.request.commitId, 'the second request runs next').toBe(B);
      second.finish('passed');
      expect((await h.runner.next()).request.commitId, 'then the third').toBe(sha1Of('commit c'));
    });

    it('resolves await at once for a pair without an open job, when the job ends and when the signal aborts', async () => {
      expect((await ended()).state, 'no job: unknown').toBe('unknown');
      ask();
      const call = await h.runner.next();
      let resolved = false;
      const waiting = h.checks.await(A, P1, never()).then((result) => {
        resolved = true;
        return result;
      });
      await h.runner.idle();
      expect(resolved, 'await waits while the job is open').toBe(false);
      const control = new AbortController();
      const aborted = h.checks.await(A, P1, control.signal);
      control.abort();
      expect((await aborted).state, 'the signal ends the wait with the verdict of the moment').toBe('pending');
      call.finish('passed');
      expect((await waiting).state, 'the end of the job resolves the wait').toBe('green');
      const already = new AbortController();
      already.abort();
      ask();
      expect((await h.checks.await(A, P1, already.signal)).state, 'a signal that is already aborted').toBe('pending');
    });

    it('queues a user rerun as a new job and refuses it while a job of the pair is open or for a pair never requested', async () => {
      expect(() => h.checks.rerun('sw1', A, P1), 'a pair that never ran').toThrow(expect.objectContaining({ code: 'not_found' }));
      ask();
      expect(() => h.checks.rerun('sw1', A, P1), 'while the job is open').toThrow(expect.objectContaining({ code: 'refused' }));
      (await h.runner.next()).finish('passed');
      const first = await ended();
      const again = h.checks.rerun('sw2', A, P1);
      expect(again, 'a new job of the pair').toMatchObject({ trigger: 'user', swarmId: 'sw2', commitId: A, policyHash: P1, state: 'queued' });
      expect(again.id, 'not the old one').not.toBe(first.job?.id);
      const call = await h.runner.next();
      expect(call.request.policy, 'the run uses the policy of the earlier request').toEqual(PLAIN);
      call.finish('passed');
      await ended();
    });

    it('cancels a queued job and a running job when the only swarm that requested it is released, and says nothing about the base', async () => {
      ask({ swarmId: 'sw1' });
      ask({ swarmId: 'sw2', commitId: B });
      const running = await h.runner.next();
      await h.checks.release('sw2');
      expect(verdict(B), 'the queued job of sw2 ended cancelled and leaves no verdict').toEqual({ state: 'unknown', job: undefined, check: undefined, baseline: undefined });
      expect(verdict().state, 'the job of sw1 is untouched').toBe('pending');
      await h.checks.release('sw1');
      expect(running.signal.aborted, 'the run of a released swarm is told to stop').toBe(true);
      expect(verdict().state, 'a cancelled job is no verdict').toBe('unknown');
      expect(await h.runner.idle(), 'the cancelled queued job never started').toBe(false);
      expect(ask().state, 'a request after the cancel is a new job').toBe('queued');
    });

    it('keeps a job that another swarm requested too until its last requester is released', async () => {
      ask({ swarmId: 'sw1' });
      ask({ swarmId: 'sw2' });
      const call = await h.runner.next();
      await h.checks.release('sw1');
      expect(call.signal.aborted, 'sw2 still wants the result').toBe(false);
      expect(verdict().state, 'the job is open').toBe('pending');
      await h.checks.release('sw3');
      expect(call.signal.aborted, 'a swarm that never requested it changes nothing').toBe(false);
      await h.checks.release('sw2');
      expect(call.signal.aborted, 'the last requester left').toBe(true);
    });

    it('does not let a cancelled job change the earlier verdict of the pair', async () => {
      ask();
      (await h.runner.next()).finish('passed');
      await ended();
      h.checks.rerun('sw1', A, P1);
      const call = await h.runner.next();
      expect(verdict().state, 'the rerun is open').toBe('pending');
      await h.checks.release('sw1');
      expect(call.signal.aborted, 'stopped').toBe(true);
      expect(verdict().state, 'the earlier green job is the verdict again').toBe('green');
    });

    it('lists the newest final verdict of each pair of a commit, newest first, without open or other commits', async () => {
      ask({ policyHash: P1 });
      (await h.runner.next()).finish('failed');
      (await h.runner.next()).finish('failed');
      await ended(A, P1);
      ask({ policyHash: P2 });
      (await h.runner.next()).finish('passed');
      await ended(A, P2);
      ask({ commitId: B });
      (await h.runner.next()).finish('passed');
      await ended(B);
      ask({ policyHash: sha256Of('policy three') });
      expect(
        h.checks.verdictsOfCommit(A).map((entry) => [entry.policyHash, entry.state]),
        'the pairs of the commit that have an ended job, the later one first',
      ).toEqual([
        [P2, 'green'],
        [P1, 'red'],
      ]);
      expect(h.checks.verdictsOfCommit(sha1Of('unknown')), 'a commit without jobs').toEqual([]);
    });

    it('stops listening after the unsubscribe', async () => {
      const seen: string[] = [];
      const off = h.checks.subscribe((job) => seen.push(job.state));
      ask();
      const call = await h.runner.next();
      off();
      call.finish('passed');
      await ended();
      expect(seen, 'only the events before the unsubscribe').toEqual(['queued', 'running']);
    });

    describe('restart', () => {
      const restarted = async (live: readonly SwarmId[]): Promise<BaseChecksHarness | undefined> => {
        const before = h;
        if (before.restart === undefined) return undefined;
        const after = await before.restart(live);
        h = after;
        await before.close();
        return after;
      };

      it('makes an open job queued again when a swarm that requested it still exists, and runs it', async (context) => {
        const first = ask();
        await h.runner.next();
        const waiting = ask({ commitId: B });
        if ((await restarted(['sw1'])) === undefined) return context.skip();
        expect(verdict().job, 'the running job is open again, as the same job').toMatchObject({ id: first.id, trigger: 'swarm_start', swarmId: 'sw1', endedAt: null });
        expect(verdict(B).job, 'the queued job is open again, as the same job').toMatchObject({ id: waiting.id, endedAt: null });
        expect(['queued', 'running'], 'a restarted job is queued, or running once a slot took it').toContain(verdict().job?.state);
        const call = await h.runner.next();
        expect(call.request, 'the run is for the pair of the job').toMatchObject({ commitId: A, policyHash: P1 });
        call.finish('passed');
        expect((await ended()).state, 'the job ends as any job').toBe('green');
      });

      it('ends an open job cancelled when no swarm that requested it exists any more', async (context) => {
        const first = ask();
        await h.runner.next();
        if ((await restarted([])) === undefined) return context.skip();
        expect(verdict(), 'a cancelled job leaves no verdict').toEqual({ state: 'unknown', job: undefined, check: undefined, baseline: undefined });
        expect(await h.runner.idle(), 'no run starts').toBe(false);
        expect(ask().id, 'a request after the restart is a new job').not.toBe(first.id);
      });

      it('does not let a removed swarm keep a job open that another swarm still wants', async (context) => {
        ask({ swarmId: 'sw1' });
        ask({ swarmId: 'sw2' });
        if ((await restarted(['sw2'])) === undefined) return context.skip();
        const call = await h.runner.next();
        await h.checks.release('sw2');
        expect(call.signal.aborted, 'the removed swarm is not a requester: the last one left').toBe(true);
      });
    });

    it('cancels every open job at shutdown, resolves the waiting calls and refuses new requests', async () => {
      ask();
      ask({ commitId: B });
      const call = await h.runner.next();
      const waiting = h.checks.await(A, P1, never());
      await h.checks.shutdown();
      expect(call.signal.aborted, 'the running job is stopped').toBe(true);
      expect((await waiting).state, 'the waiting call is resolved').toBe('unknown');
      expect(verdict(B).state, 'the queued job is gone').toBe('unknown');
      expect(() => ask(), 'a request after shutdown').toThrow(expect.objectContaining({ code: 'refused' }));
    });
  });
}
