import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContainerProvider } from './ContainerProvider';
import { writeFakeSrt } from './fakeSrt';
import { INSIDE_PREFIX, isWithinAny } from './hostLaunch';
import { startedEnvironment } from './isolationProviderContract';
import { HostTools, hostDirectory, SYSTEM_DIRECTORIES } from './hostTools';
import { createProfileHostTools } from './profileHostTools';
import { LocalProvider } from './LocalProvider';
import { SrtProvider, srtToolEnvironment } from './SrtProvider';
import { launcherArgv } from './statusLauncher';
import { fakeDockerClient } from './fakeDocker';
import { IsolationError, type AgentEnvironment, type EnvironmentSpec, type ToolLaunch } from './types';

/** `toolCommand` runs a program of the user's project, such as the review check, with no more power than the agent had. */

let dir: string;
let spec: EnvironmentSpec;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'tool-command-')));
  spec = {
    key: { profileId: 'default' },
    profile: { claudeConfigDir: join(dir, 'claude'), env: { PATH: process.env['PATH'] ?? '' }, toolFiles: [] },
    workspace: { mode: 'bind', hostPath: join(dir, 'work') },
    network: { mode: 'unrestricted' },
    appEndpoint: { port: 4567 },
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const launch = (patch: Partial<ToolLaunch> = {}): ToolLaunch => ({
  key: 'check-1',
  cwd: join(dir, 'checkout'),
  argv: ['pnpm', 'test', '--run'],
  env: { PATH: '/usr/bin', CI: '1' },
  network: 'none',
  writeDirs: [join(dir, 'tmp')],
  ...patch,
});

describe('local', () => {
  it('runs the program on the host with exactly the environment of the launch', async () => {
    const environment: AgentEnvironment = await new LocalProvider({ sessionFilesDir: join(dir, 'sessions') }).prepare(spec);
    const command = await environment.toolCommand(launch());
    expect([command.file, command.args, command.cwd], 'the argv is the command').toEqual(['pnpm', ['test', '--run'], join(dir, 'checkout')]);
    expect(command.env, 'the environment is the launch environment and nothing of the profile is added').toEqual({ PATH: '/usr/bin', CI: '1' });
  });

  it('refuses a launch without a command', async () => {
    const environment = await new LocalProvider({ sessionFilesDir: join(dir, 'sessions') }).prepare(spec);
    expect(() => environment.toolCommand(launch({ argv: [] })), 'an empty argv').toThrow(IsolationError);
  });
});

/** The PATH of a host-side process: the trusted entries, then the system directories. */
const hostPath = (...entries: string[]): string => [...entries, ...SYSTEM_DIRECTORIES].join(':');

describe('srt', () => {
  const binDir = () => join(dir, 'bin');
  const provider = (appPath?: string) => {
    mkdirSync(binDir(), { recursive: true });
    writeFakeSrt(binDir());
    return new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary: 'srt', appPath: appPath ?? binDir(), settingsDir: join(dir, 'srt'), claudeBinary: '/bin/claude-stand-in' });
  };

  it('wraps the program in srt with writes limited to the checkout and the listed directories and no hosts', async () => {
    const environment = await provider().prepare(spec);
    const command = await environment.toolCommand(launch());
    const settingsPath = join(dir, 'srt', 'check-1', 'srt.json');
    expect([command.file, command.args], 'srt as an absolute file, settings, separator, the launcher shell that changes into the checkout and sets the named variables, with the program as its arguments').toEqual([
      join(binDir(), 'srt'),
      ['-s', settingsPath, '--', ...launcherArgv(['pnpm', 'test', '--run'], { directory: join(dir, 'checkout'), inside: ['PATH', 'CI'] })],
    ]);
    expect(command.args.slice(-3), 'the program and its arguments end the argv').toEqual(['pnpm', 'test', '--run']);
    expect(statSync(settingsPath).mode & 0o777, 'settings file mode').toBe(0o600);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { filesystem: { allowWrite: string[] }; network: { allowedDomains: string[] } };
    expect(settings.filesystem.allowWrite, 'the checkout and the temporary directory only').toEqual([join(dir, 'checkout'), join(dir, 'tmp')]);
    expect(settings.filesystem.allowWrite.includes(join(dir, 'claude')), 'the Claude configuration of the profile is not writable').toBe(false);
    expect(settings.network.allowedDomains, 'network none allows no host').toEqual([]);
    expect(command.env, 'the host-side process has the trusted PATH of the app and the launch variables under the inert prefix only').toEqual({ PATH: hostPath(binDir()), [`${INSIDE_PREFIX}PATH`]: '/usr/bin', [`${INSIDE_PREFIX}CI`]: '1' });
  });

  it('allows loopback binding only when the launch says the program needs it', async () => {
    const environment = await provider().prepare(spec);
    const binding = async (patch: Partial<ToolLaunch>): Promise<boolean> => {
      await environment.toolCommand(launch(patch));
      return (JSON.parse(readFileSync(join(dir, 'srt', 'check-1', 'srt.json'), 'utf8')) as { network: { allowLocalBinding: boolean } }).network.allowLocalBinding;
    };
    expect(await binding({}), 'a launch without the flag').toBe(false);
    expect(await binding({ loopback: false }), 'a launch that says no').toBe(false);
    expect(await binding({ loopback: true }), 'a launch that says yes').toBe(true);
  });

  it('starts srt in a directory that holds no checkout and never resolves it through the checkout, a relative or an empty PATH entry', async () => {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'bin'), { recursive: true });
    writeFileSync(join(checkout, 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(checkout, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const profilePath = ['bin', '', '.', './node_modules/.bin', join(checkout, 'bin'), '/usr/bin', ''].join(':');
    const environment = await provider(['bin', '', '.', join(checkout, 'bin'), checkout, binDir(), ''].join(':')).prepare(spec);
    const command = await environment.toolCommand(launch({ cwd: checkout, env: { PATH: profilePath, CI: '1' } }));
    expect(command.file, 'srt is the one on the absolute entry outside the checkout').toBe(join(binDir(), 'srt'));
    expect(command.env['PATH'], 'the host-side PATH has that entry and the system directories only: nothing relative, empty or inside the checkout').toBe(hostPath(binDir()));
    expect(command.cwd, 'the working directory of srt is the neutral one').toBe(hostDirectory());
    expect(isWithinAny(command.cwd, [checkout]), 'the working directory of srt is not inside the checkout').toBe(false);
    expect(startedEnvironment(command)['PATH'], 'the PATH of the profile reaches the program inside the sandbox unchanged').toBe(profilePath);
    expect(command.args.join('\n'), 'and is no argument').not.toContain(profilePath);
  });

  it('gives a program without PATH none inside the sandbox, and refuses to start when srt is only on an entry the program controls', async () => {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'bin'), { recursive: true });
    writeFileSync(join(checkout, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const command = await (await provider().prepare(spec)).toolCommand(launch({ env: { CI: '1' } }));
    expect(startedEnvironment(command)['PATH'], 'the launcher removes PATH').toBeUndefined();
    const trapped = await provider(`bin::.:${join(checkout, 'bin')}`).prepare(spec);
    await expect(trapped.toolCommand(launch({ cwd: checkout })), 'srt is not found on a trusted entry').rejects.toThrow(IsolationError);
  });

  it('does not take an entry that reaches the checkout through a link', async () => {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'bin'), { recursive: true });
    symlinkSync(join(checkout, 'bin'), join(dir, 'linked-bin'));
    writeFileSync(join(checkout, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const environment = await provider(`${join(dir, 'linked-bin')}:${binDir()}`).prepare(spec);
    const command = await environment.toolCommand(launch({ cwd: checkout }));
    expect([command.file, command.env['PATH']], 'the link to the checkout is dropped').toEqual([join(binDir(), 'srt'), hostPath(binDir())]);
  });

  it('allows the development hosts when the launch asks for them', async () => {
    const environment = await provider().prepare(spec);
    await environment.toolCommand(launch({ network: 'development' }));
    const settings = JSON.parse(readFileSync(join(dir, 'srt', 'check-1', 'srt.json'), 'utf8')) as { network: { allowedDomains: string[] } };
    expect(settings.network.allowedDomains, 'development hosts').toEqual(expect.arrayContaining(['github.com', 'registry.npmjs.org']));
  });
});

describe('srt: the node that the shim of srt runs first', () => {
  it('refuses a configured srt whose shim directory holds a node that leads into an excluded directory, while that directory is not on the PATH', async () => {
    const excluded = join(dir, 'agent');
    const marker = join(dir, 'marker');
    mkdirSync(excluded);
    writeFileSync(join(excluded, 'node'), `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, { mode: 0o755 });
    mkdirSync(join(dir, 'pkg', 'dist'), { recursive: true });
    writeFileSync(join(dir, 'pkg', 'dist', 'cli.js'), '#!/usr/bin/env node\n', { mode: 0o755 });
    mkdirSync(join(dir, 'shim'));
    const shim = join(dir, 'shim', 'srt');
    writeFileSync(shim, `#!/bin/sh\nbasedir=$(dirname "$0")\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node" '${join(dir, 'pkg', 'dist', 'cli.js')}' "$@"\nfi\nexec node '${join(dir, 'pkg', 'dist', 'cli.js')}' "$@"\n# cmd-shim-target=${join(dir, 'pkg', 'dist', 'cli.js')}\n`, { mode: 0o755 });
    symlinkSync(join(excluded, 'node'), join(dir, 'shim', 'node'));
    const tools = new HostTools({ appPath: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), excluded: () => [excluded], fixedDirectories: [] });
    const outcome = await srtToolEnvironment({ srtBinary: shim, settingsDir: join(dir, 'srt-checks'), hostTools: tools })
      .toolCommand(launch({ argv: ['sh', '-c', 'exit 1'] }))
      .then((command) => spawnSync(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, timeout: 20_000 }).status, (error: unknown) => error);
    expect(outcome, 'the launch is refused before anything starts').toBeInstanceOf(IsolationError);
    expect((outcome as IsolationError).detail, 'the detail names the node beside the shim').toBe(join(dir, 'shim', 'node'));
    expect(existsSync(marker), 'the node of the excluded directory did not run').toBe(false);
  });

  it('refuses a configured srt that is a link to an old-form shim when a node beside the link leads into an excluded directory, while the link directory is not on the PATH', async () => {
    const excluded = join(dir, 'agent');
    const marker = join(dir, 'marker');
    mkdirSync(excluded);
    writeFileSync(join(excluded, 'node'), `#!/bin/sh\ntouch '${marker}'\nexit 0\n`, { mode: 0o755 });
    mkdirSync(join(dir, 'S'));
    writeFileSync(join(dir, 'S', 'cli.js'), '#!/usr/bin/env node\n', { mode: 0o755 });
    // The form of older pnpm and cmd-shim: the directory of $0 as it was started, links not resolved.
    writeFileSync(join(dir, 'S', 'srt'), `#!/bin/sh\nbasedir=$(dirname "$0")\nif [ -x "$basedir/node" ]; then\n  exec "$basedir/node" "$basedir/cli.js" "$@"\nfi\nexec node "$basedir/cli.js" "$@"\n# cmd-shim-target=${join(dir, 'S', 'cli.js')}\n`, { mode: 0o755 });
    mkdirSync(join(dir, 'L'));
    symlinkSync(join(dir, 'S', 'srt'), join(dir, 'L', 'srt'));
    symlinkSync(join(excluded, 'node'), join(dir, 'L', 'node'));
    const tools = new HostTools({ appPath: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), excluded: () => [excluded], fixedDirectories: [] });
    const outcome = await srtToolEnvironment({ srtBinary: join(dir, 'L', 'srt'), settingsDir: join(dir, 'srt-checks'), hostTools: tools })
      .toolCommand(launch({ argv: ['sh', '-c', 'exit 1'] }))
      .then((command) => spawnSync(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, timeout: 20_000 }).status, (error: unknown) => error);
    expect(outcome, 'the launch is refused before anything starts').toBeInstanceOf(IsolationError);
    expect((outcome as IsolationError).detail, 'the detail names the node beside the link').toBe(join(dir, 'L', 'node'));
    expect(existsSync(marker), 'the node of the excluded directory did not run').toBe(false);
  });
});

describe('srt: programs the agents of the profile can write', () => {
  const PROGRAMS = ['srt', 'node', 'env', 'which', 'bash', 'sed', 'uname', 'dirname', 'git', 'docker'];
  const markers = (): string[] => (existsSync(join(dir, 'markers')) ? readdirSync(join(dir, 'markers')) : []);
  const plant = (directory: string): void => {
    mkdirSync(join(dir, 'markers'), { recursive: true });
    mkdirSync(directory, { recursive: true });
    for (const name of PROGRAMS) writeFileSync(join(directory, name), `#!/bin/sh\ntouch '${join(dir, 'markers', name)}'\nexit 0\n`, { mode: 0o755 });
  };
  /** The trusted side: the stand-in srt that ends like srt 0.0.83 and a node that is a file. */
  const trusted = (): string => {
    mkdirSync(join(dir, 'trusted'), { recursive: true });
    writeFakeSrt(join(dir, 'trusted'));
    writeFileSync(join(dir, 'trusted', 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    return join(dir, 'trusted');
  };
  const profile = (appPath: string, extraWritePaths: string[] = []) => createProfileHostTools({ options: () => ({ extraWritePaths }), claudeConfigDir: () => join(dir, 'claude'), agentRoots: [join(dir, 'agents')], appPath }).tools;
  const environment = (appPath: string, extraWritePaths: string[] = []) => srtToolEnvironment({ srtBinary: 'srt', settingsDir: join(dir, 'srt-checks'), hostTools: profile(appPath, extraWritePaths) });
  const spots: [string, () => string, () => string[]][] = [
    ['a directory of extraWritePaths', () => join(dir, 'cargo'), () => [join(dir, 'cargo')]],
    ['a directory below the Claude configuration directory', () => join(dir, 'claude', 'local'), () => []],
    ['a directory below the root of the agents workspaces', () => join(dir, 'agents', 'swarm', 'tree'), () => []],
  ];

  it.each(spots)('does not start srt, node, env or another program that lies in %s on the PATH of the app: the check fails as the program does', async (_name, spot, extra) => {
    plant(join(spot(), 'bin'));
    const tool = environment([join(spot(), 'bin'), trusted()].join(':'), extra());
    const command = await tool.toolCommand(launch({ cwd: join(dir, 'checkout'), argv: ['/bin/sh', '-c', 'echo tests failed; exit 1'], env: { PATH: '/usr/bin:/bin', CI: '1' } }));
    expect(command.file, 'the trusted srt').toBe(join(trusted(), 'srt'));
    mkdirSync(join(dir, 'checkout'), { recursive: true });
    const finished = spawnSync(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, encoding: 'utf8' });
    expect([finished.status, finished.stdout.trim()], 'the failing check reads as a failure').toEqual([1, 'tests failed']);
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  it.each(spots)('refuses to start the check when the only srt lies in %s, and the reason names no path', async (_name, spot, extra) => {
    plant(join(spot(), 'bin'));
    const failure = await environment(join(spot(), 'bin'), extra()).toolCommand(launch()).catch((error: unknown) => error);
    expect(failure, 'an isolation error').toBeInstanceOf(IsolationError);
    expect((failure as IsolationError).message, 'the fixed reason').toBe('the sandbox runtime (srt) exists only in a directory that an agent may write, or runs code that lies in one, so it was not started');
    expect((failure as IsolationError).detail, 'the detail names the stand-in').toBe(join(spot(), 'bin', 'srt'));
    expect(markers(), 'no stand-in ran').toEqual([]);
  });

  it('does not use a srt that lies in a directory of the launch itself (the checkout, the temporary directory, the clones)', async () => {
    plant(join(dir, 'clones', 'bin'));
    const failure = await environment([join(dir, 'clones', 'bin')].join(':')).toolCommand(launch({ writeDirs: [join(dir, 'clones')] })).catch((error: unknown) => error);
    expect((failure as IsolationError).message, 'the clone directory is excluded for this launch').toContain('exists only in a directory that an agent may write');
  });

  it('keeps every variable of the check environment that is not allowed out of the host-side process', async () => {
    const command = await environment(trusted()).toolCommand(launch({ env: { PATH: '/usr/bin', HOME: '/h', CI: '1', NODE_OPTIONS: '--require ./x.cjs', DYLD_INSERT_LIBRARIES: './x.dylib', 'BASH_FUNC_uname%%': '() { ./x; }', SHELLOPTS: 'xtrace', PS4: '$(./x)' } }));
    expect(Object.keys(command.env).filter((name) => !name.startsWith(INSIDE_PREFIX)).sort(), 'the host-side environment has HOME, the PATH and the carriers only').toEqual(['HOME', 'PATH']);
    const dyld = process.platform === 'darwin' ? {} : { DYLD_INSERT_LIBRARIES: './x.dylib' };
    expect(startedEnvironment(command), 'the program gets the other variables a shell can set; an exported function, a read-only name of bash and on macOS a DYLD_ name are dropped').toEqual({ HOME: '/h', PATH: '/usr/bin', CI: '1', NODE_OPTIONS: '--require ./x.cjs', ...dyld, PS4: '$(./x)' });
    expect(command.dropped, 'the dropped names, for the log of the run').toEqual(['DYLD_INSERT_LIBRARIES', 'BASH_FUNC_uname%%', 'SHELLOPTS'].filter((name) => process.platform === 'darwin' || !name.startsWith('DYLD_')));
  });
});

describe('container', () => {
  /** A docker client that is a file of the test: nothing here talks to an engine. */
  const provider = () => new ContainerProvider({ sessionFilesDir: join(dir, 'sessions'), dockerBinary: fakeDockerClient(join(dir, 'client')), image: 'agide-test-image', claudeConfigDir: join(dir, 'claude'), user: '1000:1000' });

  it('runs the program in the image with the checkout mounted, no network and the environment names only', async () => {
    const environment = await provider().prepare(spec);
    const command = await environment.toolCommand(launch({ env: { PATH: '/usr/bin', CI: '1', TOKEN_FOR_CHECK: 'value-that-must-not-be-an-argument' } }));
    expect(command.file, 'the docker client, as an absolute file').toBe(join(dir, 'client', 'docker'));
    expect(command.args.slice(0, 4), 'docker run without a terminal and with no network').toEqual(['run', '--network', 'none', '-i']);
    expect(command.args, 'the checkout is mounted').toContain(`type=bind,src=${join(dir, 'checkout')},dst=${join(dir, 'checkout')}`);
    expect(command.args, 'the extra directory is mounted').toContain(`type=bind,src=${join(dir, 'tmp')},dst=${join(dir, 'tmp')}`);
    expect(command.args.slice(command.args.indexOf('agide-test-image')), 'the image, then the program and its arguments').toEqual(['agide-test-image', 'pnpm', 'test', '--run']);
    expect(command.args.join(' ').includes('value-that-must-not-be-an-argument'), 'no value is an argument').toBe(false);
    expect(command.args, 'the variable enters by name').toContain('TOKEN_FOR_CHECK');
    expect(command.env['TOKEN_FOR_CHECK'], 'and its value is in the environment of the docker client').toBe('value-that-must-not-be-an-argument');
  });

  it('leaves the default network when the launch asks for the development hosts', async () => {
    const command = await (await provider().prepare(spec)).toolCommand(launch({ network: 'development' }));
    expect(command.args.includes('--network'), 'no network flag').toBe(false);
  });
});
