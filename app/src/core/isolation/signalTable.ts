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

/** A shell sends the signal to itself and then exits with the probe status: another status or a death is an end, a hang is a stop. */
function defaultAction(number: number): DefaultAction {
  if (number === SIGKILL) return 'ends';
  const run = spawnSync('/bin/sh', ['-c', `kill -${number} $$; sleep 0.2; exit ${PROBE_STATUS}`], { timeout: 1_500, killSignal: 'SIGKILL' });
  if (run.error !== undefined) return 'stops';
  return run.status === PROBE_STATUS ? 'ignored' : 'ends';
}

let table: readonly SystemSignal[] | undefined;

/** Every signal of this system with its default action: taken from `kill -l` and from sending each one, not from a list of names. */
export function systemSignals(): readonly SystemSignal[] {
  table ??= signalNames().map((name, index) => ({ number: index + 1, name, action: defaultAction(index + 1) }));
  return table;
}
