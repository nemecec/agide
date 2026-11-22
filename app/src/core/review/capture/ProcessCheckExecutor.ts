import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentEnvironment, PtyCommand } from '../../isolation/types';
import type { ChangesetId, CheckRecord } from '../schemas';
import type { ChangesetStore, CheckExecutor, CheckOutcomeSet, CheckRequest } from '../types';
import { cacheEnvironment, checkEnvironment } from './checkEnv';
import { GuardedGit, type GitExec } from './guardedGit';
import { OutputRing } from './outputRing';
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
   * The swarm's cache directory for confined checks: the only writable place besides the checkout and the temporary
   * directory. The home directory and the cache variables of the package managers point into it. Without it a
   * confined check has no cache and fails when its tools need one.
   */
  readonly cacheDirectory?: (swarmId: string) => string;
  /** Directories a check may write besides its checkout, for example a temporary directory. */
  readonly writeDirs?: () => readonly string[];
  readonly exec?: GitExec;
  readonly now?: () => Date;
}

const TAIL_CHARACTERS = 8_000;
/** What a sandbox prints when a tool writes where it may not. */
const SANDBOX_DENIAL = /\bEPERM\b|\bEROFS\b|Operation not permitted|Read-only file system/;

interface Active {
  running: RunningProcess | undefined;
  cancelled: boolean;
}

/**
 * Runs the check command of the base policy in a fresh checkout of the checkpoint, through the isolation provider's
 * `toolCommand`, with a scrubbed environment, a timeout and a capped log (0040 section 6). A failed or timed-out check
 * is a result, not an error; the rules turn it into a reason.
 */
export class ProcessCheckExecutor implements CheckExecutor {
  private readonly active = new Map<ChangesetId, Active>();
  private readonly waiting: { resolve: (granted: boolean) => void; changesetId: ChangesetId }[] = [];
  private running = 0;

  constructor(private readonly deps: CheckExecutorDeps) {}

  async run(request: CheckRequest): Promise<CheckOutcomeSet> {
    const state: Active = { cancelled: false, running: undefined };
    this.active.set(request.changesetId, state);
    try {
      if (!(await this.acquire(request.changesetId))) return { checkpoint: this.notRun(request, 'checkpoint', request.checkpointCommit, request.changesetId, 'the check was cancelled') };
      try {
        const checkpoint = await this.runTarget(request, 'checkpoint', request.checkpointCommit, request.changesetId, state);
        if (checkpoint.outcome !== 'failed' || state.cancelled) return { checkpoint };
        const known = this.deps.store.baseCheck(request.baseCommit, request.policyHash);
        const base = known ?? (await this.runTarget(request, 'base', request.baseCommit, null, state));
        return { checkpoint, base };
      } finally {
        this.release();
      }
    } finally {
      this.active.delete(request.changesetId);
    }
  }

  async cancel(changesetId: ChangesetId): Promise<void> {
    const state = this.active.get(changesetId);
    if (state === undefined) return;
    state.cancelled = true;
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

  private async runTarget(request: CheckRequest, target: 'checkpoint' | 'base', commitId: string, changesetId: ChangesetId | null, state: Active): Promise<CheckRecord> {
    const check = request.policy.check;
    if (check === undefined) return this.notRun(request, target, commitId, changesetId, 'the policy has no check command');
    const environment = await this.deps.environment(request.swarmId).catch((error: unknown) => ({ kind: 'unavailable' as const, why: (error as Error).message }));
    if (environment.kind === 'unavailable') return this.notRun(request, target, commitId, changesetId, environment.why);

    const startedAt = this.stamp();
    const started = Date.now();
    const runId = this.id();
    const checkout = this.deps.checkoutRoot(request.swarmId, runId);
    let git: GuardedGit;
    try {
      git = await GuardedGit.open(request.commonDir, { ...(this.deps.exec === undefined ? {} : { exec: this.deps.exec }) });
      await mkdir(dirname(checkout), { recursive: true, mode: 0o700 });
      await git.text(['worktree', 'add', '--detach', '--force', '--', checkout, commitId]);
    } catch (error) {
      await this.removeCheckout(request, checkout);
      return this.notRun(request, target, commitId, changesetId, `the checkout failed: ${(error as Error).message}`);
    }

    // A private temporary directory next to the checkout: the only writable place besides the checkout, removed with it.
    const tempDirectory = `${checkout}-tmp`;
    const ring = new OutputRing();
    const notes: string[] = [];
    if (check.network === 'none' && !environment.enforcesNetwork) notes.push('note: this provider does not enforce the network limit of the check\n');
    // An unconfined check keeps the home directory of the profile; a confined one writes only below its own directories.
    const cacheDirectory = environment.enforcesNetwork ? this.deps.cacheDirectory?.(request.swarmId) : undefined;
    const env: Record<string, string> = { ...checkEnvironment(environment.profileEnv, check.env), ...(cacheDirectory === undefined ? {} : cacheEnvironment(cacheDirectory)), TMPDIR: tempDirectory, TMP: tempDirectory, TEMP: tempDirectory };
    const deadline = started + check.timeoutSeconds * 1_000;
    let result: Awaited<RunningProcess['result']> | undefined;
    let phase: 'setup' | 'command' = 'command';
    const keys: string[] = [];
    try {
      await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
      if (cacheDirectory !== undefined) await mkdir(env['HOME']!, { recursive: true, mode: 0o700 });
      const steps = [...(check.setup === undefined ? [] : [{ phase: 'setup' as const, argv: check.setup }]), { phase: 'command' as const, argv: check.command }];
      for (const step of steps) {
        phase = step.phase;
        if (state.cancelled) {
          result = { kind: 'cancelled' };
          break;
        }
        const key = `${runId}-${step.phase}`;
        keys.push(key);
        const command = await this.toolCommand(environment.environment, key, checkout, step.argv, env, check.network, [tempDirectory, ...(cacheDirectory === undefined ? [] : [cacheDirectory])]);
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
      await this.removeCheckout(request, checkout);
      await rm(tempDirectory, { recursive: true, force: true });
    }

    const durationMs = Date.now() - started;
    const log = Buffer.concat([Buffer.from(notes.join('')), ring.contents()]);
    const outputPath = await this.writeLog(request.swarmId, changesetId ?? `base-${commitId.slice(0, 12)}`, runId, log);
    const common = { durationMs, outputPath, outputTail: (notes.join('') + ring.tailText(TAIL_CHARACTERS)).slice(-TAIL_CHARACTERS), truncated: ring.truncated };
    if (result === undefined || result.kind === 'cancelled') return this.record(request, target, commitId, changesetId, { outcome: 'not_run', notRunReason: 'the check was cancelled', ...common }, startedAt);
    if (result.kind === 'spawn_failed') return this.record(request, target, commitId, changesetId, { outcome: 'not_run', notRunReason: `the ${phase} command did not start: ${result.error}`.slice(0, 500), ...common }, startedAt);
    if (result.kind === 'timed_out') return this.record(request, target, commitId, changesetId, { outcome: 'timed_out', signal: result.signal, ...common }, startedAt);
    if (result.exitCode !== 0) {
      // The code was not tested when its setup failed or the sandbox denied a tool: the base would fail the same way and make the failure look old.
      if (phase === 'setup') return this.record(request, target, commitId, changesetId, { outcome: 'not_run', notRunReason: `the setup command failed with exit ${result.exitCode}; the check command did not run`, exitCode: result.exitCode, signal: result.signal, ...common }, startedAt);
      if (environment.enforcesNetwork && SANDBOX_DENIAL.test(ring.tailText(TAIL_CHARACTERS))) {
        return this.record(request, target, commitId, changesetId, { outcome: 'not_run', notRunReason: 'the sandbox denied a file access of the check; the project needs more than the checkout, a temporary directory and a cache directory', exitCode: result.exitCode, signal: result.signal, ...common }, startedAt);
      }
    }
    return this.record(request, target, commitId, changesetId, { outcome: result.exitCode === 0 ? 'passed' : 'failed', exitCode: result.exitCode, signal: result.signal, ...common }, startedAt);
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
