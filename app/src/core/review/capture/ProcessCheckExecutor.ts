import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentEnvironment, PtyCommand } from '../../isolation/types';
import type { ChangesetId, CheckRecord } from '../schemas';
import type { ChangesetStore, CheckExecutor, CheckOutcomeSet, CheckRequest } from '../types';
import { readProjectFacts } from './cacheTools';
import { CloneError, type CloneService, type RunClones } from './CheckClones';
import { checkEnvironment, droppedNames } from './checkEnv';
import { environmentNotRunReason, findEnvironmentProblem, findUnconfirmedProblem, type EnvironmentPattern } from './environmentErrors';
import { GuardedGit, type GitExec } from './guardedGit';
import { OutputRing } from './outputRing';
import { CHECK_OWNER_VARIABLE, CHECK_RUN_VARIABLE, sweepNote, type CheckProcesses, type SweepOutcome } from './ProcessSweep';
import { runProcess, type RunningProcess } from './runProcess';

/** `release` removes what `toolCommand` left for a key, such as a settings file; the executor calls it when the run ends. */
export type CheckToolEnvironment = Pick<AgentEnvironment, 'toolCommand'> & { readonly release?: (key: string) => void };

/** The tool environment a check runs in; the review module resolves it from the profile and the provider (0040 section 6). */
export type CheckEnvironment =
  | {
      readonly kind: 'ready';
      readonly environment: CheckToolEnvironment;
      /** The profile's launch environment; the check gets it scrubbed. */
      readonly profileEnv: Readonly<Record<string, string>>;
      /** False for a provider that does not confine the network (`local` without a sandbox). */
      readonly enforcesNetwork: boolean;
    }
  /** For example `local` with the Bash sandbox on and no `srt` installed. */
  | { readonly kind: 'unavailable'; readonly why: string };

export interface CheckExecutorDeps {
  readonly environment: (swarmId: string) => Promise<CheckEnvironment>;
  /** Where the fresh checkouts go; each run gets its own directory below it, which is removed afterwards. */
  readonly checkoutRoot: (swarmId: string, runId: string) => string;
  /** The directory the review writes under (patches, check logs); log paths are stored relative to it. */
  readonly dataDir: string;
  readonly store: Pick<ChangesetStore, 'baseCheck'>;
  readonly maxConcurrent?: () => number;
  /**
   * The cache clones of confined checks: each run gets its own clone of the cache subtrees of its tools, the only
   * writable place besides the checkout and the temporary directory, and the tools are pointed at it. The home
   * directory stays the real one, so toolchains below it are found. A clone that cannot be made ends the run `not_run`.
   */
  readonly clones: CloneService;
  /**
   * Ends the processes a run leaves behind, also a detached one that the process group kill does not reach: when
   * each run starts (those of earlier runs) and when it ends (its own). A base run whose sweep found processes, or could
   * not look, ends `not_run`, and a stored base result never comes from it.
   */
  readonly processes: CheckProcesses;
  /** Resolves when the work that has to precede every run is done, such as the sweep of what a killed app left. */
  readonly ready?: Promise<unknown>;
  /** Directories a check may write besides its checkout, for example a temporary directory. */
  readonly writeDirs?: () => readonly string[];
  readonly exec?: GitExec;
  readonly now?: () => Date;
}

const TAIL_CHARACTERS = 8_000;

/** One run with what the comparison needs to know about it. */
interface Run {
  readonly record: CheckRecord;
  /** A failure whose output holds a word that tests print too; the base run has to fail the same way to make it an environment problem. */
  readonly unconfirmed: EnvironmentPattern | undefined;
  readonly output: string;
}

const plain = (record: CheckRecord, output = ''): Run => ({ record, unconfirmed: undefined, output });

interface Active {
  running: RunningProcess | undefined;
  cancelled: boolean;
  /** Ends a clone that is being made when the check is cancelled. */
  readonly abort: AbortController;
}

/**
 * Only a green base result is reused. A red one is run again with every capture, so that a base that was red for a
 * reason that is gone (a port a survivor held, a service that was down) can turn green, and the alert for it ends.
 */
const reusable = (stored: CheckRecord | undefined): stored is CheckRecord => stored?.outcome === 'passed';

/**
 * Runs the check command of the base policy in a fresh checkout of the checkpoint, through the isolation provider's
 * `toolCommand`, with a scrubbed environment, a timeout and a capped log (0040 section 6). A failed or timed-out check
 * is a result, not an error; the rules turn it into a reason.
 */
export class ProcessCheckExecutor implements CheckExecutor {
  private readonly active = new Map<ChangesetId, Active>();
  private readonly waiting: { resolve: (granted: boolean) => void; changesetId: ChangesetId }[] = [];
  /** Run ids in flight: the start sweep leaves their processes alone. */
  private readonly live = new Set<string>();
  private running = 0;

  constructor(private readonly deps: CheckExecutorDeps) {}

  async run(request: CheckRequest): Promise<CheckOutcomeSet> {
    const state: Active = { cancelled: false, running: undefined, abort: new AbortController() };
    this.active.set(request.changesetId, state);
    try {
      await this.deps.ready?.catch(() => undefined);
      if (!(await this.acquire(request.changesetId))) return { checkpoint: this.notRun(request, 'checkpoint', request.checkpointCommit, request.changesetId, 'the check was cancelled') };
      try {
        if (request.policy.check === undefined) return { checkpoint: this.notRun(request, 'checkpoint', request.checkpointCommit, request.changesetId, 'the policy has no check command') };
        // The base run comes first, once for a pair of base commit and policy: its verdict does not depend on this capture's checkpoint run, and a green stored result makes every later failure of a checkpoint a plain check.failed.
        const base = await this.baseRun(request, state);
        if (state.cancelled) return { checkpoint: this.notRun(request, 'checkpoint', request.checkpointCommit, request.changesetId, 'the check was cancelled') };
        const checkpoint = await this.runTarget(request, 'checkpoint', request.checkpointCommit, request.changesetId, state);
        return this.compared(checkpoint, base);
      } finally {
        this.release();
      }
    } finally {
      this.active.delete(request.changesetId);
    }
  }

  private async baseRun(request: CheckRequest, state: Active): Promise<Run> {
    const stored = this.deps.store.baseCheck(request.baseCommit, request.policyHash);
    return reusable(stored) ? plain(stored) : this.runTarget(request, 'base', request.baseCommit, null, state);
  }

  /** Both runs fail with a word that tests print as well, and the base fails with it too: the environment is broken, and neither run tested the code. */
  private compared(checkpoint: Run, base: Run): CheckOutcomeSet {
    const problem = checkpoint.unconfirmed;
    if (problem === undefined || base.record.outcome !== 'failed' || !problem.pattern.test(base.output)) return { checkpoint: checkpoint.record, base: base.record };
    const notRun = (run: Run): CheckRecord => ({ ...run.record, outcome: 'not_run', notRunReason: environmentNotRunReason(problem, { sameOnBase: true }).slice(0, 500) });
    return { checkpoint: notRun(checkpoint), base: notRun(base) };
  }

  async cancel(changesetId: ChangesetId): Promise<void> {
    const state = this.active.get(changesetId);
    if (state === undefined) return;
    state.cancelled = true;
    state.abort.abort();
    state.running?.cancel();
    const queued = this.waiting.findIndex((entry) => entry.changesetId === changesetId);
    if (queued >= 0) this.waiting.splice(queued, 1)[0]!.resolve(false);
  }

  /** True when a slot was granted; false when the check was cancelled while it waited. */
  private async acquire(changesetId: ChangesetId): Promise<boolean> {
    const limit = Math.max(1, this.deps.maxConcurrent?.() ?? 1);
    if (this.running < limit && this.waiting.length === 0) {
      this.running++;
      return true;
    }
    return new Promise<boolean>((resolve) => this.waiting.push({ resolve, changesetId }));
  }

  private release(): void {
    this.running--;
    const next = this.waiting.shift();
    if (next === undefined) return;
    this.running++;
    next.resolve(true);
  }

  private id(): string {
    return `chk_${randomBytes(8).toString('hex')}`;
  }

  private stamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private record(request: CheckRequest, target: 'checkpoint' | 'base', commitId: string, changesetId: ChangesetId | null, fields: Partial<CheckRecord> & Pick<CheckRecord, 'outcome'>, startedAt: string): CheckRecord {
    return {
      id: this.id(),
      changesetId,
      target,
      commitId,
      policyHash: request.policyHash,
      command: [...(request.policy.check?.command ?? [])],
      notRunReason: null,
      exitCode: null,
      signal: null,
      durationMs: null,
      outputPath: null,
      outputTail: null,
      truncated: false,
      startedAt,
      endedAt: this.stamp(),
      ...fields,
    };
  }

  private notRun(request: CheckRequest, target: 'checkpoint' | 'base', commitId: string, changesetId: ChangesetId | null, why: string): CheckRecord {
    return this.record(request, target, commitId, changesetId, { outcome: 'not_run', notRunReason: why.slice(0, 500) }, this.stamp());
  }

  private async runTarget(request: CheckRequest, target: 'checkpoint' | 'base', commitId: string, changesetId: ChangesetId | null, state: Active): Promise<Run> {
    const check = request.policy.check;
    if (check === undefined) return plain(this.notRun(request, target, commitId, changesetId, 'the policy has no check command'));
    const environment = await this.deps.environment(request.swarmId).catch((error: unknown) => ({ kind: 'unavailable' as const, why: (error as Error).message }));
    if (environment.kind === 'unavailable') return plain(this.notRun(request, target, commitId, changesetId, environment.why));
    const runId = this.id();
    this.live.add(runId);
    try {
      return await this.execute(request, target, commitId, changesetId, state, check, environment, runId);
    } finally {
      this.live.delete(runId);
    }
  }

  private async execute(
    request: CheckRequest,
    target: 'checkpoint' | 'base',
    commitId: string,
    changesetId: ChangesetId | null,
    state: Active,
    check: NonNullable<CheckRequest['policy']['check']>,
    environment: Extract<CheckEnvironment, { kind: 'ready' }>,
    runId: string,
  ): Promise<Run> {
    const notes: string[] = [];
    // Processes that an earlier run left (a killed app, a sweep that could not end one) can hold a port or a file this run needs. They are ended first. A base run after such a find says nothing about the code.
    try {
      const stale = await this.deps.processes.endStale(this.live);
      if (stale.count > 0 && target === 'base') return plain(this.notRun(request, target, commitId, changesetId, 'processes of an earlier check were still running and were ended before the base check started; the base check did not run'));
      if (stale.count > 0) notes.push(`note: ${sweepNote(stale)} before this check started\n`);
    } catch (error) {
      return plain(this.notRun(request, target, commitId, changesetId, `the processes of earlier checks could not be looked for (${(error as Error).message}); the check did not run`));
    }

    const startedAt = this.stamp();
    const started = Date.now();
    const checkout = this.deps.checkoutRoot(request.swarmId, runId);
    let git: GuardedGit;
    try {
      git = await GuardedGit.open(request.commonDir, { ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
      await mkdir(dirname(checkout), { recursive: true, mode: 0o700 });
      await git.text(['worktree', 'add', '--detach', '--force', '--', checkout, commitId]);
    } catch (error) {
      await this.removeCheckout(request, checkout);
      return plain(this.notRun(request, target, commitId, changesetId, `the checkout failed: ${(error as Error).message}`));
    }

    // A private temporary directory next to the checkout: the only writable place besides the checkout and the run's cache clones, removed with them.
    const tempDirectory = `${checkout}-tmp`;
    const ring = new OutputRing();
    const dropped = droppedNames(check.env);
    if (dropped.length > 0) notes.push(`note: check.env names that carry a credential never reach a check and were dropped: ${dropped.join(', ')}\n`);
    if (check.network === 'none' && !environment.enforcesNetwork) notes.push('note: this provider does not enforce the network limit of the check\n');
    const confined = environment.enforcesNetwork;
    const steps = [...(check.setup === undefined ? [] : [{ phase: 'setup' as const, argv: check.setup }]), { phase: 'command' as const, argv: check.command }];
    const deadline = started + check.timeoutSeconds * 1_000;
    let result: Awaited<RunningProcess['result']> | undefined;
    let phase: 'setup' | 'command' = 'command';
    let cloneFailure: string | undefined;
    let clones: RunClones | undefined;
    let swept: SweepOutcome | undefined;
    let sweepFailed = false;
    const keys: string[] = [];
    try {
      await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
      const home = environment.profileEnv['HOME'] ?? homedir();
      // The marker comes last: nothing in the policy or the profile can replace it.
      let env: Record<string, string> = { ...checkEnvironment(environment.profileEnv, check.env, home), TMPDIR: tempDirectory, TMP: tempDirectory, TEMP: tempDirectory, [CHECK_RUN_VARIABLE]: runId, [CHECK_OWNER_VARIABLE]: String(process.pid) };
      // A confined check never writes a real cache: it gets its own clone of the caches of its tools. An unconfined one has the agent's rights anyway.
      if (confined) {
        try {
          clones = await this.deps.clones.create(runId, { host: { home, env: environment.profileEnv }, project: await readProjectFacts(checkout, steps.map((step) => step.argv)), current: env, signal: state.abort.signal });
          env = { ...env, ...clones.environment };
          notes.push(`note: cache clones for ${clones.tools.length === 0 ? 'no tool' : clones.tools.join(', ')} made in ${clones.milliseconds} ms\n`);
        } catch (error) {
          cloneFailure = error instanceof CloneError ? error.message : `the cache clone failed: ${(error as Error).message}`;
        }
      }
      for (const step of cloneFailure === undefined ? steps : []) {
        phase = step.phase;
        if (state.cancelled) {
          result = { kind: 'cancelled' };
          break;
        }
        const key = `${runId}-${step.phase}`;
        keys.push(key);
        const command = await this.toolCommand(environment.environment, key, checkout, step.argv, env, check.network, [tempDirectory, ...(clones === undefined ? [] : [clones.directory])]);
        const running = runProcess(command, ring, Math.max(1, deadline - Date.now()));
        state.running = running;
        result = await running.result;
        state.running = undefined;
        if (result.kind !== 'exited' || result.exitCode !== 0) break;
      }
    } catch (error) {
      result = { kind: 'spawn_failed', error: (error as Error).message };
    } finally {
      for (const key of keys) environment.environment.release?.(key);
      // Before anything is removed: a process that is still running could write into the directories again.
      try {
        swept = await this.deps.processes.endRun(runId);
      } catch {
        sweepFailed = true;
      }
      await this.removeCheckout(request, checkout);
      await rm(tempDirectory, { recursive: true, force: true });
      await clones?.remove();
    }
    if (swept !== undefined && swept.count > 0) notes.push(`note: ${sweepNote(swept)}\n`);
    if (sweepFailed) notes.push('note: the processes the check may have left behind could not be looked for\n');
    const leftovers = sweepFailed || (swept?.count ?? 0) > 0;

    const durationMs = Date.now() - started;
    const noteText = notes.join('');
    const tail = ring.tailText(TAIL_CHARACTERS);
    const log = Buffer.concat([Buffer.from(noteText), ring.contents()]);
    const outputPath = await this.writeLog(request.swarmId, changesetId ?? `base-${commitId.slice(0, 12)}`, runId, log);
    const common = { durationMs, outputPath, outputTail: (noteText + ring.tailText(Math.max(0, TAIL_CHARACTERS - noteText.length))).slice(0, TAIL_CHARACTERS), truncated: ring.truncated };
    const made = (fields: Partial<CheckRecord> & Pick<CheckRecord, 'outcome'>): CheckRecord => this.record(request, target, commitId, changesetId, { ...fields, ...common }, startedAt);
    // A green base result is stored and reused for every later changeset on this commit: from a run that left processes behind, or whose processes could not be checked, it is no result.
    const done = (record: CheckRecord, unconfirmed?: EnvironmentPattern): Run => {
      const reason = sweepFailed ? 'the processes the check may have left behind could not be looked for; the result is not used as the base' : 'the check left processes behind; they were ended and the result is not used as the base';
      const kept = leftovers && target === 'base' ? made({ outcome: 'not_run', notRunReason: reason.slice(0, 500) }) : record;
      return { record: kept, unconfirmed, output: tail };
    };
    if (cloneFailure !== undefined) return done(made({ outcome: 'not_run', notRunReason: state.cancelled ? 'the check was cancelled' : cloneFailure.slice(0, 500) }));
    if (result === undefined || result.kind === 'cancelled') return done(made({ outcome: 'not_run', notRunReason: 'the check was cancelled' }));
    if (result.kind === 'spawn_failed') return done(made({ outcome: 'not_run', notRunReason: `the ${phase} command did not start: ${result.error}`.slice(0, 500) }));
    if (result.kind === 'timed_out') return done(made({ outcome: 'timed_out', signal: result.signal }));
    let unconfirmed: EnvironmentPattern | undefined;
    if (result.exitCode !== 0) {
      // The code was not tested when its setup failed or the environment failed: the base would fail the same way and make the failure look old.
      if (phase === 'setup') return done(made({ outcome: 'not_run', notRunReason: `the setup command failed with exit ${result.exitCode}; the check command did not run`, exitCode: result.exitCode, signal: result.signal }));
      const problem = findEnvironmentProblem(tail, { confined });
      if (problem !== undefined) return done(made({ outcome: 'not_run', notRunReason: environmentNotRunReason(problem).slice(0, 500), exitCode: result.exitCode, signal: result.signal }));
      unconfirmed = findUnconfirmedProblem(tail);
    }
    return done(made({ outcome: result.exitCode === 0 ? 'passed' : 'failed', exitCode: result.exitCode, signal: result.signal }), unconfirmed);
  }

  private async toolCommand(environment: CheckToolEnvironment, key: string, checkout: string, argv: readonly string[], env: Record<string, string>, network: 'none' | 'development', ownDirs: readonly string[]): Promise<PtyCommand> {
    return environment.toolCommand({ key, cwd: checkout, argv, env, network, writeDirs: [...ownDirs, ...(this.deps.writeDirs?.() ?? [])] });
  }

  private async removeCheckout(request: CheckRequest, checkout: string): Promise<void> {
    try {
      const git = await GuardedGit.open(request.commonDir, { ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
      await git.text(['worktree', 'remove', '--force', '--', checkout]);
    } catch {
      // The checkout never existed or git could not remove it; the directory goes below and prune cleans the record.
    }
    await rm(checkout, { recursive: true, force: true });
    try {
      const git = await GuardedGit.open(request.commonDir, { ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
      await git.text(['worktree', 'prune']);
    } catch {
      // A later prune removes the record.
    }
  }

  private async writeLog(swarmId: string, name: string, runId: string, content: Buffer): Promise<string> {
    const relative = join('review', swarmId, `${name}.${runId}.check.log`);
    const absolute = join(this.deps.dataDir, relative);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, content, { mode: 0o600 });
    return relative;
  }
}
