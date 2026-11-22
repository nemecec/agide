import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckProcessSweep, environmentListing, parseMarkedProcesses, parseWorkingDirectories, runOfPath, sweepNote, systemProcessTable, type CheckProcess, type ProcessTable } from './ProcessSweep';
import { removeTempDirs, tempDir } from './gitFixtures';

afterEach(() => removeTempDirs());

const RUN = 'chk_0123456789abcdef';
const OTHER = 'chk_fedcba9876543210';

describe('reading the process listing', () => {
  it('finds the marker and the owner anywhere after the command, and nothing without the exact marker', () => {
    const output = [
      `  101   100 /usr/bin/python3 daemon.py HOME=/h AGIDE_CHECK_RUN=${RUN} AGIDE_CHECK_OWNER=77 TERM=x`,
      `  102   100 sleep 100 AGIDE_CHECK_RUN=${RUN}`,
      '  103   100 node server.js HOME=/h',
      `  104   100 x AGIDE_CHECK_RUN=${RUN}extra`,
      `  105   100 x XAGIDE_CHECK_RUN=${RUN}`,
      `  106   100 x AGIDE_CHECK_RUN=chk_short`,
      `not a process line AGIDE_CHECK_RUN=${RUN}`,
    ].join('\n');
    expect(parseMarkedProcesses(output), 'only the lines with the marker as a whole word; the owner is optional').toEqual([
      { pid: 101, pgid: 100, runId: RUN, owner: 77 },
      { pid: 102, pgid: 100, runId: RUN, owner: undefined },
    ]);
  });

  it('attributes a working directory to the run named by the first directory below a root, and to nothing else', () => {
    const roots = ['/base/review-checks/p', '/base/review-check-caches/p'];
    expect(runOfPath(`/base/review-checks/p/sw1/${RUN}`, roots), 'the checkout').toBe(RUN);
    expect(runOfPath(`/base/review-checks/p/sw1/${RUN}/src/deep`, roots), 'below the checkout').toBe(RUN);
    expect(runOfPath(`/base/review-checks/p/sw1/${RUN}-tmp`, roots), 'the temporary directory').toBe(RUN);
    expect(runOfPath(`/base/review-check-caches/p/${OTHER}/npm`, roots), 'a clone directory').toBe(OTHER);
    expect(runOfPath('/base/review-checks/p/sw1', roots), 'a swarm directory is no run').toBeUndefined();
    expect(runOfPath(`/base/review-checks/p2/sw1/${RUN}`, roots), 'a sibling of a root is not below it').toBeUndefined();
    expect(runOfPath(`/elsewhere/${RUN}`, roots), 'outside every root').toBeUndefined();
    expect(runOfPath(`/base/review-checks/p/sw1/not-${RUN}`, roots), 'a name that only contains an id').toBeUndefined();
  });

  it('reads lsof field output into processes with their group and run', () => {
    const output = ['p10', 'g9', 'fcwd', `n/base/review-checks/p/sw1/${RUN}`, 'p11', 'g11', 'fcwd', 'n/', 'p12', 'g9', 'fcwd', `n/base/review-checks/p/sw1/${OTHER}-tmp`].join('\n');
    expect(parseWorkingDirectories(output, ['/base/review-checks/p']), 'two processes below the root, one at /').toEqual([
      { pid: 10, pgid: 9, runId: RUN },
      { pid: 12, pgid: 9, runId: OTHER },
    ]);
  });

  it('asks ps for the environment on macOS and on Linux and for one process when given a pid', () => {
    expect(environmentListing('darwin'), 'macOS prints the environment with -E').toEqual(['-axwwE', '-o', 'pid=,pgid=,command=']);
    expect(environmentListing('darwin', 5), 'one process').toEqual(['-wwE', '-p', '5', '-o', 'pid=,pgid=,command=']);
    expect(environmentListing('linux'), 'procps prints it with e').toEqual(['axewwo', 'pid=,pgid=,args=']);
  });

  it('names a process by its program only', () => {
    expect(sweepNote({ count: 2, names: ['python3', 'sleep'], remaining: 0 }), 'count and names, nothing else').toBe('2 processes (python3, sleep) left behind by the check and ended');
    expect(sweepNote({ count: 1, names: ['node'], remaining: 1 }), 'a process that stayed').toContain('1 could not be ended');
  });
});

type Listed = Omit<CheckProcess, 'name'> & { name?: string };

/** A table over a mutable list of processes; `inspect` answers from `now`, which a test changes to show pid reuse. */
function fakeTable(initial: Listed[]): { table: ProcessTable; processes: CheckProcess[]; now: Map<number, CheckProcess | undefined>; failList: { on: boolean }; failInspect: { on: boolean } } {
  const processes: CheckProcess[] = initial.map((entry) => ({ name: 'daemon', ...entry }));
  const now = new Map<number, CheckProcess | undefined>();
  const failList = { on: false };
  const failInspect = { on: false };
  return {
    processes,
    now,
    failList,
    failInspect,
    table: {
      list: async () => {
        if (failList.on) throw new Error('ps failed');
        return [...processes];
      },
      inspect: async (pid) => {
        if (failInspect.on) throw new Error('ps failed');
        return now.has(pid) ? now.get(pid) : processes.find((entry) => entry.pid === pid);
      },
    },
  };
}

function sweepOver(table: ProcessTable, options: { alive?: (pid: number) => boolean; onKill?: (pid: number) => void; rounds?: number; vanish?: boolean; fake?: ReturnType<typeof fakeTable> } = {}) {
  const killed: number[] = [];
  const groups: number[] = [];
  const sweep = new CheckProcessSweep({
    table,
    kill: (pid) => {
      killed.push(pid);
      options.onKill?.(pid);
      if (options.vanish !== false && options.fake !== undefined) options.fake.processes.splice(0, options.fake.processes.length, ...options.fake.processes.filter((entry) => entry.pid !== pid));
    },
    killGroup: (pgid) => groups.push(pgid),
    isAlive: options.alive ?? (() => false),
    settle: async () => undefined,
    own: { pid: 1000, pgid: 1000 },
    ...(options.rounds === undefined ? {} : { rounds: options.rounds }),
  });
  return { sweep, killed, groups };
}

describe('ending the processes of a run', () => {
  it('kills each process that carries the run id and its process group, and reports the count and the program names', async () => {
    const fake = fakeTable([
      { pid: 50, pgid: 50, runId: RUN, owner: 1000, name: 'python3' },
      { pid: 51, pgid: 50, runId: RUN, owner: 1000, name: 'sleep' },
      { pid: 52, pgid: 52, runId: RUN, owner: 1000, name: 'python3' },
    ]);
    const { sweep, killed, groups } = sweepOver(fake.table, { fake });
    const outcome = await sweep.endRun(RUN);
    expect(killed.sort(), 'every process of the run was killed').toEqual([50, 51, 52]);
    expect([...new Set(groups)].sort(), 'and its process group').toEqual([50, 52]);
    expect(outcome, 'count of processes, program names once each, none left').toEqual({ count: 3, names: ['python3', 'sleep'], remaining: 0 });
  });

  it('leaves processes without a marker and processes of another run alone', async () => {
    const fake = fakeTable([{ pid: 60, pgid: 60, runId: OTHER, owner: 1000 }]);
    const { sweep, killed, groups } = sweepOver(fake.table, { fake });
    expect(await sweep.endRun(RUN), 'nothing of this run').toEqual({ count: 0, names: [], remaining: 0 });
    expect([killed, groups], 'no signal went out').toEqual([[], []]);
  });

  it('reads the marker again before the signal, so a pid that now belongs to another process is not killed', async () => {
    const fake = fakeTable([{ pid: 70, pgid: 70, runId: RUN, owner: 1000 }]);
    fake.now.set(70, undefined);
    const { sweep, killed, groups } = sweepOver(fake.table, { fake, rounds: 1 });
    const outcome = await sweep.endRun(RUN);
    expect([killed, groups], 'the pid carries no marker any more').toEqual([[], []]);
    expect(outcome.count, 'and it does not count as a survivor').toBe(0);
    fake.now.set(70, { pid: 70, pgid: 70, name: 'other', runId: OTHER, owner: 1000 });
    const second = sweepOver(fake.table, { fake, rounds: 1 });
    await second.sweep.endRun(RUN);
    expect(second.killed, 'a marker of another run is no reason either').toEqual([]);
  });

  it('never signals the app itself or its process group, and not pid 1', async () => {
    const fake = fakeTable([
      { pid: 1000, pgid: 1000, runId: RUN, owner: 1000 },
      { pid: 1, pgid: 1, runId: RUN, owner: 1000 },
      { pid: 80, pgid: 1000, runId: RUN, owner: 1000 },
    ]);
    const { sweep, killed, groups } = sweepOver(fake.table, { rounds: 1 });
    await sweep.endRun(RUN);
    expect(killed, 'only the process that is not the app').toEqual([80]);
    expect(groups, 'the group of the app is spared').toEqual([]);
  });

  it('looks again after the kills and ends a process that was forked in between', async () => {
    const fake = fakeTable([{ pid: 90, pgid: 90, runId: RUN, owner: 1000, name: 'first' }]);
    const { sweep, killed } = sweepOver(fake.table, {
      fake,
      onKill: (pid) => {
        if (pid === 90) fake.processes.push({ pid: 91, pgid: 91, runId: RUN, owner: 1000, name: 'second' });
      },
    });
    const outcome = await sweep.endRun(RUN);
    expect(killed, 'the child that appeared while the parent was dying was found by the next round').toEqual([90, 91]);
    expect(outcome, 'both are counted').toEqual({ count: 2, names: ['first', 'second'], remaining: 0 });
  });

  it('reports what it could not end', async () => {
    const fake = fakeTable([{ pid: 95, pgid: 95, runId: RUN, owner: 1000 }]);
    const { sweep } = sweepOver(fake.table, { fake, vanish: false, rounds: 2 });
    expect(await sweep.endRun(RUN), 'the process is still listed after the last round').toEqual({ count: 1, names: ['daemon'], remaining: 1 });
  });

  it('stops reading and killing when the time of the sweep is used up, and counts what is left as remaining', async () => {
    const fake = fakeTable(Array.from({ length: 50 }, (_, index) => ({ pid: 200 + index, pgid: 200 + index, runId: RUN, owner: 1000 as number | undefined, name: 'many' })));
    let clock = 0;
    const killed: number[] = [];
    const sweep = new CheckProcessSweep({
      table: { ...fake.table, inspect: async (pid) => { clock += 1_000; return fake.table.inspect(pid); } },
      kill: (pid) => killed.push(pid),
      killGroup: () => undefined,
      isAlive: () => false,
      settle: async () => undefined,
      own: { pid: 1000, pgid: 1000 },
      budgetMilliseconds: 5_000,
      now: () => clock,
    });
    const outcome = await sweep.endRun(RUN);
    expect(killed.length, 'only the processes read within the budget were ended, not all fifty').toBe(5);
    expect(outcome.remaining, 'the others are still listed and reported').toBe(50);
    expect(outcome.count, 'the count is never below what remains').toBe(50);
  });

  it('does not cut a sweep that finishes within its time', async () => {
    const fake = fakeTable([{ pid: 300, pgid: 300, runId: RUN, owner: 1000 }]);
    const sweep = new CheckProcessSweep({ table: fake.table, kill: () => void fake.processes.splice(0), killGroup: () => undefined, isAlive: () => false, settle: async () => undefined, own: { pid: 1000, pgid: 1000 }, budgetMilliseconds: 1, now: () => 0 });
    expect(await sweep.endRun(RUN), 'a clock that never advances never expires').toEqual({ count: 1, names: ['daemon'], remaining: 0 });
  });

  it('rejects when the table cannot be read, so the caller cannot take the silence for a clean result', async () => {
    const fake = fakeTable([{ pid: 96, pgid: 96, runId: RUN, owner: 1000 }]);
    fake.failList.on = true;
    await expect(sweepOver(fake.table).sweep.endRun(RUN), 'a failed listing').rejects.toThrow('ps failed');
    fake.failList.on = false;
    fake.failInspect.on = true;
    await expect(sweepOver(fake.table).sweep.endRun(RUN), 'a failed read of one process').rejects.toThrow('ps failed');
  });
});

describe('ending the processes of earlier runs', () => {
  it('ends processes of runs that are not live and whose app is gone or is this app, and no others', async () => {
    const fake = fakeTable([
      { pid: 110, pgid: 110, runId: OTHER, owner: 1000, name: 'of-this-app' },
      { pid: 111, pgid: 111, runId: OTHER, owner: 2000, name: 'of-a-dead-app' },
      { pid: 112, pgid: 112, runId: OTHER, owner: 3000, name: 'of-a-live-app' },
      { pid: 113, pgid: 113, runId: OTHER, owner: undefined, name: 'by-directory' },
      { pid: 114, pgid: 114, runId: RUN, owner: 1000, name: 'of-a-live-run' },
    ]);
    const { sweep, killed } = sweepOver(fake.table, { fake, alive: (pid) => pid !== 2000 });
    const outcome = await sweep.endStale(new Set([RUN]));
    expect(killed.sort(), 'the live run and the run of another live app stay').toEqual([110, 111, 113]);
    expect(outcome.names, 'the names in the evidence').toEqual(['by-directory', 'of-a-dead-app', 'of-this-app']);
  });

  it('ends the processes of an earlier run of this app although the app is alive, since no run of it is live', async () => {
    const fake = fakeTable([{ pid: 120, pgid: 120, runId: OTHER, owner: 1000, name: 'earlier-run' }]);
    const { sweep, killed } = sweepOver(fake.table, { fake, alive: () => true });
    await sweep.endStale(new Set());
    expect(killed, 'the owner is this app, which is alive, and the run is not in flight').toEqual([120]);
  });

  it('ends a process that only its working directory attributes to an earlier run, whose owner nobody knows', async () => {
    const fake = fakeTable([{ pid: 121, pgid: 121, runId: OTHER, owner: undefined, name: 'by-directory' }]);
    const { sweep, killed } = sweepOver(fake.table, { fake, alive: () => true });
    await sweep.endStale(new Set());
    expect(killed, 'an app that is alive cannot vouch for it: no marker names an owner').toEqual([121]);
  });

  it('leaves a process of a run that is not live alone while the app that started it is alive', async () => {
    const fake = fakeTable([{ pid: 122, pgid: 122, runId: OTHER, owner: 3000, name: 'of-another-app' }]);
    const { sweep, killed } = sweepOver(fake.table, { fake, alive: () => true });
    expect(await sweep.endStale(new Set()), 'nothing is ended').toMatchObject({ count: 0 });
    expect(killed, 'the other app may still be running that check').toEqual([]);
  });

  it('finds nothing when no run left a process', async () => {
    const fake = fakeTable([]);
    expect(await sweepOver(fake.table, { fake }).sweep.endStale(new Set()), 'nothing found').toEqual({ count: 0, names: [], remaining: 0 });
  });
});

describe('the host process table', () => {
  const marked = (pid: number, pgid: number, run: string, owner: number) => `${String(pid).padStart(5)} ${String(pgid).padStart(5)} /x/prog arg HOME=/h AGIDE_CHECK_RUN=${run} AGIDE_CHECK_OWNER=${owner}`;

  function table(options: { ps?: string; lsof?: string; names?: string; psCode?: number; lsofCode?: number; calls?: string[][] } = {}) {
    return systemProcessTable({
      roots: ['/base/checks'],
      platform: 'darwin',
      exec: async (file, args) => {
        options.calls?.push([file, ...args]);
        if (file === 'lsof') return { stdout: options.lsof ?? '', code: options.lsofCode ?? 0 };
        if (args.includes('pid=,comm=')) return { stdout: options.names ?? '', code: 0 };
        return { stdout: options.ps ?? '', code: options.psCode ?? 0 };
      },
    });
  }

  it('joins the marker of ps and the working directory of lsof, and names each process by the program that comm gives', async () => {
    const found = await table({
      ps: [marked(10, 10, RUN, 7), marked(12, 12, RUN, 7)].join('\n'),
      lsof: ['p10', 'g10', 'fcwd', 'n/', 'p11', 'g11', 'fcwd', `n/base/checks/sw/${OTHER}`, 'p12', 'g12', 'fcwd', `n/base/checks/sw/${RUN}`].join('\n'),
      names: '   10 /usr/bin/python3\n   11 /bin/sleep\n   12 /usr/bin/node\n',
    }).list();
    expect(found, 'the marker names pid 10; pid 11 hides its environment and is found by its directory; pid 12 has both, which agree').toEqual([
      { pid: 11, pgid: 11, runId: OTHER, owner: undefined, name: 'sleep' },
      { pid: 12, pgid: 12, runId: RUN, owner: 7, name: 'node' },
      { pid: 10, pgid: 10, runId: RUN, owner: 7, name: 'python3' },
    ]);
  });

  it('keeps the run of the working directory when a marker names another run, and ignores the owner of that marker', async () => {
    const found = await table({
      ps: marked(10, 10, OTHER, 1),
      lsof: ['p10', 'g10', 'fcwd', `n/base/checks/sw/${RUN}`].join('\n'),
      names: '   10 /usr/bin/python3\n',
    }).list();
    expect(found, 'the process belongs to the run whose directory it is in, with no owner that a forged marker could set, so the start sweep can end it').toEqual([{ pid: 10, pgid: 10, runId: RUN, owner: undefined, name: 'python3' }]);
  });

  it('drops a process that is gone before its name is read', async () => {
    expect(await table({ ps: marked(10, 10, RUN, 7), names: '' }).list(), 'no name, no process').toEqual([]);
  });

  it('rejects a listing whose ps or lsof failed', async () => {
    await expect(table({ psCode: 1 }).list(), 'ps failed').rejects.toThrow('could not be read');
    await expect(table({ lsofCode: 1 }).list(), 'lsof failed').rejects.toThrow('could not be read');
  });

  it('inspects one process and ignores the other processes that lsof prints', async () => {
    const calls: string[][] = [];
    const one = await table({
      calls,
      ps: marked(10, 10, RUN, 7),
      lsof: ['p10', 'g10', 'fcwd', 'n/', 'p99', 'g99', 'fcwd', `n/base/checks/sw/${OTHER}`].join('\n'),
      names: '10 /usr/bin/python3\n',
    }).inspect(10);
    expect(one, 'the process asked for').toMatchObject({ pid: 10, runId: RUN });
    expect(await table({ lsof: ['p99', 'g99', 'fcwd', `n/base/checks/sw/${OTHER}`].join('\n'), names: '99 /bin/sleep\n' }).inspect(10), 'lsof lists everything for a pid that is gone; none of it is this pid').toBeUndefined();
    expect(calls.some((call) => call.includes('-p') && call.includes('10')), 'both tools were asked for the one pid').toBe(true);
    expect(calls.filter((call) => call[0] === 'lsof').every((call) => call[1] === '-a'), 'lsof is asked to AND its selections, so it lists the working directory of the pid only').toBe(true);
  });
});

describe('real processes', () => {
  const live: number[] = [];
  afterEach(() => {
    for (const pid of live.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const gone = async (pid: number): Promise<boolean> => {
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    return !alive(pid);
  };
  const posix = process.platform === 'darwin' || process.platform === 'linux';

  it.skipIf(!posix)('ends a detached process by the marker in its environment and by its working directory, and leaves a process of another run', async () => {
    const root = realpathSync(tempDir('sweep-real'));
    const checkout = join(root, 'sw', RUN);
    mkdirSync(checkout, { recursive: true });
    const env = { PATH: process.env['PATH'] ?? '', AGIDE_CHECK_RUN: RUN, AGIDE_CHECK_OWNER: String(process.pid) };
    // `detached` makes the child call setsid: a process group kill of the run would not reach it.
    const byMarker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env });
    const byDirectory = spawn('/bin/sleep', ['300'], { detached: true, stdio: 'ignore', cwd: checkout, env: { PATH: env.PATH } });
    const ofAnotherRun = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env: { ...env, AGIDE_CHECK_RUN: OTHER } });
    for (const child of [byMarker, byDirectory, ofAnotherRun]) {
      child.unref();
      live.push(child.pid!);
    }
    const sweep = new CheckProcessSweep({ table: systemProcessTable({ roots: [join(root)] }) });
    // The table needs a moment to show the new processes.
    let outcome = await sweep.endRun(RUN);
    for (let i = 0; i < 20 && outcome.count < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const next = await sweep.endRun(RUN);
      outcome = { count: outcome.count + next.count, names: [...new Set([...outcome.names, ...next.names])].sort(), remaining: next.remaining };
    }
    expect(outcome.count, 'the process with the marker and the process in the checkout directory').toBe(2);
    expect([await gone(byMarker.pid!), await gone(byDirectory.pid!)], 'both are dead although neither is in a group of the app').toEqual([true, true]);
    expect(alive(ofAnotherRun.pid!), 'the process of another run is untouched').toBe(true);
    expect((await sweep.endRun(RUN)).count, 'a second sweep finds nothing').toBe(0);
  }, 20_000);

  it.skipIf(!posix)('ends the process of an app that is gone at the start of a run and leaves the process of an app that lives', async () => {
    const root = realpathSync(tempDir('sweep-stale'));
    const finished = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    await new Promise((resolve) => finished.once('exit', resolve));
    const spawnOwned = (run: string, owner: number) =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env: { PATH: process.env['PATH'] ?? '', AGIDE_CHECK_RUN: run, AGIDE_CHECK_OWNER: String(owner) } });
    const ofGoneApp = spawnOwned(RUN, finished.pid!);
    const ofLiveApp = spawnOwned(OTHER, process.ppid);
    for (const child of [ofGoneApp, ofLiveApp]) {
      child.unref();
      live.push(child.pid!);
    }
    const sweep = new CheckProcessSweep({ table: systemProcessTable({ roots: [root] }) });
    let found = 0;
    // A loaded machine shows a new process late: wait by the clock, not by the number of listings.
    for (const deadline = Date.now() + 12_000; Date.now() < deadline && found === 0; ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      found = (await sweep.endStale(new Set())).count;
    }
    expect(found, 'the process of the gone app was found').toBe(1);
    expect([await gone(ofGoneApp.pid!), alive(ofLiveApp.pid!)], 'it is dead; the process of an app that lives is untouched').toEqual([true, true]);
  }, 20_000);
});
