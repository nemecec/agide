import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContainerProvider } from './ContainerProvider';
import { LocalProvider } from './LocalProvider';
import { SrtProvider } from './SrtProvider';
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
  const provider = () => new SrtProvider({ sessionFilesDir: join(dir, 'sessions'), srtBinary: 'srt', settingsDir: join(dir, 'srt'), claudeBinary: '/bin/claude-stand-in' });

  it('wraps the program in srt with writes limited to the checkout and the listed directories and no hosts', async () => {
    const environment = await provider().prepare(spec);
    const command = await environment.toolCommand(launch());
    const settingsPath = join(dir, 'srt', 'check-1', 'srt.json');
    expect([command.file, command.args], 'srt, settings, separator, the program').toEqual(['srt', ['-s', settingsPath, '--', 'pnpm', 'test', '--run']]);
    expect(statSync(settingsPath).mode & 0o777, 'settings file mode').toBe(0o600);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { filesystem: { allowWrite: string[] }; network: { allowedDomains: string[] } };
    expect(settings.filesystem.allowWrite, 'the checkout and the temporary directory only').toEqual([join(dir, 'checkout'), join(dir, 'tmp')]);
    expect(settings.filesystem.allowWrite.includes(join(dir, 'claude')), 'the Claude configuration of the profile is not writable').toBe(false);
    expect(settings.network.allowedDomains, 'network none allows no host').toEqual([]);
    expect(command.env, 'the launch environment').toEqual({ PATH: '/usr/bin', CI: '1' });
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
