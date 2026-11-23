import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findExecutable, srtToolEnvironment } from '../../isolation/index';
import { systemSignals } from '../../isolation/signalTable';
import { findTestSrt, srtTestsUnavailable } from '../../isolation/testRuntimes';
import { DEFAULT_REVIEW_POLICY, type ReviewPolicy } from '../policy/schema';
import { assess } from '../rules/ruleFixtures';
import { maxRung } from '../rungs';
import type { CheckRecord } from '../schemas';
import type { ToolLaunch } from '../../isolation/types';
import type { CheckRequest } from '../types';
import { CheckClones } from './CheckClones';
import { checkDenyRead, claudeConfigPaths } from './checkDenyRead';
import { makeRepo, removeTempDirs, sh, tempDir, write, type Repo } from './gitFixtures';
import { ProcessCheckExecutor } from './ProcessCheckExecutor';
import { CheckProcessSweep, systemProcessTable } from './ProcessSweep';

/**
 * The check under the real `srt` with the real clone call and real tools. They run only where `srt` and the tool
 * exist; the unit tests of the executor and the clones cover the logic without either.
 */

const unavailable = srtTestsUnavailable();
const suite = unavailable === undefined ? describe : describe.skip;
const toolTest = (tool: string, extra: () => boolean = () => true) => (unavailable === undefined && findExecutable(tool) !== undefined && extra() ? it : it.skip);

let repo: Repo | undefined;
afterEach(() => {
  repo?.cleanup();
  repo = undefined;
  removeTempDirs();
});

const POLICY_HASH = 'e'.repeat(64);

interface Rig {
  readonly repo: Repo;
  readonly home: string;
  readonly clonesRoot: string;
  readonly dataDir: string;
  /** The data directory of a profile that is not the one of the executor, and the registry of the app root. */
  readonly siblingFiles: { readonly profile: string; readonly registry: string };
  /** What `ps` and `lsof` attribute to the runs of this rig now. */
  survivors(): Promise<readonly { pid: number; name: string }[]>;
  run(command: string[], patch?: Partial<NonNullable<ReviewPolicy['check']>>): ReturnType<ProcessCheckExecutor['run']>;
  cancel(): Promise<void>;
}

/** The stored green result of the base: most tests are about the checkpoint run and skip the base run with it; `base: 'run'` runs the base. */
const greenBase = (commitId: string): CheckRecord => ({ id: 'chk_stored_green', changesetId: null, target: 'base', commitId, policyHash: POLICY_HASH, command: ['x'], outcome: 'passed', notRunReason: null, exitCode: 0, signal: null, durationMs: 1, outputPath: null, outputTail: '', truncated: false, startedAt: '2026-11-21T10:00:00.000Z', endedAt: '2026-11-21T10:00:01.000Z' });

/** An executor over the real srt. `home` is the home directory the check sees: a fixture directory unless a test needs the real toolchains. */
function rig(files: Record<string, string | Buffer>, options: { home?: string; extraFiles?: Record<string, string>; env?: Record<string, string>; executables?: string[]; base?: 'run' | 'stored'; loopback?: boolean } = {}): Rig {
  repo = makeRepo({ 'base.txt': 'base\n', ...files });
  for (const path of options.executables ?? []) chmodSync(join(repo.main, path), 0o755);
  for (const [path, content] of Object.entries(options.extraFiles ?? { 'agent.txt': 'agent\n' })) write(join(repo.main, path), content);
  sh(repo.main, ['add', '-A']);
  sh(repo.main, ['commit', '-q', '--no-verify', '-m', 'checkpoint']);
  const checkpoint = sh(repo.main, ['rev-parse', 'HEAD']).trim();
  const home = options.home ?? tempDir('srt-home');
  const appRoot = tempDir('srt-app');
  const dataDir = join(appRoot, 'profiles', 'current', 'data');
  write(join(dataDir, 'review', 'other-swarm', 'patch'), 'the diff of another swarm\n');
  const siblingFiles = { profile: join(appRoot, 'profiles', 'sibling', 'data', 'review', 'swarm', 'patch'), registry: join(appRoot, 'registry', 'profiles.json') };
  write(siblingFiles.profile, 'the diff of a swarm of another profile\n');
  write(siblingFiles.registry, 'the registry of the app\n');
  const srtBinary = findTestSrt()!;
  const settingsDir = join(tempDir('srt-settings'), 'srt');
  const srt = srtToolEnvironment({ srtBinary, settingsDir, extraDenyRead: checkDenyRead({ agent: undefined, appRoot, appDirs: [], claude: claudeConfigPaths({ configured: undefined, home }), home }) });
  // The daemon tests bind loopback ports: they ask for the loopback that only a tool entry (Gradle) grants a check otherwise.
  const environment = options.loopback === true ? { ...srt, toolCommand: (launch: ToolLaunch) => srt.toolCommand({ ...launch, loopback: true }) } : srt;
  const clonesRoot = join(repo.root, 'clones');
  const r = repo;
  const table = systemProcessTable({ roots: [join(r.root, 'checks'), clonesRoot] });
  const processes = new CheckProcessSweep({ table });
  const executor = new ProcessCheckExecutor({
    environment: async () => ({ kind: 'ready', environment, profileEnv: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, ...(process.env['JAVA_HOME'] === undefined ? {} : { JAVA_HOME: process.env['JAVA_HOME'] }), ...options.env }, enforcesNetwork: true }),
    checkoutRoot: (swarmId, runId) => join(r.root, 'checks', swarmId, runId),
    dataDir,
    clones: new CheckClones({ root: clonesRoot }),
    processes,
    store: { baseCheck: () => (options.base === 'run' ? undefined : greenBase(r.base)) },
    maxConcurrent: () => 1,
  });
  return {
    repo: r,
    home,
    clonesRoot,
    dataDir,
    siblingFiles,
    // The table is system-wide: processes that other test files started with a marker of their own are not this rig's runs.
    survivors: async () => (await table.list()).filter((entry) => entry.owner === undefined || entry.owner === process.pid).map((entry) => ({ pid: entry.pid, name: entry.name })),
    cancel: () => executor.cancel('cs_aaaaaaaaaaaaaaaa'),
    run: (command, patch = {}) =>
      executor.run({
        changesetId: 'cs_aaaaaaaaaaaaaaaa',
        swarmId: 'sw1',
        commonDir: r.commonDir,
        checkpointCommit: checkpoint,
        baseCommit: r.base,
        policyHash: POLICY_HASH,
        policy: { ...DEFAULT_REVIEW_POLICY, check: { command, timeoutSeconds: 170, network: 'none', env: [], ...patch } },
      } satisfies CheckRequest),
  };
}

/** Names, sizes and modification times of a tree, links not followed. */
function listing(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      out.push(`${path.slice(root.length)} ${stat.isDirectory() ? 'dir' : stat.isSymbolicLink() ? `link ${readlinkSync(path)}` : stat.size} ${stat.mtimeMs}`);
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(root);
  return out;
}

suite(`the check under the real srt${unavailable === undefined ? '' : ` [unavailable: ${unavailable}]`}`, () => {
  it('lets a run write into its clones and leaves the real directories, a second run and the base run untouched', async () => {
    const home = tempDir('srt-home-poison');
    write(join(home, '.npm', '_cacache', 'entry'), 'cached\n');
    write(join(home, '.cargo', 'registry', 'cache', 'crate'), 'crate\n');
    write(join(home, '.cargo', 'registry', 'index', 'entry'), 'index\n');
    const r = rig({ 'package.json': '{}\n', 'Cargo.toml': '[package]\n' }, { home, base: 'run' });
    const before = listing(home);
    const script = [
      'if [ -f agent.txt ]; then',
      '  echo "script-shell=/tmp/evil" > "$npm_config_cache/.npmrc"',
      '  echo evil > "$CARGO_HOME/registry/cache/crate"',
      '  echo shim > "$CARGO_HOME/registry/cache/shim"',
      '  exit 1',
      'fi',
      'test ! -e "$npm_config_cache/.npmrc" && test "$(cat "$CARGO_HOME/registry/cache/crate")" = crate && test ! -e "$CARGO_HOME/registry/cache/shim"',
    ].join('\n');
    const first = await r.run(['sh', '-c', script]);
    expect([first.checkpoint.outcome, first.base?.outcome], `the agent run fails after poisoning its clones and the base run passes: ${first.checkpoint.outputTail}`).toEqual(['failed', 'passed']);
    expect(listing(home), 'the real directories hold the same names, sizes and times').toEqual(before);
    const second = await r.run(['sh', '-c', 'test ! -e "$npm_config_cache/.npmrc" && test "$(cat "$CARGO_HOME/registry/cache/crate")" = crate']);
    expect(second.checkpoint.outcome, `a later run starts from the pristine caches: ${second.checkpoint.outputTail}`).toBe('passed');
    expect(readdirSync(r.clonesRoot), 'every clone directory is gone').toEqual([]);
  });

  it('refuses a write into the home directory and ends not_run with the reason', async () => {
    const r = rig({ 'package.json': '{}\n' });
    const result = await r.run(['sh', '-c', 'echo planted > "$HOME/planted"']);
    expect(result.checkpoint.outcome, `a write outside the checkout, the temporary directory and the clones is refused: ${result.checkpoint.outputTail}`).toBe('not_run');
    expect(result.checkpoint.notRunReason, 'the reason names the sandbox').toContain('the sandbox denied a file access');
    expect(existsSync(join(r.home, 'planted')), 'nothing was written').toBe(false);
  });

  it('refuses to read the data directory of the app and a credential location of the home directory', async () => {
    const r = rig({ 'package.json': '{}\n' });
    write(join(r.home, '.ssh', 'id'), 'private\n');
    const data = await r.run(['sh', '-c', `cat '${join(r.dataDir, 'review', 'other-swarm', 'patch')}'`]);
    expect([data.checkpoint.outcome, data.checkpoint.outputTail?.includes('the diff of another swarm')], 'the data directory cannot be read and its content is not in the output').toEqual(['not_run', false]);
    const sibling = await r.run(['sh', '-c', `cat '${r.siblingFiles.profile}'`]);
    expect([sibling.checkpoint.outcome, sibling.checkpoint.outputTail?.includes('another profile')], 'nor the data directory of another profile').toEqual(['not_run', false]);
    const registry = await r.run(['sh', '-c', `cat '${r.siblingFiles.registry}'`]);
    expect([registry.checkpoint.outcome, registry.checkpoint.outputTail?.includes('registry of the app')], 'nor the registry in the app root').toEqual(['not_run', false]);
    const ssh = await r.run(['sh', '-c', `cat '${join(r.home, '.ssh', 'id')}'`]);
    expect([ssh.checkpoint.outcome, ssh.checkpoint.outputTail?.includes('private')], 'nor a credential location').toEqual(['not_run', false]);
    write(join(r.home, '.claude', 'projects', 'transcript.jsonl'), 'the transcript of an agent\n');
    const claude = await r.run(['sh', '-c', `cat '${join(r.home, '.claude', 'projects', 'transcript.jsonl')}'`]);
    expect([claude.checkpoint.outcome, claude.checkpoint.outputTail?.includes('transcript of an agent')], 'nor the Claude directory of the default login').toEqual(['not_run', false]);
    const open = await r.run(['sh', '-c', 'cat base.txt']);
    expect(open.checkpoint.outcome, 'the checkout stays readable').toBe('passed');
  });

  it('does not give the check anything of the environment of the app that is not listed', async () => {
    const r = rig({ 'package.json': '{}\n' });
    process.env['AGIDE_TEST_APP_ONLY'] = 'present-in-the-app';
    try {
      const result = await r.run(['sh', '-c', 'test -z "$AGIDE_TEST_APP_ONLY" && test -n "$HOME" && test "$CI" = 1']);
      expect(result.checkpoint.outcome, `the check env has HOME and CI and not the variable of the app: ${result.checkpoint.outputTail}`).toBe('passed');
    } finally {
      delete process.env['AGIDE_TEST_APP_ONLY'];
    }
  });

  /**
   * srt 0.0.83 exits 0 when the program ends by SIGINT or SIGTERM, and Node reads a death by a signal it has no name
   * for (SIGEMT on macOS) as exit 0. A check that prints a failure and then sends any signal to itself, to its process
   * group or to its parent shell must still be `failed`: the launcher shell of `launcherArgv` handles every signal it
   * can and exits with the status of the program. The signals are those of this system, taken from `kill -l` and
   * sorted by what each does to a process by default, not from a list of names.
   */
  const FAILS = 'echo "tests: 3 failed";';
  const signalling = (target: string, signal: number, status: number): string => `${FAILS} kill -${signal} ${target}; sleep 1; exit ${status}`;
  const TARGETS: [string, string][] = [
    ['itself', '$$'],
    ['its process group', '0'],
    ['its parent shell', '$PPID'],
  ];
  const SIGNALS = systemSignals();
  const byAction = (action: string) => SIGNALS.filter((entry) => entry.action === action).flatMap((entry) => TARGETS.map(([name, target]) => [`SIG${entry.name} (${entry.number}) to ${name}`, entry.number, target] as const));

  it.each(byAction('ends'))('reads %s and then a failure as failed, never as passed', async (_name, signal, target) => {
    const r = rig({});
    const result = await r.run(['sh', '-c', signalling(target, signal, 1)]);
    expect(result.checkpoint.outcome, `the failing test is not reported as passed (exit ${result.checkpoint.exitCode}, signal ${result.checkpoint.signal}): ${result.checkpoint.outputTail}`).toBe('failed');
    expect(result.checkpoint.exitCode, 'the status that came out of srt is not 0').not.toBe(0);
  }, 60_000);

  it.each(byAction('ignored'))('reads %s as no effect: the program runs on and its own status decides', async (_name, signal, target) => {
    const r = rig({});
    const failing = await r.run(['sh', '-c', signalling(target, signal, 3)]);
    expect([failing.checkpoint.outcome, failing.checkpoint.exitCode], 'exit 3 is a failure with status 3').toEqual(['failed', 3]);
    const passing = await r.run(['sh', '-c', signalling(target, signal, 0)]);
    expect(passing.checkpoint.outcome, 'exit 0 is a pass').toBe('passed');
  }, 60_000);

  it.each([
    ['TERM', 143],
    ['INT', 130],
    ['HUP', 129],
  ])('hands out 128 plus the number when SIG%s goes to the whole group, which srt itself cannot be reached by', async (signal, status) => {
    const r = rig({});
    const result = await r.run(['sh', '-c', `kill -${signal} 0; sleep 1`]);
    expect([result.checkpoint.outcome, result.checkpoint.exitCode], 'the status of the death by the signal').toEqual(['failed', status]);
  }, 60_000);

  it('reads a runner that signals its group with a signal Node cannot name, or that cleans up with kill 0 before it exits 0, as failed', async () => {
    const r = rig({});
    const scripts: Record<string, string> = {
      'node: process.kill(0, 7), then exit 1': `${FAILS} node -e 'process.kill(0, 7); setTimeout(() => process.exit(1), 800)'`,
      'a burst of trapped signals at the launcher, then exit 1': `${FAILS} i=0; while [ $i -lt 30 ]; do kill -7 $PPID; kill -15 $PPID; kill -2 $PPID; i=$((i+1)); done; sleep 0.3; exit 1`,
      'a cleanup trap with kill 0 and a background process, then exit 0': 'sleep 30 & trap "kill 0" EXIT; exit 0',
    };
    const outcomes: Record<string, string> = {};
    for (const [name, script] of Object.entries(scripts)) outcomes[name] = (await r.run(['bash', '-c', script])).checkpoint.outcome;
    expect(outcomes, 'each is failed, none is passed').toEqual(Object.fromEntries(Object.keys(scripts).map((name) => [name, 'failed'])));
  }, 120_000);

  it('reads an exit status modulo 256 as the kernel hands it out, so a status of 256 is a pass and a normalized one is not', async () => {
    const r = rig({});
    expect((await r.run(['sh', '-c', 'exit 256'])).checkpoint.outcome, 'exit 256 is status 0').toBe('passed');
    expect((await r.run(['sh', '-c', 'sh -c "exit 256" || exit 1'])).checkpoint.outcome, 'the kernel truncated the status before the wrapper saw it, so the wrapper cannot repair it').toBe('passed');
    expect((await r.run(['sh', '-c', 'sh -c "exit 3" || exit 1'])).checkpoint.exitCode, 'a command that normalizes its status with || exit 1 reports 1').toBe(1);
  }, 60_000);

  it('reads the signals of programs that trap, ignore, exec or end by themselves as the program ends', async () => {
    const r = rig({});
    const scripts: Record<string, string> = {
      'a trap that exits 1': 'trap "exit 1" TERM; kill -TERM 0; sleep 1; exit 1',
      'an ignored signal and exit 1': 'trap "" TERM; kill -TERM 0; sleep 1; exit 1',
      'node that signals itself': `${FAILS} node -e 'process.kill(process.pid, "SIGTERM"); setTimeout(() => process.exit(1), 1000)'`,
      'exec of a program that signals itself': `${FAILS} exec node -e 'process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 1000)'`,
      'a signal after which the program would go on': 'kill -TERM $$; echo survived; exit 0',
    };
    const outcomes: Record<string, string> = {};
    for (const [name, script] of Object.entries(scripts)) {
      const result = await r.run(['sh', '-c', script]);
      outcomes[name] = `${result.checkpoint.outcome}${result.checkpoint.outputTail?.includes('survived') === true ? ' and survived' : ''}`;
    }
    expect(outcomes, 'each is failed; the program does not go on after a SIGTERM it sent itself').toEqual(Object.fromEntries(Object.keys(scripts).map((name) => [name, 'failed'])));
    expect((await r.run(['sh', '-c', 'trap "" TERM; kill -TERM 0; sleep 1; exit 0'])).checkpoint.outcome, 'an ignored signal and the program\'s own exit 0 is a pass').toBe('passed');
  }, 120_000);

  it('keeps pass, fail, timeout and cancel as they were', async () => {
    const r = rig({});
    const [passed, failed, slow] = [await r.run(['sh', '-c', 'exit 0']), await r.run(['sh', '-c', 'exit 3']), await r.run(['sh', '-c', 'sleep 30'], { timeoutSeconds: 2 })];
    expect([passed.checkpoint.outcome, passed.checkpoint.exitCode], 'exit 0').toEqual(['passed', 0]);
    expect([failed.checkpoint.outcome, failed.checkpoint.exitCode], 'exit 3').toEqual(['failed', 3]);
    expect(slow.checkpoint.outcome, 'the timeout of the app, which ends the group with SIGTERM').toBe('timed_out');
    const c = rig({});
    const running = c.run(['sh', '-c', 'sleep 30']);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await c.cancel();
    expect((await running).checkpoint.notRunReason, 'a cancel ends the run as not_run').toBe('the check was cancelled');
  }, 120_000);

  it('lets a process that the check started end on SIGTERM, since the launcher handles the signal and the program does not inherit that', async () => {
    const r = rig({});
    const result = await r.run(['sh', '-c', 'sleep 60 & child=$!; kill -TERM $child; wait $child; test $? -eq 143']);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'a background child that needs SIGTERM to stop ends by it').toMatchObject(['passed', expect.any(String)]);
  }, 60_000);

  /** A TCP server of this process: the stand-in for a service of the host on loopback (a database, a development server, the app's MCP server). */
  async function withLoopbackService<T>(use: (port: number) => Promise<T>): Promise<T> {
    const server = createSocketServer((socket) => socket.end('hello\n'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      return await use((server.address() as { port: number }).port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  const connectTo = (port: number): string[] => ['node', '-e', `const c = require('net').connect(${port}, '127.0.0.1'); c.on('data', () => { console.log('REACHED'); process.exit(0); }); c.on('error', (e) => { console.log('REFUSED ' + e.code); process.exit(1); });`];

  it('refuses a connection to a loopback service of the host under network none, and to a loopback port the check binds, for a tool that does not need loopback', async () => {
    await withLoopbackService(async (port) => {
      const r = rig({ 'package.json': '{}\n' });
      const result = await r.run(connectTo(port));
      expect(result.checkpoint.outputTail, 'the sandbox refuses the connect').toContain('REFUSED EPERM');
      expect(result.checkpoint.outcome, 'and the check is not a pass').not.toBe('passed');
      const bind = await r.run(['node', '-e', "require('net').createServer().listen(0, '127.0.0.1').on('error', (e) => { console.log('BIND ' + e.code); process.exit(1); })"]);
      expect(bind.checkpoint.outputTail, 'binding a loopback port is refused too').toContain('BIND EPERM');
    });
  }, 120_000);

  it('admits loopback connections when a command of the policy names a tool that needs a loopback port, which reaches the services of the host', async () => {
    await withLoopbackService(async (port) => {
      const r = rig({ 'build.gradle': '\n' });
      const result = await r.run([...connectTo(port), 'gradlew']);
      expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'the Gradle entry sets allowLocalBinding, and srt pairs it with loopback connections').toMatchObject(['passed', expect.stringContaining('REACHED')]);
    });
  }, 120_000);

  it('refuses loopback to a check whose agent added a Gradle marker, while its command is not Gradle', async () => {
    await withLoopbackService(async (port) => {
      const r = rig({ 'package.json': '{}\n' }, { extraFiles: { 'agent.txt': 'agent\n', 'tools/build.gradle': '\n' } });
      const result = await r.run(connectTo(port));
      expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'a marker in the checkpoint does not open loopback').toMatchObject(['not_run', expect.stringContaining('REFUSED EPERM')]);
    });
  }, 120_000);

  toolTest('cargo', () => findExecutable('rustup') !== undefined && existsSync(join(homedir(), '.cargo', 'registry')))('runs cargo through rustup with CARGO_HOME at a clone and the real home readable', async () => {
    const r = rig({ 'Cargo.toml': '[package]\nname = "tiny"\nversion = "0.1.0"\nedition = "2021"\n', 'src/lib.rs': '' }, { home: homedir() });
    const cargoHome = join(homedir(), '.cargo');
    const subtrees = [join(cargoHome, 'registry', 'cache'), join(cargoHome, 'registry', 'index')];
    const before = subtrees.map(listing);
    const result = await r.run(['sh', '-c', 'cargo --version && test "$CARGO_HOME" != "$HOME/.cargo" && cargo metadata --offline --format-version 1 > /dev/null']);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'cargo starts and reads a manifest under confinement').toMatchObject(['passed', expect.stringContaining('cargo 1.')]);
    expect(subtrees.map(listing), 'the names, sizes and times of the real registry cache and index are the same').toEqual(before);
  }, 180_000);

  /** A loopback port that nothing listens on now. */
  async function freePort(): Promise<number> {
    const server = createSocketServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  const portIsFree = async (port: number): Promise<boolean> => {
    const server = createSocketServer();
    return new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
  };

  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /** The program of the daemon tests: with the agent's file present it forks a detached daemon and fails; without it, it needs the port itself. */
  const HOLDER = [
    'import os, socket, sys, time',
    'port = int(sys.argv[1])',
    'mode = sys.argv[2]',
    'if not os.path.exists("agent.txt"):',
    '    s = socket.socket()',
    '    s.bind(("127.0.0.1", port))',
    '    sys.exit(0)',
    'read, write = os.pipe()',
    'child = os.fork()',
    'if child == 0:',
    '    os.setsid()',
    '    if mode == "image":',
    '        os.write(write, b"x")',
    '        os.execv("/bin/sleep", ["sleep", "300"])',
    '    s = socket.socket()',
    '    s.bind(("127.0.0.1", port))',
    '    s.listen(1)',
    '    os.write(write, b"x")',
    '    time.sleep(300)',
    '    os._exit(0)',
    'os.read(read, 1)',
    'print("daemon", child, flush=True)',
    'time.sleep(0.2)',
    'sys.exit(1)',
    '',
  ].join('\n');

  const daemonPid = (output: string | null | undefined): number => Number(/daemon (\d+)/.exec(output ?? '')?.[1]);

  toolTest('python3')('ends a daemon that the checkpoint run detached with setsid and bound a port with, so the base run of the next capture does not meet the port', async () => {
    const r = rig({ 'holder.py': HOLDER }, { base: 'run', loopback: true });
    const port = await freePort();
    const result = await r.run(['python3', 'holder.py', String(port), 'port']);
    expect(result.checkpoint.outcome, `the checkpoint run fails with exit 1 after it left a daemon: ${result.checkpoint.outputTail}`).toBe('failed');
    expect(result.checkpoint.outputTail, 'the card evidence names the program that was ended').toMatch(/note: 1 process \((?:Python|python3?)[^)]*\) left behind by the check and ended/);
    expect(result.base?.outcome, 'the base run came first and bound the port itself').toBe('passed');
    expect([alive(daemonPid(result.checkpoint.outputTail)), await portIsFree(port)], 'the daemon is dead and its port is free after the run').toEqual([false, true]);
    expect(await r.survivors(), 'ps and lsof attribute no process to a run any more').toEqual([]);
    const next = await r.run(['python3', '-c', `import socket; socket.socket().bind(('127.0.0.1', ${port}))`]);
    expect([next.checkpoint.outcome, next.checkpoint.outputTail?.includes('left behind')], `the next run binds the port and finds no survivor: ${next.checkpoint.outputTail}`).toEqual(['passed', false]);
  }, 60_000);

  toolTest('python3')('ends a detached process whose image hides its environment by its working directory', async () => {
    const r = rig({ 'holder.py': HOLDER }, { loopback: true });
    const result = await r.run(['python3', 'holder.py', '1', 'image']);
    expect(result.checkpoint.outputTail, `/bin/sleep is a system program: ps cannot show its environment, the working directory in the checkout attributes it: ${result.checkpoint.outputTail}`).toContain('left behind by the check and ended');
    expect([alive(daemonPid(result.checkpoint.outputTail)), await r.survivors()], 'the process is dead and no process is attributed to a run').toEqual([false, []]);
  }, 60_000);

  /**
   * The attack of the review of the check-clone pass: a double-forked daemon that executes python with an empty
   * environment (no marker), changed its directory to `/` (no working directory of the run) and holds a port; the
   * checkpoint run then exits 1. Neither channel of the sweep names the daemon, so the next capture's base run can
   * meet the port and fail. Whatever the sweep finds, the rung stays at C.
   */
  const HIDER = [
    'import os, socket, sys, time',
    'port = int(sys.argv[1])',
    'if not os.path.exists("agent.txt"):',
    '    s = socket.socket()',
    '    s.bind(("127.0.0.1", port))',
    '    sys.exit(0)',
    'read, write = os.pipe()',
    'os.set_inheritable(write, True)',
    'listener = "import os, socket, sys, time\\ns = socket.socket()\\ns.bind((\'127.0.0.1\', int(sys.argv[1])))\\ns.listen(1)\\nos.write(int(sys.argv[2]), str(os.getpid()).encode())\\ntime.sleep(300)"',
    'if os.fork() == 0:',
    '    os.setsid()',
    '    if os.fork() == 0:',
    '        os.chdir("/")',
    '        os.execve(sys.executable, [sys.executable, "-c", listener, str(port), str(write)], {})',
    '    os._exit(0)',
    'print("daemon", int(os.read(read, 16)), flush=True)',
    'time.sleep(0.2)',
    'sys.exit(1)',
    '',
  ].join('\n');

  /** The command of the second capture: it needs the port, as a test run that starts a server does, and fails on the checkpoint anyway. */
  const NEEDS_PORT = 'import os, socket, sys; s = socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1]))); sys.exit(1 if os.path.exists("agent.txt") else 0)';

  const rungOf = (result: Awaited<ReturnType<Rig['run']>>): { rung: string; reasons: string[] } => {
    const reasons = assess({ check: { checkpoint: result.checkpoint.outcome, base: result.base?.outcome ?? 'not_run' } });
    return { rung: maxRung('A', ...reasons.map((reason) => reason.minRung)), reasons: reasons.map((reason) => reason.id) };
  };

  toolTest('python3')('puts a changeset at rung C, never B, when a hidden survivor of an earlier capture made its base run fail', async () => {
    const r = rig({ 'hider.py': HIDER }, { base: 'run', loopback: true });
    const port = await freePort();
    let daemon = Number.NaN;
    try {
      const first = await r.run(['python3', 'hider.py', String(port)]);
      daemon = daemonPid(first.checkpoint.outputTail);
      const one = rungOf(first);
      expect([first.checkpoint.outcome, first.base?.outcome, one.rung], `the first capture: base green first, then the checkpoint run that hides a daemon and exits 1: ${first.checkpoint.outputTail}`).toEqual(['failed', 'passed', 'C']);
      const second = await r.run(['python3', '-c', NEEDS_PORT, String(port)]);
      const two = rungOf(second);
      expect(second.checkpoint.outcome, `the second capture fails on its checkpoint: ${second.checkpoint.outputTail}`).toBe('failed');
      expect(two.rung, `whatever the sweep found (base ${second.base?.outcome}: ${second.base?.outputTail}), a failed base run never lowers the rung: the reasons are ${two.reasons.join(', ')}`).toBe('C');
      expect(two.reasons.filter((id) => id.startsWith('check.')), 'the reason is check.base_red when the survivor made the base red and check.failed when the sweep ended it').toEqual([second.base?.outcome === 'failed' ? 'check.base_red' : 'check.failed']);
    } finally {
      if (Number.isFinite(daemon)) {
        try {
          process.kill(daemon, 'SIGKILL');
        } catch {
          // The sweep ended it.
        }
      }
    }
  }, 120_000);

  /** A registry on loopback with one package, a warm cache for npm or pnpm, and the registry address. */
  async function serveFixtureLibrary(): Promise<{ readonly origin: string; stop(): Promise<void> }> {
    const packageDir = tempDir('registry-package');
    write(join(packageDir, 'package.json'), JSON.stringify({ name: 'agide-fixture-lib', version: '1.0.0', main: 'index.js' }));
    write(join(packageDir, 'index.js'), 'module.exports = 42;\n');
    const packed = execFileSync('npm', ['pack', '--silent', '--pack-destination', packageDir], { cwd: packageDir, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: tempDir('registry-pack-home') } }).trim().split('\n').pop()!;
    const tarball = readFileSync(join(packageDir, packed));
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    let origin = '';
    const packument = (): string => JSON.stringify({ name: 'agide-fixture-lib', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'agide-fixture-lib', version: '1.0.0', dist: { tarball: `${origin}/agide-fixture-lib/-/agide-fixture-lib-1.0.0.tgz`, integrity, shasum: createHash('sha1').update(tarball).digest('hex') } } } });
    const server: Server = createServer((request, response) => {
      if (request.url?.endsWith('.tgz') === true) response.end(tarball);
      else response.setHeader('content-type', 'application/json').end(packument());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { origin, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  const exec = promisify(execFile);
  const appManifest = JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'agide-fixture-lib': '^1.0.0' } });

  toolTest('npm')('installs a package from the cloned npm cache offline', async () => {
    const registry = await serveFixtureLibrary();
    const home = tempDir('npm-home');
    try {
      // Asynchronous: a synchronous call would block this process, which serves the registry.
      await exec('npm', ['install', 'agide-fixture-lib', '--registry', registry.origin, '--no-audit', '--no-fund', '--prefix', tempDir('npm-warm')], { env: { PATH: process.env['PATH'] ?? '', HOME: home, npm_config_cache: join(home, '.npm') } });
    } finally {
      await registry.stop();
    }
    expect(existsSync(join(home, '.npm', '_cacache')), 'the warm-up filled the fixture cache').toBe(true);
    const r = rig({ 'package.json': appManifest }, { home });
    const before = listing(home);
    const result = await r.run(['sh', '-c', `npm install --offline --no-audit --no-fund --registry '${registry.origin}' && node -e "if (require('agide-fixture-lib') !== 42) process.exit(1)"`]);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'the install is served from the cloned cache with the server gone').toMatchObject(['passed', expect.any(String)]);
    expect(listing(home), 'the fixture cache holds what the warm-up wrote and nothing from the check').toEqual(before);
  }, 120_000);

  toolTest('pnpm')('installs a package from the cloned pnpm store offline with a lock file', async () => {
    const registry = await serveFixtureLibrary();
    // The real home directory: pnpm is a corepack shim whose binary lives below it. The store is a fixture, found through the host environment of the rig.
    const store = join(tempDir('pnpm-store'), 'store');
    const cache = tempDir('pnpm-cache');
    const warm = tempDir('pnpm-warm');
    write(join(warm, 'package.json'), appManifest);
    try {
      await exec('pnpm', ['install', '--registry', registry.origin, '--store-dir', store], { cwd: warm, env: { PATH: process.env['PATH'] ?? '', HOME: homedir(), pnpm_config_cache_dir: cache, CI: '1' } });
    } finally {
      await registry.stop();
    }
    const lock = readFileSync(join(warm, 'pnpm-lock.yaml'), 'utf8');
    const r = rig({ 'package.json': appManifest, 'pnpm-lock.yaml': lock }, { home: homedir(), env: { pnpm_config_store_dir: store, pnpm_config_cache_dir: cache } });
    const before = listing(store);
    const result = await r.run(['sh', '-c', `pnpm install --offline --frozen-lockfile --registry '${registry.origin}' && node -e "if (require('agide-fixture-lib') !== 42) process.exit(1)"`]);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'the install is served from the cloned store with the server gone').toMatchObject(['passed', expect.any(String)]);
    expect(listing(store), 'the fixture store is untouched').toEqual(before);
  }, 120_000);

  toolTest('pip')('points pip at its clone', async () => {
    const home = tempDir('pip-home');
    write(join(home, 'Library', 'Caches', 'pip', 'http', 'entry'), 'cached\n');
    write(join(home, '.cache', 'pip', 'http', 'entry'), 'cached\n');
    const r = rig({ 'requirements.txt': '' }, { home });
    const result = await r.run(['sh', '-c', 'test "$(pip cache dir)" -ef "$PIP_CACHE_DIR" && test -f "$PIP_CACHE_DIR/http/entry"']);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'pip reads the cloned cache').toMatchObject(['passed', expect.any(String)]);
  }, 60_000);

  toolTest('uv')('points uv at its clone', async () => {
    const home = tempDir('uv-home');
    write(join(home, '.cache', 'uv', 'entry'), 'cached\n');
    const r = rig({ 'uv.lock': '' }, { home });
    const result = await r.run(['sh', '-c', 'test "$(uv cache dir)" -ef "$UV_CACHE_DIR" && test -f "$UV_CACHE_DIR/entry"']);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'uv reads the cloned cache').toMatchObject(['passed', expect.any(String)]);
  }, 60_000);

  toolTest('mvn')('resolves a parent POM from the cloned Maven repository offline, and writes only into the clone', async () => {
    const home = tempDir('mvn-home');
    write(join(home, '.m2', 'repository', 'example', 'invalid', 'parent', '1', 'parent-1.pom'), '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example.invalid</groupId><artifactId>parent</artifactId><version>1</version><packaging>pom</packaging><properties><from.parent>yes</from.parent></properties></project>\n');
    const pom = '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><parent><groupId>example.invalid</groupId><artifactId>parent</artifactId><version>1</version><relativePath>nowhere/pom.xml</relativePath></parent><artifactId>child</artifactId><packaging>pom</packaging></project>\n';
    const r = rig({ 'pom.xml': pom }, { home });
    const before = listing(join(home, '.m2'));
    const result = await r.run(['mvn', '-o', '-q', 'validate']);
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'Maven found the parent in the clone').toMatchObject(['passed', expect.any(String)]);
    expect(listing(join(home, '.m2')), 'the real repository is untouched').toEqual(before);
  }, 120_000);

  const gradleVersion = (): string | undefined => {
    const dists = join(homedir(), '.gradle', 'wrapper', 'dists');
    const have = existsSync(join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'org.slf4j', 'slf4j-api', '2.0.17'));
    if (!have || !existsSync(dists)) return undefined;
    return readdirSync(dists).find((name) => /^gradle-\d+\.\d+(\.\d+)?-bin$/.test(name))?.replace(/^gradle-/, '').replace(/-bin$/, '');
  };

  toolTest('gradle', () => gradleVersion() !== undefined)('resolves a dependency offline from the cloned module cache, through the wrapper distribution the project names', async () => {
    const version = gradleVersion()!;
    const project = tempDir('gradle-project');
    write(join(project, 'settings.gradle'), "rootProject.name = 'tiny'\n");
    write(join(project, 'build.gradle'), "plugins { id 'java' }\nrepositories { mavenCentral() }\ndependencies { implementation 'org.slf4j:slf4j-api:2.0.17' }\ntasks.register('resolved') { doLast { println 'RESOLVED ' + configurations.compileClasspath.files.collect { it.name }.join(',') } }\n");
    execFileSync('gradle', ['--offline', '--no-daemon', 'wrapper', '--gradle-version', version, '--distribution-type', 'bin'], { cwd: project, env: { PATH: process.env['PATH'] ?? '', HOME: homedir(), JAVA_HOME: process.env['JAVA_HOME'] ?? '', GRADLE_USER_HOME: tempDir('gradle-throwaway') }, stdio: 'pipe' });
    const files: Record<string, string | Buffer> = {};
    for (const path of ['settings.gradle', 'build.gradle', 'gradlew', 'gradle/wrapper/gradle-wrapper.properties', 'gradle/wrapper/gradle-wrapper.jar']) files[path] = readFileSync(join(project, path));
    const r = rig(files, { home: homedir(), executables: ['gradlew'] });
    const subtrees = [join(homedir(), '.gradle', 'wrapper', 'dists', `gradle-${version}-bin`), join(homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'org.slf4j', 'slf4j-api', '2.0.17')];
    const before = subtrees.map(listing);
    const result = await r.run(['sh', '-c', './gradlew --offline resolved'], { timeoutSeconds: 170 });
    expect([result.checkpoint.outcome, result.checkpoint.outputTail], 'the wrapper finds its distribution and Gradle resolves from the clone').toMatchObject(['passed', expect.stringContaining('RESOLVED slf4j-api-2.0.17.jar')]);
    expect(subtrees.map(listing), 'the names, sizes and times of the real wrapper distribution and of the module entries of the dependency are the same').toEqual(before);
  }, 240_000);
});
