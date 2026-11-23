import { spawnSync } from 'node:child_process';

/** What a signal does to a process that neither catches nor ignores it, found by sending it. */
export type DefaultAction = 'ends' | 'ignored' | 'stops';

export interface SystemSignal {
  readonly number: number;
  readonly name: string;
  readonly action: DefaultAction;
}

const SIGKILL = 9;
const PROBE_STATUS = 5;

/** The names of `kill -l` in the order of their numbers, which holds for the shell of macOS and of Linux. */
function signalNames(): string[] {
  const listing = spawnSync('/bin/sh', ['-c', 'kill -l'], { encoding: 'utf8' });
  return listing.stdout.split(/\s+/).filter((name) => /^[A-Z][A-Z0-9]*$/.test(name));
}

/**
 * A shell sends the signal to itself and then exits with the probe status: another status or a death is an end, a hang is a stop.
 * The probe runs in its own session like a check does: in the process group of the test runner, TSTP, TTIN and TTOU stop the
 * shell when the runner has a job-control terminal and are dropped when it has none, so the table would depend on how the
 * tests were started. In a new session the group is orphaned and the kernel drops them, so only SIGSTOP suspends a check.
 */
function defaultAction(number: number): DefaultAction {
  if (number === SIGKILL) return 'ends';
  // Node honours `detached` in spawnSync (the child calls setsid), although the typings of SpawnSyncOptions do not list it.
  const options = { timeout: 1_500, killSignal: 'SIGKILL', detached: true } as const;
  const run = spawnSync('/bin/sh', ['-c', `kill -${number} $$; sleep 0.2; exit ${PROBE_STATUS}`], options);
  if (run.error !== undefined) return 'stops';
  return run.status === PROBE_STATUS ? 'ignored' : 'ends';
}

let table: readonly SystemSignal[] | undefined;

/** Every signal of this system with its default action: taken from `kill -l` and from sending each one, not from a list of names. */
export function systemSignals(): readonly SystemSignal[] {
  table ??= signalNames().map((name, index) => ({ number: index + 1, name, action: defaultAction(index + 1) }));
  return table;
}
