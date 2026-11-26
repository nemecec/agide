import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caseInsensitiveVolume } from './caseProbe';
import { writeFakeSrt } from './fakeSrt';
import { insideArgv } from './hostLaunch';
import { HostTools, SYSTEM_DIRECTORIES } from './hostTools';
import { runInPty } from './ptyHarness';
import { SrtProvider } from './SrtProvider';
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
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('is not executable') });
  });

  it('fails when claude is missing', async () => {
    const check = await provider(join(dir, 'missing-claude'), { srtBinary: '/bin/sh' }).check();
    expect(check, 'check result').toMatchObject({ ok: false, reason: expect.stringContaining('missing-claude') });
  });
});

describe('SrtProvider command', () => {
  it('runs srt with a per-session settings file, the separator and then claude with its arguments, under the PATH of the profile', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    environment.hookDelivery('s1', { inboxHostDir: join(dir, 'inbox'), httpPath: '/h', token: 't' });
    const command = await environment.ptyCommand({ sessionId: 's1', cwd: join(dir, 'work'), args: ['--session-id', 's1'], cols: 80, rows: 24 });
    const settingsPath = join(dir, 'srt', 's1', 'srt.json');
    expect(command.file, 'srt is the spawned file, as an absolute path').toBe(join(dir, 'bin', 'srt'));
    expect(command.args, 'settings, separator, env with the profile PATH, claude, arguments').toEqual(['-s', settingsPath, '--', ...insideArgv(process.env['PATH'], ['/bin/claude-stand-in', '--session-id', 's1'])]);
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
    expect(command?.env['LAUNCH_VAR'], 'launch variable').toBe('l');
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
    expect(command?.args.slice(3, 5), 'the profile PATH is put back verbatim for claude inside the sandbox').toEqual(['/usr/bin/env', `PATH=${profilePath}`]);
    expect(command?.cwd, 'claude still starts in the workspace').toBe(workspace);
  });

  it('refuses to start when srt is found only through a PATH entry that the agent controls', async () => {
    const workspace = join(dir, 'work');
    mkdirSync(join(workspace, 'bin'), { recursive: true });
    writeFileSync(join(workspace, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const environment = await provider('claude', { appPath: `bin::.:${join(workspace, 'bin')}` }).prepare(spec);
    await expect(environment.processCommand?.({ sessionId: 's1', cwd: workspace, args: [] }), 'no trusted entry holds srt').rejects.toThrow('exists only in a directory that an agent may write');
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
  /** The tools a provider finds with: the app PATH and no fixed directory, so a test never meets a program of the machine. */
  const tools = (appPath: string): HostTools => new HostTools({ appPath, fixedDirectories: [] });
  /** The node that the shim of srt finds in a trusted directory: a file of the test, since only its presence matters. */
  beforeEach(() => {
    writeFileSync(join(dir, 'bin', 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    mkdirSync(join(dir, 'work'), { recursive: true });
  });
  const run = (command: { file: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }) => spawnSync(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, encoding: 'utf8' });

  const writable: [string, () => string, (extra: Partial<ConstructorParameters<typeof SrtProvider>[0]>) => Partial<ConstructorParameters<typeof SrtProvider>[0]>][] = [
    ['a directory of extraWritePaths', () => join(dir, 'cargo'), () => ({ extraWritePaths: [join(dir, 'cargo')] })],
    ['a directory below the Claude configuration directory', () => join(dir, 'claude', 'local'), () => ({})],
    ['a directory below a root of the agents workspaces', () => join(dir, 'agents', 'swarm-1', 'tree'), () => ({ agentRoots: [join(dir, 'agents')] })],
    ['the workspace of a session', () => join(dir, 'work'), () => ({})],
  ];

  it.each(writable)('never uses srt, node, env or any other program from %s on the PATH of the app: the trusted srt is started and no stand-in runs', async (_name, directory, options) => {
    plant(join(directory(), 'bin'));
    const appPath = [join(directory(), 'bin'), join(dir, 'bin')].join(':');
    const environment = await provider('/bin/sh', { hostTools: tools(appPath), ...options({}) }).prepare(spec);
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: ['-c', 'echo tests failed; exit 1'] });
    expect(command?.file, 'srt is the one outside the directory').toBe(join(dir, 'bin', 'srt'));
    expect(command?.env['PATH']?.split(':'), 'the host-side PATH holds neither the directory nor anything below it').not.toContain(join(directory(), 'bin'));
    const finished = run(command!);
    expect([finished.status, finished.stdout.trim()], 'the program inside ran and its status passed through').toEqual([1, 'tests failed']);
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it.each(writable)('refuses to start an agent session when the only srt lies in %s, with a reason that names no path', async (_name, directory, options) => {
    plant(join(directory(), 'bin'));
    const environment = await provider('/bin/sh', { hostTools: tools(join(directory(), 'bin')), ...options({}) }).prepare(spec);
    const failure = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }).catch((error: unknown) => error);
    expect(failure, 'an isolation error').toBeInstanceOf(IsolationError);
    expect((failure as IsolationError).message, 'the fixed reason').toBe('the sandbox runtime (srt) exists only in a directory that an agent may write, so it was not started');
    expect((failure as IsolationError).detail, 'the detail names the stand-in').toBe(join(directory(), 'bin', 'srt'));
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('refuses to start when node, which the shim of srt needs, exists only in a directory an agent may write', async () => {
    rmSync(join(dir, 'bin', 'node'));
    plant(join(dir, 'cargo', 'bin'));
    const environment = await provider('/bin/sh', { hostTools: tools([join(dir, 'cargo', 'bin'), join(dir, 'bin')].join(':')), extraWritePaths: [join(dir, 'cargo')] }).prepare(spec);
    rmSync(join(dir, 'cargo', 'bin', 'srt'));
    await expect(environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] }), 'the stand-in node is the only node').rejects.toThrow('the program that runs the sandbox runtime (node) exists only in a directory that an agent may write');
  });

  it('starts when node is found in a trusted directory as well', async () => {
    plant(join(dir, 'cargo', 'bin'));
    plant(join(dir, 'bin2'));
    writeFileSync(join(dir, 'bin2', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const environment = await provider('/bin/sh', { hostTools: tools([join(dir, 'cargo', 'bin'), join(dir, 'bin2')].join(':')), extraWritePaths: [join(dir, 'cargo')] }).prepare(spec);
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] });
    expect(command?.file, 'the trusted srt').toBe(join(dir, 'bin2', 'srt'));
  });

  it('excludes the workspace of another environment that the provider prepared, which another agent of the profile can write', async () => {
    plant(join(dir, 'other-work', 'bin'));
    const owner = provider('/bin/sh', { hostTools: tools(join(dir, 'other-work', 'bin')) });
    await owner.prepare({ ...spec, key: { profileId: 'default', sessionId: 'other' }, workspace: { mode: 'bind', hostPath: join(dir, 'other-work') } });
    const mine = await owner.prepare({ ...spec, key: { profileId: 'default', sessionId: 'mine' }, workspace: { mode: 'bind', hostPath: join(dir, 'work') } });
    await expect(mine.processCommand?.({ sessionId: 'mine', cwd: join(dir, 'work'), args: [] }), 'the only srt is in the workspace of the other environment').rejects.toThrow('exists only in a directory that an agent may write');
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('excludes the working directory and the hook inbox of this launch, which lie outside the workspace', async () => {
    plant(join(dir, 'cwd-elsewhere', 'bin'));
    plant(join(dir, 'inbox', 'bin'));
    for (const [place, appPath] of [['the working directory', join(dir, 'cwd-elsewhere', 'bin')], ['the hook inbox', join(dir, 'inbox', 'bin')]] as const) {
      const environment = await provider('/bin/sh', { hostTools: tools(appPath) }).prepare(spec);
      environment.hookDelivery('s1', { inboxHostDir: join(dir, 'inbox'), httpPath: '/h', token: 't' });
      await expect(environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'cwd-elsewhere'), args: [] }), `the only srt is in ${place}`).rejects.toThrow('exists only in a directory that an agent may write');
    }
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('refuses the same for a program a check runs, and for the check of the provider', async () => {
    plant(join(dir, 'cargo', 'bin'));
    const environment = await provider('/bin/sh', { hostTools: tools(join(dir, 'cargo', 'bin')), extraWritePaths: [join(dir, 'cargo')] }).prepare(spec);
    await expect(environment.toolCommand({ key: 'c1', cwd: join(dir, 'checkout'), argv: ['true'], env: {}, network: 'none', writeDirs: [] }), 'a check start').rejects.toThrow('exists only in a directory that an agent may write');
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('puts every directory that its settings allow writing out of reach of the lookup, for each directory below the test directory', async () => {
    const environment = await provider('/bin/sh', { hostTools: tools(join(dir, 'bin')), extraWritePaths: [join(dir, 'cargo')], agentRoots: [join(dir, 'agents')] }).prepare(spec);
    await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: [] });
    const settings = JSON.parse(readFileSync(join(dir, 'srt', 's1', 'srt.json'), 'utf8')) as { filesystem: { allowWrite: string[] } };
    const below = settings.filesystem.allowWrite.filter((path) => path.startsWith(dir));
    expect(below.length, 'the settings allow directories below the test directory').toBeGreaterThanOrEqual(3);
    for (const path of below) {
      rmSync(join(dir, 'markers'), { recursive: true, force: true });
      mkdirSync(join(path, 'bin'), { recursive: true });
      writeFileSync(join(path, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const second = await provider('/bin/sh', { hostTools: tools(`${join(path, 'bin')}:${join(dir, 'bin')}`), extraWritePaths: [join(dir, 'cargo')] }).prepare({ ...spec, key: { profileId: 'p2' } });
      const command = await second.processCommand?.({ sessionId: 's2', cwd: join(dir, 'work'), args: [] });
      expect(command?.file, `a srt below ${relative(dir, path)}, which the settings allow writing, is not used`).toBe(join(dir, 'bin', 'srt'));
    }
  });

  it.skipIf(!caseInsensitiveVolume())('excludes a PATH entry that spells the workspace in another case, which the volume treats as the same directory', async () => {
    plant(join(dir, 'Work2', 'bin'));
    const environment = await provider('/bin/sh', { hostTools: tools(join(dir, 'work2', 'bin')) }).prepare({ ...spec, workspace: { mode: 'bind', hostPath: join(dir, 'Work2') } });
    await expect(environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'Work2'), args: [] }), 'the only srt is in the workspace under another spelling').rejects.toThrow('exists only in a directory that an agent may write');
    expect(ran(), 'no stand-in ran').toEqual([]);
  });

  it('keeps the loader variables out of the environment of the host-side srt and gives them to the program through env', async () => {
    const profileEnv = { PATH: '/usr/bin', HOME: '/h', NODE_OPTIONS: '--require ./x.cjs', NODE_PATH: './lib', DYLD_INSERT_LIBRARIES: './x.dylib', DYLD_LIBRARY_PATH: './d', LD_PRELOAD: './x.so', LD_LIBRARY_PATH: './l' };
    const environment = await provider('/bin/claude-stand-in').prepare({ ...spec, profile: { ...spec.profile, env: profileEnv } });
    const command = await environment.processCommand?.({ sessionId: 's1', cwd: join(dir, 'work'), args: ['-p'] });
    const names = ['NODE_OPTIONS', 'NODE_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'];
    expect(Object.keys(command?.env ?? {}).filter((name) => names.includes(name)), 'the host-side environment has none of them').toEqual([]);
    expect(command?.env['HOME'], 'the other variables stay').toBe('/h');
    expect(command?.args.slice(3, 5 + names.length).sort(), 'the program starts under env with PATH and each variable').toEqual(['/usr/bin/env', 'PATH=/usr/bin', ...names.map((name) => `${name}=${profileEnv[name as keyof typeof profileEnv]}`)].sort());
    expect(command?.args.slice(-2), 'the program follows the assignments').toEqual(['/bin/claude-stand-in', '-p']);
  });

  it('does the same for a check', async () => {
    const environment = await provider('/bin/claude-stand-in').prepare(spec);
    const command = await environment.toolCommand({ key: 'c1', cwd: join(dir, 'checkout'), argv: ['true'], env: { PATH: '/usr/bin', NODE_OPTIONS: '--require ./x.cjs', LD_PRELOAD: './x.so', CI: '1' }, network: 'none', writeDirs: [] });
    expect(Object.keys(command.env).sort(), 'the host-side environment has the PATH and CI only').toEqual(['CI', 'PATH']);
    expect(command.args.slice(3, 7), 'env carries PATH and the loader variables').toEqual(['/usr/bin/env', 'PATH=/usr/bin', 'NODE_OPTIONS=--require ./x.cjs', 'LD_PRELOAD=./x.so']);
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
