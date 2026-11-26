import { realpath } from 'node:fs/promises';
import { basename, sep } from 'node:path';
import { systemExecFile, systemExecFileSync } from '../../isolation/hostTools';

/**
 * Ends the processes a check run left behind (0040 section 6). A process group kill does not reach a process that
 * called `setsid`, so every run carries a marker in its environment (`AGIDE_CHECK_RUN=<run id>`, which every
 * descendant inherits, a detached one too) and the app, running outside the sandbox, finds processes by it. A second
 * attribution covers what the marker cannot: macOS hides the environment of a process whose image is a protected
 * system program (`/bin/sh`, `/bin/sleep`), so a process whose working directory lies below the run's own directories
 * is attributed to the run as well. Neither is a secret: the run id is random and public.
 */

export const CHECK_RUN_VARIABLE = 'AGIDE_CHECK_RUN';
export const CHECK_OWNER_VARIABLE = 'AGIDE_CHECK_OWNER';

/** A process that belongs to a check run. */
export interface CheckProcess {
  readonly pid: number;
  readonly pgid: number;
  /** The program name, never its arguments or environment. */
  readonly name: string;
  readonly runId: string;
  /** The pid of the app that started the run; undefined when only the working directory attributes the process. */
  readonly owner: number | undefined;
}

export interface ProcessTable {
  /** Every process attributed to some run. Rejects when the table cannot be read. */
  list(): Promise<readonly CheckProcess[]>;
  /** The attribution of one process as it is now; undefined when it is gone or has none. Rejects when it cannot be read. */
  inspect(pid: number): Promise<CheckProcess | undefined>;
}

/** What a sweep found. `remaining` counts the processes still listed after the last kill. */
export interface SweepOutcome {
  readonly count: number;
  /** Program names, each once, sorted. */
  readonly names: readonly string[];
  readonly remaining: number;
}

/** What the check executor needs of the sweep. Both calls reject when the process table cannot be read. */
export interface CheckProcesses {
  /** Ends the processes of this run; called when the run ends. */
  endRun(runId: string): Promise<SweepOutcome>;
  /** Ends the processes of runs that are not in `live` and whose app is gone or is this one; called when a run starts. */
  endStale(live: ReadonlySet<string>): Promise<SweepOutcome>;
}

export const sweepNote = (outcome: SweepOutcome): string => `${outcome.count} ${outcome.count === 1 ? 'process' : 'processes'} (${outcome.names.join(', ') || 'unnamed'}) ${outcome.remaining > 0 ? `left behind by the check, ${outcome.remaining} could not be ended` : 'left behind by the check and ended'}`;

const RUN_ID = /^chk_[0-9a-f]{16}$/;
const MARKER = new RegExp(`(?:^|\\s)${CHECK_RUN_VARIABLE}=(chk_[0-9a-f]{16})(?=\\s|$)`);
const OWNER = new RegExp(`(?:^|\\s)${CHECK_OWNER_VARIABLE}=(\\d+)(?=\\s|$)`);

/** Reads `ps -axwwE -o pid=,pgid=,command=`: the environment follows the arguments, so the marker is found anywhere in the line. */
export function parseMarkedProcesses(output: string): { pid: number; pgid: number; runId: string; owner: number | undefined }[] {
  const found: { pid: number; pgid: number; runId: string; owner: number | undefined }[] = [];
  for (const line of output.split('\n')) {
    const columns = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    const marker = columns === null ? null : MARKER.exec(columns[3]!);
    if (columns === null || marker === null) continue;
    const owner = OWNER.exec(columns[3]!);
    found.push({ pid: Number(columns[1]), pgid: Number(columns[2]), runId: marker[1]!, owner: owner === null ? undefined : Number(owner[1]) });
  }
  return found;
}

/** Reads `lsof -F pgn -d cwd`: the processes whose working directory is `root` or below it, for the roots given. */
export function parseWorkingDirectories(output: string, roots: readonly string[]): { pid: number; pgid: number; runId: string }[] {
  const found: { pid: number; pgid: number; runId: string }[] = [];
  let pid = 0;
  let pgid = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('g')) pgid = Number(line.slice(1));
    else if (line.startsWith('n') && pid > 0) {
      const runId = runOfPath(line.slice(1), roots);
      if (runId !== undefined) found.push({ pid, pgid, runId });
    }
  }
  return found;
}

/** The run a path belongs to: its first segment below a root is the run's directory (`<run id>` or `<run id>-tmp`), possibly below a swarm directory. */
export function runOfPath(path: string, roots: readonly string[]): string | undefined {
  for (const root of roots) {
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (!path.startsWith(prefix)) continue;
    for (const segment of path.slice(prefix.length).split(sep).slice(0, 2)) {
      const id = segment.endsWith('-tmp') ? segment.slice(0, -4) : segment;
      if (RUN_ID.test(id)) return id;
    }
  }
  return undefined;
}

type Exec = (file: 'ps' | 'lsof', args: readonly string[]) => Promise<{ stdout: string; code: number }>;

const run: Exec = (file, args) =>
  new Promise((resolve, reject) => {
    systemExecFile(file, args, { maxBuffer: 256 * 1024 * 1024 }, (error, stdout) => {
      if (error === null) resolve({ stdout, code: 0 });
      else if (typeof error.code === 'number') resolve({ stdout, code: error.code });
      else reject(error);
    });
  });

/** The `ps` arguments that print the environment after the command; `ps` runs outside the sandbox, so it can read it. */
export const environmentListing = (platform: NodeJS.Platform, pids?: number): string[] => {
  const columns = ['-o', 'pid=,pgid=,command='];
  if (platform === 'darwin') return pids === undefined ? ['-axwwE', ...columns] : ['-wwE', '-p', String(pids), ...columns];
  return pids === undefined ? ['axewwo', 'pid=,pgid=,args='] : ['ewwo', 'pid=,pgid=,args=', '-p', String(pids)];
};

export interface SystemTableOptions {
  /** Directories whose children are the directories of runs: the checkout root and the clone root. */
  readonly roots: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly exec?: Exec;
}

/** The process table of the host: `ps` for the environment marker, `lsof` for working directories. */
export function systemProcessTable(options: SystemTableOptions): ProcessTable {
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? run;
  const names = async (pids: readonly number[]): Promise<Map<number, string>> => {
    const out = new Map<number, string>();
    if (pids.length === 0) return out;
    const { stdout } = await exec('ps', ['-o', 'pid=,comm=', '-p', pids.join(',')]);
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (match !== null) out.set(Number(match[1]), basename(match[2]!.trim()));
    }
    return out;
  };
  const attribute = async (marked: ReturnType<typeof parseMarkedProcesses>, directories: ReturnType<typeof parseWorkingDirectories>): Promise<CheckProcess[]> => {
    const byPid = new Map<number, Omit<CheckProcess, 'name'>>();
    for (const entry of directories) byPid.set(entry.pid, { ...entry, owner: undefined });
    // The check controls its environment, so a marker that disagrees with the working directory does not replace the directory's run.
    for (const entry of marked) {
      const directory = byPid.get(entry.pid);
      byPid.set(entry.pid, directory !== undefined && directory.runId !== entry.runId ? directory : entry);
    }
    const known = await names([...byPid.keys()]);
    return [...byPid.values()].filter((entry) => known.has(entry.pid)).map((entry) => ({ ...entry, name: known.get(entry.pid)! }));
  };
  /** `lsof` prints resolved paths, so the roots are given in both spellings. */
  const rootSpellings = async (): Promise<string[]> => [...new Set([...options.roots, ...(await Promise.all(options.roots.map((root) => realpath(root).catch(() => root))))])];
  const read = async (pid?: number): Promise<CheckProcess[]> => {
    const [ps, lsof] = await Promise.all([exec('ps', environmentListing(platform, pid)), exec('lsof', ['-a', '-nP', '-w', '-d', 'cwd', '-F', 'pgn', ...(pid === undefined ? [] : ['-p', String(pid)])])]);
    if (pid === undefined && (ps.code !== 0 || lsof.code !== 0)) throw new Error(`the process list could not be read (ps exit ${ps.code}, lsof exit ${lsof.code})`);
    const only = <T extends { pid: number }>(entries: T[]): T[] => (pid === undefined ? entries : entries.filter((entry) => entry.pid === pid));
    return attribute(only(parseMarkedProcesses(ps.stdout)), only(parseWorkingDirectories(lsof.stdout, await rootSpellings())));
  };
  return { list: () => read(), inspect: async (pid) => (await read(pid))[0] };
}

export interface SweepOptions {
  readonly table: ProcessTable;
  readonly kill?: (pid: number) => void;
  readonly killGroup?: (pgid: number) => void;
  readonly isAlive?: (pid: number) => boolean;
  /** Waits between rounds; a round finds what the previous kills left or what a dying process forked. */
  readonly settle?: (milliseconds: number) => Promise<void>;
  /** The app's own pid and process group, which are never killed. */
  readonly own?: { readonly pid: number; readonly pgid: number };
  readonly rounds?: number;
  /** The time one sweep may take; the run holds the check slot meanwhile. */
  readonly budgetMilliseconds?: number;
  readonly now?: () => number;
}

const ROUNDS = 6;
const SETTLE_MS = 100;
const BUDGET_MS = 30_000;

const signal = (send: () => void): void => {
  try {
    send();
  } catch {
    // The process is gone already.
  }
};

export class CheckProcessSweep implements CheckProcesses {
  private readonly kill: (pid: number) => void;
  private readonly killGroup: (pgid: number) => void;
  private readonly isAlive: (pid: number) => boolean;
  private readonly settle: (milliseconds: number) => Promise<void>;
  private readonly own: { readonly pid: number; readonly pgid: number };
  private readonly rounds: number;
  private readonly budget: number;
  private readonly now: () => number;

  constructor(private readonly options: SweepOptions) {
    this.kill = options.kill ?? ((pid) => process.kill(pid, 'SIGKILL'));
    this.killGroup = options.killGroup ?? ((pgid) => process.kill(-pgid, 'SIGKILL'));
    this.isAlive = options.isAlive ?? signalZero;
    this.settle = options.settle ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.own = options.own ?? { pid: process.pid, pgid: safePgid() };
    this.rounds = options.rounds ?? ROUNDS;
    this.budget = options.budgetMilliseconds ?? BUDGET_MS;
    this.now = options.now ?? Date.now;
  }

  endRun(runId: string): Promise<SweepOutcome> {
    return this.end((entry) => entry.runId === runId);
  }

  endStale(live: ReadonlySet<string>): Promise<SweepOutcome> {
    return this.end((entry) => !live.has(entry.runId) && (entry.owner === undefined || entry.owner === this.own.pid || !this.isAlive(entry.owner)));
  }

  private async end(select: (entry: CheckProcess) => boolean): Promise<SweepOutcome> {
    const found = new Map<number, string>();
    const expires = this.now() + this.budget;
    for (let round = 0; round < this.rounds; round++) {
      const targets = (await this.options.table.list()).filter(select);
      if (targets.length === 0) return outcome(found, 0);
      for (const target of targets) {
        // Reading one process takes a tenth of a second or more, so a run with very many survivors would hold the check slot for minutes. What is not ended in time is counted as remaining.
        if (this.now() >= expires) {
          const left = (await this.options.table.list()).filter(select).length;
          return { ...outcome(found, left), count: Math.max(found.size, left) };
        }
        // The pid can belong to another process by now; the marker or directory is read again right before the signal.
        const current = await this.options.table.inspect(target.pid);
        if (current === undefined || !select(current)) continue;
        found.set(current.pid, current.name);
        this.terminate(current);
      }
      await this.settle(SETTLE_MS);
    }
    return outcome(found, (await this.options.table.list()).filter(select).length);
  }

  private terminate(entry: CheckProcess): void {
    if (entry.pid <= 1 || entry.pid === this.own.pid) return;
    signal(() => this.kill(entry.pid));
    if (entry.pgid > 1 && entry.pgid !== this.own.pgid) signal(() => this.killGroup(entry.pgid));
  }
}

const outcome = (found: ReadonlyMap<number, string>, remaining: number): SweepOutcome => ({ count: found.size, names: [...new Set(found.values())].sort(), remaining });

function signalZero(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Node has no `getpgid`; 0 (no group is spared) when `ps` cannot say. */
function safePgid(): number {
  try {
    return Number(systemExecFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)]).trim()) || 0;
  } catch {
    return 0;
  }
}
