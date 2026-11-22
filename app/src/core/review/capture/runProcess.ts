import { spawn } from 'node:child_process';
import { OutputRing } from './outputRing';

export const KILL_GRACE_MS = 5_000;

export interface ProcessCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export type ProcessResult =
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null }
  | { readonly kind: 'timed_out'; readonly signal: string | null }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'spawn_failed'; readonly error: string };

export interface RunningProcess {
  readonly result: Promise<ProcessResult>;
  /** Ends the process group: SIGTERM, then SIGKILL after the grace period. */
  cancel(): void;
}

/**
 * Runs a command in its own process group, feeds stdout and stderr in arrival order to `ring` and ends the whole group
 * at the deadline (SIGTERM, then SIGKILL after five seconds) and after the leader exits, so nothing the check started stays.
 */
export function runProcess(command: ProcessCommand, ring: OutputRing, timeoutMs: number): RunningProcess {
  let cancelled = false;
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  let child: ReturnType<typeof spawn> | undefined;

  const endGroup = (signal: NodeJS.Signals): void => {
    if (child?.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group is gone already.
    }
  };
  const stop = (): void => {
    endGroup('SIGTERM');
    killTimer ??= setTimeout(() => endGroup('SIGKILL'), KILL_GRACE_MS);
  };

  const result = new Promise<ProcessResult>((resolve) => {
    const deadline = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    try {
      child = spawn(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      clearTimeout(deadline);
      resolve({ kind: 'spawn_failed', error: (error as Error).message });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => ring.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => ring.push(chunk));
    child.once('error', (error) => {
      clearTimeout(deadline);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve({ kind: 'spawn_failed', error: error.message });
    });
    let finished = false;
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (killTimer !== undefined) clearTimeout(killTimer);
      endGroup('SIGKILL');
      if (cancelled) resolve({ kind: 'cancelled' });
      else if (timedOut) resolve({ kind: 'timed_out', signal });
      else resolve({ kind: 'exited', exitCode, signal });
    };
    // A descendant can keep the pipes open after the leader is gone: the group is ended and the output drained briefly.
    child.once('exit', (exitCode, signal) => {
      endGroup('SIGKILL');
      setTimeout(() => finish(exitCode, signal), 200).unref();
    });
    child.once('close', (exitCode, signal) => finish(exitCode, signal));
  });

  return {
    result,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}
