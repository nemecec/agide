import { spawn } from 'node:child_process';
import { requireAbsoluteFile } from '../../isolation/hostTools';
import { IsolationError } from '../../isolation/types';
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
  /** `error` is a fixed text that names no path; `detail` is the message of the system, for the log of the run. */
  | { readonly kind: 'spawn_failed'; readonly error: string; readonly detail?: string | undefined };

const SPAWN_FAILURES: Readonly<Record<string, string>> = {
  EACCES: 'the program is not executable, or a directory of its path cannot be searched',
  ENOENT: 'the program or its working directory does not exist',
  ENOEXEC: 'the program has a format that the system cannot run',
};

/**
 * A text for an error by its code only: the message of a system error names the file (`spawn /Users/<name>/... EACCES`),
 * which can name the user. `texts` gives the text of a known code; another code is appended to `what`.
 */
export function codeText(error: unknown, what: string, texts: Readonly<Record<string, string>> = {}): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(code)) return what;
  return texts[code] ?? `${what} (${code})`;
}

const spawnFailure = (error: unknown): ProcessResult => ({
  kind: 'spawn_failed',
  error: error instanceof IsolationError ? error.message : codeText(error, 'the program could not be started', SPAWN_FAILURES),
  detail: (error as Error).message,
});

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
      requireAbsoluteFile(command);
      child = spawn(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      clearTimeout(deadline);
      resolve(spawnFailure(error));
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => ring.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => ring.push(chunk));
    child.once('error', (error) => {
      clearTimeout(deadline);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve(spawnFailure(error));
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
