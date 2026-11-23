import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContainerProvider } from './ContainerProvider';
import { writeFakeSrt } from './fakeSrt';
import { insideArgv, isWithinAny, neutralDirectory } from './hostLaunch';
import { LocalProvider } from './LocalProvider';
import { SrtProvider } from './SrtProvider';
import { launcherArgv } from './statusLauncher';
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
    expect([command.file, command.args], 'srt as an absolute file, settings, separator, env with the profile PATH, the launcher shell that changes into the checkout with the program as its arguments').toEqual([
      join(binDir(), 'srt'),
      ['-s', settingsPath, '--', ...insideArgv('/usr/bin', launcherArgv(['pnpm', 'test', '--run'], { directory: join(dir, 'checkout') }))],
    ]);
    expect(command.args.slice(-3), 'the program and its arguments end the argv').toEqual(['pnpm', 'test', '--run']);
    expect(statSync(settingsPath).mode & 0o777, 'settings file mode').toBe(0o600);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { filesystem: { allowWrite: string[] }; network: { allowedDomains: string[] } };
    expect(settings.filesystem.allowWrite, 'the checkout and the temporary directory only').toEqual([join(dir, 'checkout'), join(dir, 'tmp')]);
    expect(settings.filesystem.allowWrite.includes(join(dir, 'claude')), 'the Claude configuration of the profile is not writable').toBe(false);
    expect(settings.network.allowedDomains, 'network none allows no host').toEqual([]);
    expect(command.env, 'the launch environment, with the trusted PATH of the app for the host-side process').toEqual({ PATH: binDir(), CI: '1' });
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
    expect(command.env['PATH'], 'the host-side PATH has that entry only: nothing relative, empty or inside the checkout').toBe(binDir());
    expect(command.cwd, 'the working directory of srt is the neutral one').toBe(neutralDirectory(join(dir, 'srt')));
    expect(isWithinAny(command.cwd, [checkout]), 'the working directory of srt is not inside the checkout').toBe(false);
    expect(command.args.slice(3, 5), 'the PATH of the profile reaches the program inside the sandbox unchanged').toEqual(['/usr/bin/env', `PATH=${profilePath}`]);
  });

  it('gives a program without PATH none inside the sandbox, and refuses to start when srt is only on an entry the program controls', async () => {
    const checkout = join(dir, 'checkout');
    mkdirSync(join(checkout, 'bin'), { recursive: true });
    writeFileSync(join(checkout, 'bin', 'srt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const command = await (await provider().prepare(spec)).toolCommand(launch({ env: { CI: '1' } }));
    expect(command.args.slice(3, 6), 'env removes PATH').toEqual(['/usr/bin/env', '-u', 'PATH']);
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
    expect([command.file, command.env['PATH']], 'the link to the checkout is dropped').toEqual([join(binDir(), 'srt'), binDir()]);
  });

  it('allows the development hosts when the launch asks for them', async () => {
    const environment = await provider().prepare(spec);
    await environment.toolCommand(launch({ network: 'development' }));
    const settings = JSON.parse(readFileSync(join(dir, 'srt', 'check-1', 'srt.json'), 'utf8')) as { network: { allowedDomains: string[] } };
    expect(settings.network.allowedDomains, 'development hosts').toEqual(expect.arrayContaining(['github.com', 'registry.npmjs.org']));
  });
});

describe('container', () => {
  const provider = () => new ContainerProvider({ sessionFilesDir: join(dir, 'sessions'), dockerBinary: 'docker', image: 'agide-test-image', claudeConfigDir: join(dir, 'claude'), user: '1000:1000' });

  it('runs the program in the image with the checkout mounted, no network and the environment names only', async () => {
    const environment = await provider().prepare(spec);
    const command = await environment.toolCommand(launch({ env: { PATH: '/usr/bin', CI: '1', TOKEN_FOR_CHECK: 'value-that-must-not-be-an-argument' } }));
    expect(command.file, 'the docker client').toBe('docker');
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
