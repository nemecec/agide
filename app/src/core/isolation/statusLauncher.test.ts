import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { launcherArgv, LAUNCHER_HANDLED_SIGNALS } from './statusLauncher';
import { systemSignals, type SystemSignal } from './signalTable';

const onMac = process.platform === 'darwin';
const macOnly = onMac ? describe : describe.skip;

interface Ended {
  readonly code: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
}

/** Runs argv the way the check does, with Node, in its own process group, so that a signal to the group stays inside it. */
function run(argv: readonly string[], timeoutMs = 10_000): Promise<Ended> {
  return new Promise((resolve) => {
    const [file = '', ...args] = argv;
    const child = spawn(file, args, { stdio: 'ignore', detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const killGroup = (): void => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // The group is gone.
      }
    };
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      killGroup();
      resolve({ code, signal, timedOut });
    });
  });
}

const launched = (script: string, timeoutMs?: number): Promise<Ended> => run(launcherArgv(['sh', '-c', script]), timeoutMs);

const TARGETS: [string, string][] = [
  ['itself', '$$'],
  ['its process group', '0'],
  ['its parent, the launcher', '$PPID'],
];
const SIGKILL = 9;

macOnly('the launcher shell of a check', () => {
  const signals = systemSignals();

  it('handles every signal that a process can catch and that ends it by default, and no other, by number', () => {
    const ending = signals.filter((entry) => entry.action === 'ends' && entry.number !== SIGKILL).map((entry) => entry.number);
    expect([...LAUNCHER_HANDLED_SIGNALS], 'the list is the signals of this system that end a process by default, without SIGKILL, which cannot be caught').toEqual(ending);
  });

  it('shows why a signal that Node cannot name must not end the launcher: Node reads it as exit 0', async () => {
    const emt = signals.find((entry) => entry.name === 'EMT')!;
    const bare = await run(['sh', '-c', `kill -${emt.number} $$; sleep 0.2; exit 1`]);
    expect([bare.code, bare.signal], 'without the launcher a death by EMT has exit code 0 and no signal').toEqual([0, null]);
    const launched = await run(launcherArgv(['sh', '-c', `kill -${emt.number} $$; sleep 0.2; exit 1`]));
    expect([launched.code, launched.signal], 'under the launcher it is 128 plus the number').toEqual([128 + emt.number, null]);
  });

  const catchable = (action: SystemSignal['action']): SystemSignal[] => signals.filter((entry) => entry.action === action && entry.number !== SIGKILL);

  describe.each(catchable('ends'))('SIG$name (number $number), which ends a process by default', (entry) => {
    it.each(TARGETS.filter(([name]) => name !== 'its parent, the launcher'))('never reads as a pass when it goes to %s: the status is 128 plus the number', async (_name, target) => {
      const ended = await launched(`kill -${entry.number} ${target}; sleep 0.3; exit 0`);
      expect([ended.code, ended.signal, ended.timedOut], 'the launcher outlives the program and hands out its death').toEqual([128 + entry.number, null, false]);
    });

    it('goes to the launcher without ending it: the program runs on and its own status decides', async () => {
      const failing = await launched(`kill -${entry.number} $PPID; sleep 0.2; exit 3`);
      const passing = await launched(`kill -${entry.number} $PPID; sleep 0.2; exit 0`);
      expect([failing.code, passing.code], 'exit 3 stays 3 and exit 0 stays 0').toEqual([3, 0]);
    });
  });

  describe.each(catchable('ignored'))('SIG$name (number $number), which is ignored by default', (entry) => {
    it.each(TARGETS)('goes to %s without effect: the program runs on and its own status decides', async (_name, target) => {
      const failing = await launched(`kill -${entry.number} ${target}; sleep 0.2; exit 3`);
      const passing = await launched(`kill -${entry.number} ${target}; sleep 0.2; exit 0`);
      expect([failing.code, passing.code, failing.timedOut || passing.timedOut], 'exit 3 stays 3 and exit 0 stays 0').toEqual([3, 0, false]);
    });
  });

  describe.each(catchable('stops'))('SIG$name (number $number), which stops a process', (entry) => {
    it.each(TARGETS)('goes to %s: the check is suspended and has no status that reads as a pass', async (_name, target) => {
      const ended = await launched(`kill -${entry.number} ${target}; sleep 0.2; exit 0`, 1_000);
      expect([ended.timedOut, ended.code], 'it hangs until the deadline of the app ends it').toEqual([true, null]);
    });
  });

  it.each(TARGETS)('reads SIGKILL to %s as a death by SIGKILL or as 137, never 0', async (name, target) => {
    const ended = await launched(`kill -9 ${target}; sleep 0.3; exit 0`);
    expect([ended.code, ended.signal], 'itself: the program died and the launcher says 137; the group or the launcher: Node names the signal').toEqual(name === 'itself' ? [137, null] : [null, 'SIGKILL']);
  });

  it('keeps the status of the program through a burst of trapped signals sent to the launcher', async () => {
    const burst = 'i=0; while [ $i -lt 40 ]; do kill -7 $PPID; kill -15 $PPID; kill -2 $PPID; kill -1 $PPID; i=$((i+1)); done; sleep 0.2; exit 4';
    const ended = await launched(burst);
    expect([ended.code, ended.signal], 'the exit status of the program, not 0 and not a signal').toEqual([4, null]);
  });

  it('lets the program end by a signal that the launcher handles: the program does not inherit the handler', async () => {
    const ended = await launched('kill -TERM $$; echo survived > /dev/null; exit 0');
    expect(ended.code, 'a SIGTERM the program sent itself ends it; the status is 143').toBe(143);
    const child = await launched('sleep 60 & pid=$!; kill -TERM $pid; wait $pid; test $? -eq 143');
    expect(child.code, 'a background child that needs SIGTERM to stop ends by it').toBe(0);
  });
});

describe('the launcher shell of a check, on any system', () => {
  it('exits with the status of the program', async () => {
    expect((await launched('exit 0')).code, 'exit 0').toBe(0);
    expect((await launched('exit 3')).code, 'exit 3').toBe(3);
    expect((await launched('exit 255')).code, 'exit 255').toBe(255);
  });

  it('fails when there is no program, and when the program does not exist', async () => {
    expect((await run(launcherArgv([]))).code, 'no program is no pass').toBe(2);
    expect((await run(launcherArgv(['/nonexistent/program']))).code, 'a program that cannot be found ends with 127').toBe(127);
  });

  it('passes the arguments on as they are, without a second parse by the shell', async () => {
    const ended = await run(launcherArgv(['sh', '-c', 'test "$1" = "a b; exit 9"', 'name', 'a b; exit 9']));
    expect(ended.code, 'an argument with a space and a semicolon arrives whole').toBe(0);
  });
});
