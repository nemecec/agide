import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSIDE_PREFIX } from './hostLaunch';
import { INSIDE_SCRIPT, insideArgv, launcherArgv, LAUNCHER_HANDLED_SIGNALS } from './statusLauncher';
import { systemSignals, type SystemSignal } from './signalTable';

const onMac = process.platform === 'darwin';
const macOnly = onMac ? describe : describe.skip;

interface Ended {
  readonly code: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
}

/** Runs argv the way the check does, with Node, in its own process group, so that a signal to the group stays inside it. */
function run(argv: readonly string[], timeoutMs = 10_000, cwd?: string): Promise<Ended> {
  return new Promise((resolve) => {
    const [file = '', ...args] = argv;
    const child = spawn(file, args, { stdio: 'ignore', detached: true, ...(cwd === undefined ? {} : { cwd }) });
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

/** Runs argv like `run` and returns the status and what it wrote to stderr. */
function runCapturing(argv: readonly string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const [file = '', ...args] = argv;
    const child = spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    const chunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('close', (code) => resolve({ code, stderr: Buffer.concat(chunks).toString('utf8') }));
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

  it.each(['.', 'source', 'eval', 'exec', 'trap', 'set', 'export', 'cd', 'umask', 'command', 'builtin', 'return', 'exit', 'break', 'times'])('does not run the first word %j as a shell builtin: the launcher shell keeps its trap and its status', async (word) => {
    const ended = await run(launcherArgv([word, 'echo tests failed; trap - 7; kill -7 $$; exit 1']));
    expect([ended.code === 0, ended.timedOut], `a builtin word cannot make the launcher exit 0 (code ${ended.code}, signal ${ended.signal})`).toEqual([false, false]);
  });

  it('does not let a sourced file, an eval or an exec of the checkpoint end the launcher with status 0', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launcher-builtin-'));
    try {
      const sourced = join(directory, 'dotted.sh');
      writeFileSync(sourced, 'echo tests failed; trap - 7; kill -7 $$; exit 1\n');
      for (const argv of [['.', sourced], ['source', sourced], ['eval', 'echo tests failed; trap - 7; kill -7 $$; exit 1'], ['exec', '/bin/sh', '-c', 'echo tests failed; kill -7 $$; exit 1']]) {
        const ended = await run(launcherArgv(argv));
        expect(ended.code, `${argv[0]} does not run in the launcher: it ends 127 or 126, not 0 (code ${ended.code}, signal ${ended.signal})`).not.toBe(0);
        expect(ended.timedOut, `${argv[0]} does not hang`).toBe(false);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('starts a program through an external env: a missing program is 127 with the env line, and a name with = is not an assignment', async () => {
    const missing = await runCapturing(launcherArgv(['no-such-program-here']));
    expect([missing.code, missing.stderr], 'env names the program it could not find').toEqual([127, 'env: no-such-program-here: No such file or directory\n']);
    const assignment = await runCapturing(launcherArgv(['FOO=bar', 'true']));
    expect([assignment.code, assignment.stderr], 'a first word with = is refused with the line of the toolchain pattern, and the rest never runs').toEqual([127, 'check-launcher: FOO=bar: command not found\n']);
  });

  it('refuses a first word that is . or .. or names a directory like a word with =: 127 and the line of the toolchain pattern, never 126', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launcher-dir-'));
    try {
      mkdirSync(join(directory, 'sub'));
      mkdirSync(join(directory, 'test'));
      for (const word of ['.', '..', './sub', 'sub/', directory]) {
        const refused = await runCapturing(launcherArgv([word], { directory }));
        expect([refused.code, refused.stderr], `the word ${word} is refused`).toEqual([127, `check-launcher: ${word}: command not found\n`]);
      }
      const plain = await runCapturing(launcherArgv(['.']));
      expect(plain.code, 'the plain launcher without a directory refuses it as well').toBe(127);
      const program = join(directory, 'prog');
      writeFileSync(program, '#!/bin/sh\nexit 3\n', { mode: 0o755 });
      expect((await run(launcherArgv(['./prog'], { directory }))).code, 'an executable file with a directory part runs').toBe(3);
      expect((await run(launcherArgv(['test', '-d', 'sub'], { directory }))).code, 'a program found on the PATH runs although a directory of its name is in the checkout').toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ends 126 for a bare word that names a directory and that env finds through a relative or an empty PATH entry: failed, never passed and never a missing program', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launcher-bare-dir-'));
    try {
      mkdirSync(join(directory, 'src'));
      for (const path of ['.:/usr/bin:/bin', ':/usr/bin:/bin', './.:/usr/bin:/bin']) {
        const ended = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
          const [file = '', ...args] = launcherArgv(['src']);
          const child = spawn(file, args, { cwd: directory, env: { PATH: path }, stdio: ['ignore', 'ignore', 'pipe'] });
          const chunks: Buffer[] = [];
          child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
          child.once('close', (code) => resolve({ code, stderr: Buffer.concat(chunks).toString('utf8') }));
        });
        expect([ended.code, ended.stderr.includes('Permission denied')], `PATH ${path}`).toEqual([126, true]);
      }
      const absolute = await run(launcherArgv(['src']), 10_000, directory);
      expect(absolute.code, 'with an absolute PATH the word is not found at all: 127').toBe(127);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('changes into the directory it is given before it runs the program, and fails when it cannot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'launcher-cd-'));
    try {
      const inside = await run(launcherArgv(['sh', '-c', `test "$(pwd -P)" = '${realpathSync(directory)}'`], { directory }));
      expect(inside.code, 'the program runs in the directory').toBe(0);
      const missing = await run(launcherArgv(['true'], { directory: join(directory, 'absent') }));
      expect(missing.code, 'a directory that cannot be entered is status 2, never a pass').toBe(2);
      const bare = await run(launcherArgv([], { directory }));
      expect(bare.code, 'no program is status 2 here as well').toBe(2);
      mkdirSync(join(directory, '-dashed'));
      const dashed = await run(launcherArgv(['sh', '-c', 'exit 5'], { directory: '-dashed' }), 10_000, directory);
      expect(dashed.code, 'a directory name that starts with a dash is a directory and not an option: the program runs there').toBe(5);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes the arguments on as they are, without a second parse by the shell', async () => {
    const ended = await run(launcherArgv(['sh', '-c', 'test "$1" = "a b; exit 9"', 'name', 'a b; exit 9']));
    expect(ended.code, 'an argument with a space and a semicolon arrives whole').toBe(0);
  });
});

describe('the variables that the launcher inside the sandbox sets from their carriers', () => {
  /** Values with the characters a shell would read: quotes, a dollar, backticks, a command substitution, a line break, a backslash and a leading dash. */
  const tricky = { A: `-a"b'c $HOME \`id\` $(id)\nline\\`, B: '-n', IFS: ':', PATH: '/usr/bin:/bin', name: 'loop' };
  const carriers = Object.fromEntries(Object.entries(tricky).map(([name, value]) => [`${INSIDE_PREFIX}${name}`, value]));
  /** A Node program that prints its environment and its pid as JSON. */
  const printer = `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ pid: process.pid, env: process.env }));\n`;

  const started = (argv: readonly string[], env: Record<string, string>, cwd?: string): Promise<{ code: number | null; pid: number | undefined; printed: { pid: number; env: Record<string, string> } | undefined }> =>
    new Promise((resolve) => {
      const [file = '', ...args] = argv;
      const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'ignore'], ...(cwd === undefined ? {} : { cwd }) });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.once('close', (code) => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ code, pid: child.pid, printed: text === '' ? undefined : (JSON.parse(text) as { pid: number; env: Record<string, string> }) });
      });
    });

  let directory: string;
  let program: string;
  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'launcher-inside-')));
    program = join(directory, 'print.cjs');
    writeFileSync(program, printer, { mode: 0o755 });
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  for (const [title, argv] of [
    ['a session', (names: readonly string[]) => insideArgv(names, [program])],
    ['a check', (names: readonly string[]) => launcherArgv([program], { directory, inside: names })],
  ] as const) {
    it(`gives the program of ${title} each listed variable with its exact value and removes the carriers`, async () => {
      const { code, printed } = await started(argv(Object.keys(tricky)), { ...carriers, HOME: '/h' });
      expect(code, 'the program ran').toBe(0);
      expect(Object.fromEntries(Object.keys(tricky).map((name) => [name, printed?.env[name]])), 'each value arrives as it was, never parsed by the shell').toEqual(tricky);
      expect(Object.keys(printed?.env ?? {}).filter((name) => name.startsWith('AGIDE_INSIDE')), 'no carrier and no variable of the route is left').toEqual([]);
      expect(printed?.env['HOME'], 'a host-side variable stays').toBe('/h');
    });

    it(`leaves the program of ${title} without PATH when the list has none, and sets only what the list names`, async () => {
      const { printed } = await started(argv(['A']), { ...carriers, PATH: '/usr/bin:/bin' });
      expect(printed?.env['PATH'], 'the PATH of the host side does not reach the program').toBeUndefined();
      expect(printed?.env['B'], 'a carrier that the list does not name is not set').toBeUndefined();
    });

    it(`refuses a list of ${title} with a name that a shell cannot set: the program does not run and the status is 2`, async () => {
      const { code, printed } = await started(argv(['A', 'X-Y']), { ...carriers, 'AGIDE_INSIDE_X-Y': 'v' });
      expect([code, printed], 'status 2 and nothing printed').toEqual([2, undefined]);
    });
  }

  it.each(['C', 'et_EE.UTF-8', 'en_US.UTF-8'])('sets names with any letter under the locale %s, whose collation decides what a range such as A-Z holds', async (locale) => {
    const names = ['TMPDIR', 'XYZ', 'UVW_2', 'abc'];
    const env = { LC_ALL: locale, ...Object.fromEntries(names.map((name) => [`${INSIDE_PREFIX}${name}`, `v-${name}`])) };
    for (const argv of [insideArgv(names, [program]), launcherArgv([program], { directory, inside: names })]) {
      const { code, printed } = await started(argv, env);
      expect([code, names.map((name) => printed?.env[name])], `every name is set (${argv[2] === INSIDE_SCRIPT ? 'session' : 'check'})`).toEqual([0, names.map((name) => `v-${name}`)]);
    }
  });

  it('replaces the shell with the program of a session, so a signal to srt reaches the program itself', async () => {
    const { pid, printed } = await started(insideArgv([], [program]), {});
    expect(printed?.pid, 'the program has the pid of the started shell').toBe(pid);
  });

  it('keeps the status of the program of a check, and its death by a signal, through the subshell', async () => {
    expect((await run(launcherArgv(['sh', '-c', 'exit 3'], { directory, inside: [] }))).code, 'exit 3').toBe(3);
    expect((await run(launcherArgv(['sh', '-c', 'kill -TERM $$; exit 0'], { directory, inside: [] }))).code, 'a SIGTERM the program sent itself is 143').toBe(143);
    const toParent = `[ "$PPID" = ${process.pid} ] || kill -7 $PPID; sleep 0.2; exit 4`;
    expect((await run(launcherArgv(['sh', '-c', toParent], { directory, inside: [] }))).code, 'a signal to its parent, the launcher, leaves the status of the program').toBe(4);
  });
});
