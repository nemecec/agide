import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentWritableRegistry } from './agentWritable';
import { caseInsensitiveVolume } from './caseProbe';
import { writeFakeSrt } from './fakeSrt';
import { INSIDE_PREFIX } from './hostLaunch';
import { HostTools, SYSTEM_DIRECTORIES } from './hostTools';
import { startedEnvironment } from './isolationProviderContract';
import { insideArgv } from './statusLauncher';
import { runInPty } from './ptyHarness';
import { SrtProvider, srtToolEnvironment } from './SrtProvider';
import { findTestSrt, srtTestsUnavailable } from './testRuntimes';
import { IsolationError, type EnvironmentSpec } from './types';

let dir: string;
let spec: EnvironmentSpec;
const srtBinary = findTestSrt() ?? 'srt';
/** A provider whose `srt` is a stand-in file on the PATH of the app (`appPath`), for the tests of the command. */
const provider = (claudeBinary: string, extra: Partial<ConstructorParameters<typeof SrtProvider>[0]> = {}) =>
  new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary: 'srt', appPath: join(dir, 'bin'), settingsDir: join(dir, 'srt'), claudeBinary, ...extra });
/** The provider over the real `srt` for the tests that run it. */
const real = (claudeBinary: string, extra: Partial<ConstructorParameters<typeof SrtProvider>[0]> = {}) => provider(claudeBinary, { srtBinary, appPath: process.env['PATH'] ?? '', ...extra });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'srt-provider-')));
  mkdirSync(join(dir, 'bin'));
  writeFakeSrt(join(dir, 'bin'));
  spec = {
    key: { profileId: 'default' },
    profile: { claudeConfigDir: join(dir, 'claude'), env: { PATH: process.env['PATH'] ?? '' }, toolFiles: [] },
    workspace: { mode: 'bind', hostPath: join(dir, 'work') },
    network: { mode: 'allowlist', allow: [{ host: 'example.com' }] },
    appEndpoint: { port: 4567 },
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SrtProvider check', () => {
  it('names the missing runtime and the install step when srt is not installed', async () => {
    const check = await provider('/bin/sh', { srtBinary: 'agide-no-such-srt' }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('not installed'), fix: expect.stringContaining('@anthropic-ai/sandbox-runtime') });
  });

  it('does not find srt through a relative or an empty entry of the PATH of the app', async () => {
    const check = await provider('/bin/sh', { appPath: [relative(process.cwd(), join(dir, 'bin')), '', '.'].join(':') }).check();
    expect(check, 'the stand-in is in the directory of the relative entry only').toMatchObject({ ok: false, reason: expect.stringContaining('not installed') });
  });

  it('names a configured srt path that is not executable', async () => {
    const check = await provider('/bin/sh', { srtBinary: join(dir, 'missing-srt') }).check();
    expect(check, 'the reason names the role and no path').toMatchObject({ ok: false, reason: 'The sandbox runtime (srt) is not executable at the configured path' });
  });

  it('fails when claude is missing', async () => {
    const check = await provider(join(dir, 'missing-claude'), { srtBinary: '/bin/sh' }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: 'The Claude CLI is not executable at the configured path' });
  });
});

describe('SrtProvider command', () => {
  it('runs srt with a per-session settings file, the separator and then claude with its arguments, under the PATH of the profile', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    environment.hookDelivery('s1', { inboxHostDir: join(dir, 'inbox'), httpPath: '/h', token: 't' });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: ['--session-id', 's1'], cols: 80, rows: 24 });
    const settingsPath = join(dir, 'srt', 's1', 'srt.json');
    expect(command.file, 'srt is the spawned file, as an absolute path').toBe(join(dir, 'bin', 'srt'));
    expect(command.args, 'settings, separator, the shell that sets the named variables, then claude and its arguments').toEqual(['-s', settingsPath, '--', ...insideArgv(['PATH', 'COLORTERM', 'CLAUDE_CONFIG_DIR'], ['/bin/claude-stand-in', '--session-id', 's1'])]);
    expect(startedEnvironment(command), 'the PATH and the Claude directory of the profile reach claude inside the sandbox').toMatchObject({ PATH: process.env['PATH'], CLAUDE_CONFIG_DIR: join(dir, 'claude') });
    expect(command.env['CLAUDE_CONFIG_DIR'], 'the host-side environment does not have it under its own name').toBeUndefined();
    expect(statSync(settingsPath).mode & 0o777, 'settings file mode').toBe(0o600);
    expect(statSync(join(dir, 'srt', 's1')).mode & 0o777, 'settings directory mode').toBe(0o700);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { filesystem: { allowWrite: string[] }; network: { allowedDomains: string[] } };
    expect(settings.filesystem.allowWrite, 'workspace, hook inbox and profile Claude directory').toEqual(expect.arrayContaining([join(dir, 'work'), join(dir, 'inbox'), join(dir, 'claude')]));
    expect(settings.network.allowedDomains, 'policy host').toContain('example.com');
  });

  it('gives a process without a terminal the same srt command as the PTY launch', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    const launch = { sessionId: 's1', cwd: join(dir, 'work'), args: ['-p', '--session-id', 's1'], env: { LAUNCH_VAR: 'l' } };
    const command = await environment.processCommand?.(launch);
    expect(command?.args.slice(-3), 'claude and its arguments end the argv').toEqual(['-p', '--session-id', 's1']);
    expect(command?.args.slice(0, 3), 'settings, separator').toEqual(['-s', join(dir, 'srt', 's1', 'srt.json'), '--']);
    expect(startedEnvironment(command!)['LAUNCH_VAR'], 'the launch variable reaches claude').toBe('l');
    expect(command, 'same as the PTY command').toEqual(await environment.ptyCommand({ ...launch, cols: 80, rows: 24 }));
  });

  it('never starts srt or the programs of its shim through the working directory of the agent or a PATH entry that it controls', async () => {
    const workspace = join(dir, 'work');
    mkdirSync(join(workspace, 'bin'), { recursive: true });
    writeFileSync(join(workspace, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const profilePath = ['bin', '', '.', join(workspace, 'bin'), '/usr/bin', ''].join(':');
    const environment = await provider('claude', { appPath: ['bin', '', '.', join(workspace, 'bin'), join(dir, 'bin')].join(':') }).prepare({ ...spec, profile: { ...spec.profile, env: { PATH: profilePath } } });
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: workspace, args: [] });
    expect(command?.file, 'srt comes from the absolute entry of the app PATH, not from the relative, empty or workspace entries').toBe(join(dir, 'bin', 'srt'));
    expect(command?.env['PATH'], 'the host-side PATH holds the absolute entry outside the workspace and the system directories only').toBe([join(dir, 'bin'), ...SYSTEM_DIRECTORIES].join(':'));
    expect(startedEnvironment(command!)['PATH'], 'the profile PATH is put back verbatim for claude inside the sandbox').toBe(profilePath);
    expect(command?.cwd, 'claude still starts in the workspace').toBe(workspace);
  });

  it('refuses to start when srt is found only through a PATH entry that the agent controls', async () => {
    const workspace = join(dir, 'work');
    mkdirSync(join(workspace, 'bin'), { recursive: true });
    writeFileSync(join(workspace, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const environment = await provider('claude', { appPath: `bin::.:${join(workspace, 'bin')}` }).prepare(spec);
    const failure = await environment.processCommand?.({ sessionId: 's1', cwd: workspace, args: [] }).catch((error: unknown) => error);
    expect((failure as IsolationError).message, 'no trusted entry holds srt, and the workspace that holds it was recorded at the launch').toBe('the sandbox runtime (srt) lies in a directory that an earlier agent launch made writable (such as the home directory), so it was not started');
    expect((failure as IsolationError).detail, 'the detail names the file, the recorded directory and that a database of the registry is needed to forget it').toBe(`${join(workspace, 'bin', 'srt')}; recorded as writable by an agent: ${workspace}; the app forgets it when it starts with a new profile database`);
  });

  it('removes the settings file on release', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: [], cols: 80, rows: 24 });
    await environment.releaseSession('s1');
    expect(() => statSync(join(dir, 'srt', 's1')), 'settings directory is gone').toThrow();
  });

  it('refuses a clone workspace', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare({ ...spec, workspace: { mode: 'clone', remoteUrl: 'u', ref: 'r' } });
    await expect(environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 }), 'clone workspace').rejects.toThrow('host directory');
  });
});

/** Programs that srt and its shim start outside the sandbox, and the ones the app looks up itself. */
const HOST_SIDE_PROGRAMS = ['srt', 'node', 'env', 'which', 'bash', 'sed', 'uname', 'dirname', 'git', 'docker'];

describe('SrtProvider host-side lookups against what the agent can write', () => {
  /** Stand-ins that write a marker outside every writable directory when they run. */
  const plant = (directory: string): void => {
    mkdirSync(join(dir, 'markers'), { recursive: true });
    for (const name of HOST_SIDE_PROGRAMS) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, name), `#!/bin/sh\ntouch '${join(dir, 'markers', name)}'\nexit 0\n`, { mode: 0o755 });
    }
  };
  const ran = (): string[] => (existsSync(join(dir, 'markers')) ? readdirSync(join(dir, 'markers')) : []);
  /**
   * The options of a provider that finds programs on `appPath` only, with no fixed directory, so a test never meets a
   * program of the machine, and over a registry that the provider and its tools share, as the profile process wires them.
   */
  const confined = (appPath: string, roots: { extraWritePaths?: string[]; agentRoots?: string[] } = {}): Partial<ConstructorParameters<typeof SrtProvider>[0]> => {
    const writable = new AgentWritableRegistry(() => ({ claudeConfigDir: undefined, ...roots }));
    return { writable, hostTools: new HostTools({ appPath, fixedDirectories: [], excluded: () => writable.directories() }), ...(roots.extraWritePaths === undefined ? {} : { extraWritePaths: roots.extraWritePaths }) };
  };
  /** The node that the shim of srt finds in a trusted directory: a file of the test, since only its presence matters. */
  beforeEach(() => {
    writeFileSync(join(dir, 'bin', 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    mkdirSync(join(dir, 'work'), { recursive: true });
  });
  const run = (command: { file: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }) => spawnSync(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, encoding: 'utf8' });

  const writable: [string, () => string, () => { extraWritePaths?: string[]; agentRoots?: string[] }][] = [
    ['a directory of extraWritePaths', () => join(dir, 'cargo'), () => ({ extraWritePaths: [join(dir, 'cargo')] })],
    ['a directory below the Claude configuration directory', () => join(dir, 'claude', 'local'), () => ({})],
    ['a directory below a root of the agents workspaces', () => join(dir, 'agents', 'swarm-1', 'tree'), () => ({ agentRoots: [join(dir, 'agents')] })],
    ['the workspace of a session', () => join(dir, 'work'), () => ({})],
  ];

  it.each(writable)('never uses srt, node, env or any other program from %s on the PATH of the app: the trusted srt is started and no stand-in runs', async (_name, directory, options) => {
    plant(join(directory(), 'bin'));
    const appPath = [join(directory(), 'bin'), join(dir, 'bin')].join(':');
    const environment = await provider('/bin/sh', confined(appPath, options())).prepare(spec);
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: ['-c', 'echo tests failed; exit 1'] });
    expect(command?.file, 'srt is the one outside the directory').toBe(join(dir, 'bin', 'srt'));
    expect(command?.env['PATH']?.split(':'), 'the host-side PATH holds neither the directory nor anything below it').not.toContain(join(directory(), 'bin'));
    const finished = run(command!);
    expect([finished.status, finished.stdout.trim()], 'the program inside ran and its status passed through').toEqual([1, 'tests failed']);
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it.each(writable)('refuses to start an agent session when the only srt lies in %s, with a reason that names no path', async (_name, directory, options) => {
    plant(join(directory(), 'bin'));
    const environment = await provider('/bin/sh', confined(join(directory(), 'bin'), options())).prepare(spec);
    const failure = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }).catch((error: unknown) => error);
    expect(failure, 'an isolation error').toBeInstanceOf(IsolationError);
    expect((failure as IsolationError).message, 'the fixed reason').toBe('the sandbox runtime (srt) exists only in a directory that an agent may write, or runs code that lies in one, so it was not started');
    expect((failure as IsolationError).detail, 'the detail names the stand-in').toBe(join(directory(), 'bin', 'srt'));
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('refuses to start when node, which the shim of srt needs, exists only in a directory an agent may write', async () => {
    rmSync(join(dir, 'bin', 'node'));
    plant(join(dir, 'cargo', 'bin'));
    const environment = await provider('/bin/sh', confined([join(dir, 'cargo', 'bin'), join(dir, 'bin')].join(':'), { extraWritePaths: [join(dir, 'cargo')] })).prepare(spec);
    rmSync(join(dir, 'cargo', 'bin', 'srt'));
    await expect(environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }), 'the stand-in node is the only node').rejects.toThrow('the program that runs the sandbox runtime (node) exists only in a directory that an agent may write');
  });

  it('starts when node is found in a trusted directory as well', async () => {
    plant(join(dir, 'cargo', 'bin'));
    plant(join(dir, 'bin2'));
    writeFileSync(join(dir, 'bin2', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const environment = await provider('/bin/sh', confined([join(dir, 'cargo', 'bin'), join(dir, 'bin2')].join(':'), { extraWritePaths: [join(dir, 'cargo')] })).prepare(spec);
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] });
    expect(command?.file, 'the trusted srt').toBe(join(dir, 'bin2', 'srt'));
  });

  it('excludes the workspace of another environment that the provider prepared, which another agent of the profile can write', async () => {
    plant(join(dir, 'other-work', 'bin'));
    const owner = provider('/bin/sh', confined(join(dir, 'other-work', 'bin')));
    await owner.prepare({ ...spec, key: { profileId: 'default', sessionId: 'other' }, workspace: { mode: 'bind', hostPath: join(dir, 'other-work') } });
    const mine = await owner.prepare({ ...spec, key: { profileId: 'default', sessionId: 'mine' }, workspace: { mode: 'bind', hostPath: join(dir, 'work') } });
    await expect(mine.processCommand?.({ sessionId: 'mine', cwd: join(dir, 'work'), args: [] }), 'the only srt is in the workspace of the other environment').rejects.toThrow('exists only in a directory that an agent may write');
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('excludes the working directory and the hook inbox of this launch, which lie outside the workspace', async () => {
    plant(join(dir, 'cwd-elsewhere', 'bin'));
    plant(join(dir, 'inbox', 'bin'));
    for (const [place, appPath] of [['the working directory', join(dir, 'cwd-elsewhere', 'bin')], ['the hook inbox', join(dir, 'inbox', 'bin')]] as const) {
      const environment = await provider('/bin/sh', confined(appPath)).prepare(spec);
      environment.hookDelivery('s1', { inboxHostDir: join(dir, 'inbox'), httpPath: '/h', token: 't' });
      await expect(environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'cwd-elsewhere'), args: [] }), `the only srt is in ${place}`).rejects.toThrow('exists only in a directory that an agent may write');
    }
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('names a configured absolute srt by its role and base name only, for a session, for a check and for the check of the provider, with the path in the detail', async () => {
    plant(join(dir, 'cargo', 'bin'));
    const configured = join(dir, 'cargo', 'bin', 'srt');
    const options = { ...confined(join(dir, 'bin'), { extraWritePaths: [join(dir, 'cargo')] }), srtBinary: configured };
    const environment = await provider('/bin/sh', options).prepare(spec);
    const session = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }).catch((error: unknown) => error);
    const check = await environment.toolCommand({ key: 'c1', cwd: join(dir, 'checkout'), argv: ['true'], env: {}, network: 'none', writeDirs: [] }).catch((error: unknown) => error);
    const standalone = await srtToolEnvironment({ srtBinary: configured, settingsDir: join(dir, 'srt-checks'), hostTools: options.hostTools! }).toolCommand({ key: 'c2', cwd: join(dir, 'checkout'), argv: ['true'], env: {}, network: 'none', writeDirs: [] }).catch((error: unknown) => error);
    for (const failure of [session, check, standalone]) {
      expect([(failure as IsolationError).message, (failure as IsolationError).message.includes('/'), (failure as IsolationError).detail], 'role and base name, no slash, the path in the detail').toEqual(['the sandbox runtime (srt) exists only in a directory that an agent may write, or runs code that lies in one, so it was not started', false, configured]);
    }
    const status = await provider('/bin/sh', options).check();
    expect(status, 'the check of the provider names no path').toMatchObject({ ok: false, reason: 'The sandbox runtime (srt), or the code it runs, lies in a directory that an agent may write' });
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('refuses the same for a program a check runs, and for the check of the provider', async () => {
    plant(join(dir, 'cargo', 'bin'));
    const environment = await provider('/bin/sh', confined(join(dir, 'cargo', 'bin'), { extraWritePaths: [join(dir, 'cargo')] })).prepare(spec);
    await expect(environment.toolCommand({ key: 'c1', cwd: join(dir, 'checkout'), argv: ['true'], env: {}, network: 'none', writeDirs: [] }), 'a check start').rejects.toThrow('exists only in a directory that an agent may write');
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('puts every directory that its settings allow writing out of reach of the lookup, for each directory below the test directory', async () => {
    const environment = await provider('/bin/sh', confined(join(dir, 'bin'), { extraWritePaths: [join(dir, 'cargo')], agentRoots: [join(dir, 'agents')] })).prepare(spec);
    await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] });
    const settings = JSON.parse(readFileSync(join(dir, 'srt', 's1', 'srt.json'), 'utf8')) as { filesystem: { allowWrite: string[] } };
    const below = settings.filesystem.allowWrite.filter((path) => path.startsWith(dir));
    expect(below.length, 'the settings allow directories below the test directory').toBeGreaterThanOrEqual(3);
    for (const path of below) {
      rmSync(join(dir, 'markers'), { recursive: true, force: true });
      mkdirSync(join(path, 'bin'), { recursive: true });
      writeFileSync(join(path, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const second = await provider('/bin/sh', confined(`${join(path, 'bin')}:${join(dir, 'bin')}`, { extraWritePaths: [join(dir, 'cargo')] })).prepare({ ...spec, key: { profileId: 'p2' } });
      const command = await second.processCommand?.({ sessionId: 's2', cwd: join(dir, 'work'), args: [] });
      expect(command?.file, `a srt below ${relative(dir, path)}, which the settings allow writing, is not used`).toBe(join(dir, 'bin', 'srt'));
    }
  });

  it.skipIf(!caseInsensitiveVolume())('excludes a PATH entry that spells the workspace in another case, which the volume treats as the same directory', async () => {
    plant(join(dir, 'Work2', 'bin'));
    const environment = await provider('/bin/sh', confined(join(dir, 'work2', 'bin'))).prepare({ ...spec, workspace: { mode: 'bind', hostPath: join(dir, 'Work2') } });
    await expect(environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'Work2'), args: [] }), 'the only srt is in the workspace under another spelling').rejects.toThrow('exists only in a directory that an agent may write');
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  /** Variables that make a shell or Node run code before or while the program starts, and a name that nothing knows. */
  const hostile = { 'BASH_FUNC_uname%%': '() { ./x func; }', SHELLOPTS: 'xtrace', BASHOPTS: 'extdebug', PS4: '$(./x ps4)', ENV: './x', BASH_ENV: './x', CDPATH: '.', IFS: ':', PROMPT_COMMAND: './x', NODE_OPTIONS: '--require ./x.cjs', NODE_PATH: './lib', DYLD_INSERT_LIBRARIES: './x.dylib', LD_PRELOAD: './x.so', SOMETHING_NEW: 'v' };

  /** The names of `hostile` that the launcher shell cannot set, and the `DYLD_` name that macOS removes, which do not reach the program. */
  const unsettable = ['BASH_FUNC_uname%%', 'SHELLOPTS', 'BASHOPTS', ...(process.platform === 'darwin' ? ['DYLD_INSERT_LIBRARIES'] : [])];
  const settable = Object.fromEntries(Object.entries(hostile).filter(([name]) => !unsettable.includes(name)));

  it('gives the host-side srt the allowed variables and inert carriers only, and the program every other variable of the profile', async () => {
    const profileEnv = { PATH: '/usr/bin', HOME: '/h', LC_ALL: 'C', ...hostile };
    const environment = await provider('/bin/claude-stand-in').prepare({ ...spec, profile: { ...spec.profile, env: profileEnv } });
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: ['-p'] });
    expect(Object.keys(command?.env ?? {}).filter((name) => !name.startsWith(INSIDE_PREFIX)).sort(), 'the host-side environment holds the allowed names and the PATH besides the carriers').toEqual(['HOME', 'LC_ALL', 'PATH', 'TERM']);
    expect(startedEnvironment(command!), 'the program gets every variable that a shell can set, with its value').toMatchObject({ PATH: '/usr/bin', ...settable });
    expect(unsettable.filter((name) => name in startedEnvironment(command!)), 'an exported function, the read-only names of bash and a DYLD_ name do not reach it').toEqual([]);
    expect(command?.dropped, 'they are named as dropped').toEqual(unsettable);
    expect(command?.args.slice(-2), 'the program ends the argv').toEqual(['/bin/claude-stand-in', '-p']);
  });

  it('does the same for a check', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    const command = await environment.toolCommand({ key: 'c1', cwd: join(dir, 'checkout'), argv: ['true'], env: { PATH: '/usr/bin', HOME: '/h', ...hostile, CI: '1' }, network: 'none', writeDirs: [] });
    expect(Object.keys(command.env).filter((name) => !name.startsWith(INSIDE_PREFIX)).sort(), 'the host-side environment holds HOME and the PATH besides the carriers').toEqual(['HOME', 'PATH']);
    expect(startedEnvironment(command), 'the program gets the PATH and every other variable that a shell can set').toEqual({ HOME: '/h', PATH: '/usr/bin', ...settable, CI: '1' });
  });
});

describe('SrtProvider terminate', () => {
  it('ends the children of an attached process group on SIGKILL, which killing the leader alone would not', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    const pidFile = join(dir, 'child.pid');
    const leader = spawn('/bin/sh', ['-c', `sleep 30 & echo $! > ${pidFile}; wait`], { detached: true, stdio: 'ignore' });
    const exited = new Promise((resolve) => leader.once('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const child = Number(readFileSync(pidFile, 'utf8'));
    environment.attach('s1', leader.pid ?? -1);
    await environment.terminate('s1', 'SIGKILL');
    await exited;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const alive = (() => {
      try {
        process.kill(child, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(alive, 'the child of the group is gone').toBe(false);
  });
});

/** The part of a derived value that a listing is searched for: the hash, which nothing else holds. */
const marker = (value: string): string => /[0-9a-f]{24}/.exec(value)?.[0] ?? value;

/** Values of credential-like variables, made at run time from a hash of a label, with the characters a shell would read. */
function derivedValues(label: string): Record<string, string> {
  const hash = (name: string): string => createHash('sha256').update(`${label}:${name}`).digest('hex').slice(0, 24);
  return {
    GH_TOKEN: `-${hash('gh')}`,
    NPM_TOKEN: `a"b'c ${hash('npm')} $HOME \`id\` $(id)`,
    SOME_SERVICE_TOKEN: `${hash('service')}\nsecond line\\`,
  };
}

describe('the values of the profile and the arguments of the built commands', () => {
  it('puts no value into the arguments of srt for a session or a check: the values are in its environment under the inert prefix', async () => {
    const values = derivedValues('unit');
    const environment = await provider('/bin/claude-stand-in').prepare({ ...spec, profile: { ...spec.profile, env: { PATH: '/usr/bin', ...values } } });
    const session = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] });
    const check = await environment.toolCommand({ key: 'c1', cwd: join(dir, 'checkout'), argv: ['true'], env: { PATH: '/usr/bin', ...values }, network: 'none', writeDirs: [] });
    for (const [name, command] of [['session', session!], ['check', check]] as const) {
      expect(Object.values(values).filter((value) => command.args.some((word) => word.includes(marker(value)))), `${name}: no argument holds a value`).toEqual([]);
      expect(Object.keys(values).map((key) => command.env[`${INSIDE_PREFIX}${key}`]), `${name}: the carriers hold the values`).toEqual(Object.values(values));
      expect(Object.keys(values).filter((key) => key in command.env), `${name}: the host-side process does not have them under their own names`).toEqual([]);
    }
  });
});

const sandboxed = srtTestsUnavailable() === undefined ? describe : describe.skip;

sandboxed(`SrtProvider under the real sandbox runtime${srtTestsUnavailable() === undefined ? '' : ` [unavailable: ${srtTestsUnavailable()}]`}`, () => {
  const probeScript = (): string => {
    const path = join(dir, 'probe-claude.sh');
    writeFileSync(
      path,
      [
        '#!/bin/sh',
        'touch "$1/inside" 2>/dev/null; echo "inside=$?"',
        'touch "$2/outside" 2>/dev/null; echo "outside=$?"',
        'curl -sS --max-time 8 -o /dev/null https://example.org 2>&1 | head -c 200; echo "denied-done"',
        'curl -sS --max-time 8 -o /dev/null "http://127.0.0.1:$3/" 2>&1; echo "loopback=$?"',
        '[ -t 0 ] && echo "tty=yes"',
        'echo "end"',
      ].join('\n'),
    );
    chmodSync(path, 0o755);
    return path;
  };

  it('enforces the write policy, the network allowlist and the loopback and PTY settings it generates', async () => {
    const workspace = join(dir, 'work');
    const outside = join(dir, 'outside');
    for (const path of [workspace, outside]) spawn('mkdir', ['-p', path]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const server = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const environment = await real(probeScript()).prepare({ ...spec, workspace: { mode: 'bind', hostPath: workspace } });
      const command = await environment.ptyCommand({ sessionId: 's1', cwd: workspace, args: [workspace, outside, String(port)], cols: 80, rows: 24 });
      const run = runInPty(command);
      await run.until(/end/, 30_000);
      const output = run.output();
      expect(output, 'a write inside the workspace works').toContain('inside=0');
      expect(output, 'a write outside the allowed paths is refused').toMatch(/outside=[1-9]/);
      expect(output, 'a host outside the allowlist is refused by the proxy').toContain('403');
      expect(output, 'the loopback server is reachable (allowLocalBinding)').toContain('loopback=0');
      expect(output, 'the process has a terminal (allowPty)').toContain('tty=yes');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);

  it('denies a session the read of the profile database and its journal files, while the hook inbox in the same data directory stays writable', async () => {
    const workspace = join(dir, 'work');
    const data = join(dir, 'data');
    const inbox = join(data, 'session-events', 's1');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(inbox, { recursive: true });
    const database = join(data, 'app.db');
    for (const suffix of ['', '-wal', '-shm']) writeFileSync(`${database}${suffix}`, 'rows');
    writeFileSync(join(data, 'other.txt'), 'other-content');
    const script = join(dir, 'read-claude.sh');
    writeFileSync(script, ['#!/bin/sh', 'cat "$1" >/dev/null 2>&1; echo "db=$?"', 'cat "$1-wal" >/dev/null 2>&1; echo "wal=$?"', 'cat "$1-shm" >/dev/null 2>&1; echo "shm=$?"', 'echo x > "$2/hook" 2>/dev/null; echo "inbox=$?"', 'cat "$3"; echo', 'echo end'].join('\n'), { mode: 0o755 });
    const outcome = async (profileDatabase: string | undefined): Promise<string> => {
      const environment = await real(script, profileDatabase === undefined ? {} : { profileDatabase }).prepare({ ...spec, key: { profileId: 'default', sessionId: String(profileDatabase) }, workspace: { mode: 'bind', hostPath: workspace } });
      environment.hookDelivery('s1', { inboxHostDir: inbox, httpPath: '/h', token: 't' });
      const command = await environment.processCommand?.({ sessionId: 's1', cwd: workspace, args: [database, inbox, join(data, 'other.txt')] });
      return spawnSync(command!.file, [...command!.args], { cwd: command!.cwd, env: { ...command!.env }, encoding: 'utf8', timeout: 30_000 }).stdout;
    };
    const denied = await outcome(database);
    expect(denied, `the session ran: ${denied}`).toContain('end');
    expect(['db', 'wal', 'shm'].map((name) => new RegExp(`${name}=[1-9]`).test(denied)), 'the database and its journal files are not readable').toEqual([true, true, true]);
    expect(denied, 'the hook inbox below the data directory is writable').toContain('inbox=0');
    expect(denied, 'another file of the data directory stays readable').toContain('other-content');
    expect(await outcome(undefined), 'without the setting the database is readable').toContain('db=0');
  }, 60_000);

  it('starts an agent session under a hostile profile PATH with programs planted in the workspace and in an agent-writable directory on the app PATH, and runs none of them outside the sandbox', async () => {
    const workspace = join(dir, 'work');
    const cargo = join(dir, 'cargo');
    const markers = join(dir, 'markers');
    mkdirSync(markers);
    for (const directory of [workspace, join(workspace, 'bin'), join(cargo, 'bin')]) {
      mkdirSync(directory, { recursive: true });
      for (const name of ['srt', 'node', 'env', 'which', 'bash', 'sed', 'uname', 'dirname', 'git', 'docker']) {
        writeFileSync(join(directory, name), `#!/bin/sh\ntouch '${join(markers, `${name}-${directory.length}`)}'\nexit 0\n`, { mode: 0o755 });
      }
    }
    const script = join(dir, 'ran-claude.sh');
    writeFileSync(script, '#!/bin/sh\necho session-ran\necho end\n', { mode: 0o755 });
    const profilePath = ['bin', '', '.', join(workspace, 'bin'), process.env['PATH'] ?? ''].join(':');
    const appPath = [join(cargo, 'bin'), join(workspace, 'bin'), 'bin', '', '.', process.env['PATH'] ?? ''].join(':');
    const environment = await real(script, { appPath, extraWritePaths: [cargo] }).prepare({ ...spec, profile: { ...spec.profile, env: { PATH: profilePath } }, workspace: { mode: 'bind', hostPath: workspace } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: workspace, args: [], cols: 80, rows: 24 });
    const run = runInPty(command);
    await run.until(/end/, 30_000);
    expect(run.output(), 'the session ran').toContain('session-ran');
    expect(readdirSync(markers), 'no program of the workspace or of the writable directory ran outside the sandbox').toEqual([]);
  }, 60_000);

  it('starts an agent session whose profile holds an exported shell function and xtrace variables, and runs nothing of the workspace outside the sandbox', async () => {
    const workspace = join(dir, 'work');
    const markers = join(dir, 'markers');
    mkdirSync(markers);
    mkdirSync(workspace, { recursive: true });
    // A Node program: a shell script would be traced by the xtrace of the profile and start itself through PS4 without end.
    writeFileSync(join(workspace, 'x'), `#!${process.execPath}\ntry { require('node:fs').writeFileSync('${markers}/' + process.argv[2], ''); } catch {}\n`, { mode: 0o755 });
    const script = join(dir, 'ran-claude.sh');
    writeFileSync(script, '#!/bin/sh\necho session-ran\n', { mode: 0o755 });
    const env = { PATH: process.env['PATH'] ?? '', 'BASH_FUNC_uname%%': '() { ./x func; command uname "$@"; }', SHELLOPTS: 'xtrace', PS4: '$(./x ps4)' };
    const environment = await real(script).prepare({ ...spec, profile: { ...spec.profile, env }, workspace: { mode: 'bind', hostPath: workspace } });
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: workspace, args: [] });
    const finished = spawnSync(command!.file, [...command!.args], { cwd: command!.cwd, env: { ...command!.env }, encoding: 'utf8', timeout: 30_000 });
    expect(finished.stdout, `the session ran: ${finished.stderr}`).toContain('session-ran');
    expect(readdirSync(markers), 'neither the function nor the prompt of xtrace ran ./x outside the sandbox').toEqual([]);
  }, 60_000);

  /** Runs `command`, waits until the program wrote its `ready` file, reads the arguments of every process while it runs, and returns them with what the program saw. */
  const argumentsWhileRunning = async (command: { file: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }, ready: string, seen: string): Promise<{ listing: string; seen: Record<string, string> }> => {
    const child = spawn(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const deadline = Date.now() + 30_000;
    while (!existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const listing = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,args='], { encoding: 'utf8' }).stdout;
    await exited;
    return { listing, seen: JSON.parse(readFileSync(seen, 'utf8')) as Record<string, string> };
  };

  /** A Node program that writes the values of `names` it sees, signals that it runs and stays for a while. */
  const reporter = (workspace: string, names: readonly string[]): string => {
    const path = join(dir, 'report.cjs');
    writeFileSync(path, `#!${process.execPath}\nconst fs = require('node:fs');\nconst names = ${JSON.stringify(names)};\nfs.writeFileSync('${join(workspace, 'seen.json')}', JSON.stringify(Object.fromEntries(names.map((name) => [name, process.env[name]]))));\nfs.writeFileSync('${join(workspace, 'ready')}', '');\nsetTimeout(() => {}, 1500);\n`, { mode: 0o755 });
    return path;
  };

  it('gives the program of a session the variables of the profile with their exact values, and no value is an argument of any process while it runs', async () => {
    const workspace = join(dir, 'work');
    mkdirSync(workspace, { recursive: true });
    const values = derivedValues('session');
    const program = reporter(workspace, Object.keys(values));
    const environment = await real(program).prepare({ ...spec, profile: { ...spec.profile, env: { PATH: process.env['PATH'] ?? '', ...values } }, workspace: { mode: 'bind', hostPath: workspace } });
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: workspace, args: [] });
    const { listing, seen } = await argumentsWhileRunning(command!, join(workspace, 'ready'), join(workspace, 'seen.json'));
    expect(seen, 'the program sees each value exactly: quotes, dollars, backticks, a line break and a leading dash').toEqual(values);
    expect(Object.values(values).map(marker).filter((part) => listing.includes(part)), 'no process (srt, sandbox-exec, the shell inside) shows a value in its arguments').toEqual([]);
    expect(listing, 'the listing was read while the program ran').toContain(program);
  }, 60_000);

  it('does the same for a check', async () => {
    const workspace = join(dir, 'checkout');
    mkdirSync(workspace, { recursive: true });
    const values = derivedValues('check');
    const program = reporter(workspace, Object.keys(values));
    const tools = srtToolEnvironment({ srtBinary, settingsDir: join(dir, 'tool-srt'), hostTools: new HostTools({ appPath: process.env['PATH'] ?? '', excluded: () => [] }) });
    const command = await tools.toolCommand({ key: 'c1', cwd: workspace, argv: [program], env: { PATH: process.env['PATH'] ?? '', ...values }, network: 'none', writeDirs: [] });
    const { listing, seen } = await argumentsWhileRunning(command, join(workspace, 'ready'), join(workspace, 'seen.json'));
    expect(seen, 'the check sees each value exactly').toEqual(values);
    expect(Object.values(values).map(marker).filter((part) => listing.includes(part)), 'no process shows a value in its arguments').toEqual([]);
    tools.release('c1');
  }, 60_000);

  it('ends the sandboxed process on SIGTERM through terminate', async () => {
    const script = join(dir, 'sleeper.sh');
    writeFileSync(script, `#!/bin/sh\necho "$$" > ${join(dir, 'inner.pid')}\necho ready\nexec sleep 30\n`);
    chmodSync(script, 0o755);
    const environment = await real(script, { extraWritePaths: [dir] }).prepare({ ...spec, workspace: { mode: 'bind', hostPath: dir } });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: dir, args: [], cols: 80, rows: 24 });
    const run = runInPty(command);
    await run.until(/ready/);
    const inner = Number(readFileSync(join(dir, 'inner.pid'), 'utf8'));
    environment.attach('s1', run.pid);
    await environment.terminate('s1', 'SIGTERM');
    await run.exited;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const alive = (() => {
      try {
        process.kill(inner, 0);
        return true;
      } catch {
        return false;
      }
    })();
    expect(alive, 'the process inside srt ended').toBe(false);
  }, 30_000);
});

sandboxed('SrtProvider in a session launch', () => {
  const FAKE_CLAUDE = join(import.meta.dirname, '..', 'session', 'fixtures', 'fake-claude.mjs');

  it('starts a session through the session service, delivers hooks through the inbox and takes input, and reports the start latency against the local provider', async () => {
    const { PtySessionService } = await import('../session/PtySessionService');
    const { LocalProvider } = await import('./LocalProvider');
    const times: Record<string, number> = {};
    for (const name of ['local', 'srt', 'local', 'srt']) {
      const workdir = join(dir, `cwd-${name}`);
      spawn('mkdir', ['-p', workdir]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const chosen = name === 'srt' ? real(FAKE_CLAUDE, { extraWritePaths: [dir] }) : new LocalProvider({ sessionFilesDir: join(dir, 'local-sessions'), claudeBinary: FAKE_CLAUDE });
      const service = new PtySessionService({
        eventsDir: join(dir, `events-${name}`),
        provider: chosen,
        baseEnv: { PATH: process.env['PATH'], FAKE_CLAUDE_RECORD: join(dir, 'launches.jsonl') },
        killTimeoutMs: 500,
      });
      try {
        let printed = '';
        service.subscribe((event) => {
          if (event.type === 'session.output') printed += event.data;
        });
        const started = Date.now();
        const session = await service.create({ folderId: 'f', cwd: workdir });
        const deadline = Date.now() + 20_000;
        while (service.get(session.id)?.status !== 'idle') {
          if (Date.now() > deadline) throw new Error(`${name}: no idle status; output: ${service.get(session.id)?.status}`);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        times[`${name}${times[name] === undefined ? '' : '-2'}`] = Date.now() - started;
        service.sendText(session.id, 'hi');
        const end = Date.now() + 10_000;
        while (!printed.includes('echo: hi') && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(printed, `${name}: the typed line reaches the process and is echoed`).toContain('echo: hi');
        const idleAgain = Date.now() + 10_000;
        while (service.get(session.id)?.status !== 'idle' && Date.now() < idleAgain) await new Promise((resolve) => setTimeout(resolve, 20));
        expect(service.get(session.id)?.status, `${name}: the Stop hook arrived through the inbox`).toBe('idle');
      } finally {
        await service.shutdown();
      }
    }
    console.info(`[latency] session create to idle, ms: ${JSON.stringify(times)}`);
    expect(Object.keys(times).length, 'both providers started').toBe(4);
  }, 90_000);
});
