import type { BaseRun, BaseRunner, BaseRunRequest, ComputeBaseline } from '../base/types';
import type { Baseline, ParsedRun, TestCase } from '../reports/types';
import type { CheckRecord } from '../schemas';
import { sha256Of } from './fixtures';

/** Test doubles of the base check: a runner a test steers run by run, parsed runs and a baseline that records its calls. */

/** A parsed run whose cases are the named tests; the key of a case is the SHA-256 of its name. */
export function parsedRun(input: { readonly passed?: readonly string[]; readonly failed?: readonly string[]; readonly skipped?: readonly string[]; readonly status?: ParsedRun['status'] } = {}): ParsedRun {
  const cases: TestCase[] = [
    ...(input.passed ?? []).map((name): TestCase => ({ key: sha256Of(`junit:${name}`), suite: 'suite', name, status: 'passed', message: null })),
    ...(input.failed ?? []).map((name): TestCase => ({ key: sha256Of(`junit:${name}`), suite: 'suite', name, status: 'failed', message: `${name} failed` })),
    ...(input.skipped ?? []).map((name): TestCase => ({ key: sha256Of(`junit:${name}`), suite: 'suite', name, status: 'skipped', message: null })),
  ];
  const passed = input.passed?.length ?? 0;
  const failed = input.failed?.length ?? 0;
  return { source: 'junit', status: input.status ?? 'parsed', refusal: null, files: 1, bytes: 100, executed: passed + failed, passed, failed, skipped: input.skipped?.length ?? 0, cases };
}

export interface BaseRunCall {
  readonly request: BaseRunRequest;
  readonly signal: AbortSignal;
  readonly check: CheckRecord;
  /** Ends the run with this outcome and, when given, the parsed reports of the run. */
  finish(outcome: CheckRecord['outcome'], tests?: ParsedRun): void;
  /** Ends the run with an app failure. */
  crash(error: Error): void;
}

const settleTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Starts nothing by itself: each `runBase` waits until the test calls `finish` on its call. An aborted run ends `not_run`, as the executor's does. */
export class ScriptedBaseRunner implements BaseRunner {
  readonly calls: BaseRunCall[] = [];
  private taken = 0;

  runBase(request: BaseRunRequest, signal: AbortSignal): Promise<BaseRun> {
    return new Promise<BaseRun>((resolve, reject) => {
      const id = `chk_base_${this.calls.length + 1}`;
      const record = (outcome: CheckRecord['outcome'], reason: string | null): CheckRecord => ({
        id,
        changesetId: null,
        target: 'base',
        commitId: request.commitId,
        policyHash: request.policyHash,
        command: request.policy.check?.command ?? [],
        outcome,
        notRunReason: reason,
        exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null,
        signal: null,
        durationMs: 1,
        outputPath: null,
        outputTail: outcome === 'failed' ? 'FAIL on the base' : '',
        truncated: false,
        startedAt: '2026-11-28T10:00:00.000Z',
        endedAt: '2026-11-28T10:00:01.000Z',
      });
      let ended = false;
      const end = (run: BaseRun) => {
        if (ended) return;
        ended = true;
        resolve(run);
      };
      signal.addEventListener('abort', () => end({ check: record('not_run', 'cancelled') }), { once: true });
      this.calls.push({
        request,
        signal,
        check: record('running', null),
        finish: (outcome, tests) => end({ check: record(outcome, outcome === 'not_run' ? 'the base run did not run' : null), ...(tests === undefined ? {} : { tests }) }),
        crash: (error) => {
          ended = true;
          reject(error);
        },
      });
    });
  }

  /** Waits until a run that no earlier call took has started, and returns it. */
  async next(): Promise<BaseRunCall> {
    for (let turn = 0; turn < 50 && this.calls.length <= this.taken; turn += 1) await settleTurn();
    const call = this.calls[this.taken];
    if (call === undefined) throw new Error('no base run started');
    this.taken += 1;
    return call;
  }

  /** Lets the pending promises of the job run; true when a further run started that nobody took. */
  async idle(): Promise<boolean> {
    for (let turn = 0; turn < 5; turn += 1) await settleTurn();
    return this.calls.length > this.taken;
  }
}

/** A baseline computer that records what it was given: `red` when a run in the list failed in all of them, else `clean`. */
export class RecordingBaseline {
  readonly calls: { readonly jobId: string; readonly runs: readonly ParsedRun[]; readonly minTests: number }[] = [];

  readonly compute: ComputeBaseline = (job, runs, minTests): Baseline => {
    this.calls.push({ jobId: job.id, runs, minTests });
    const failing = runs[0]?.cases.filter((test) => test.status === 'failed' || test.status === 'error').map((test) => test.key) ?? [];
    return { commitId: job.commitId, policyHash: job.policyHash, jobId: job.id, state: failing.length > 0 ? 'red' : 'clean', known: failing, flaky: [], executed: runs[0]?.executed ?? 0 };
  };
}
