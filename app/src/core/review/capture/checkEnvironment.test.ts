import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostTools } from '../../isolation/hostTools';
import { launcherArgv } from '../../isolation/statusLauncher';
import { resolveCheckEnvironment, type CheckEnvironmentInput } from './checkEnvironment';
import { removeTempDirs, tempDir } from './gitFixtures';

afterEach(() => removeTempDirs());

function input(patch: Partial<CheckEnvironmentInput> = {}): CheckEnvironmentInput {
  return { provider: 'local', bashSandbox: false, profileEnv: { HOME: '/h' }, srt: { binary: '/nonexistent/srt', settingsDir: tempDir('srt-settings') }, ...patch };
}

function fakeSrt(): string {
  const path = join(tempDir('bin'), 'srt');
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

describe('resolveCheckEnvironment', () => {
  it('runs a plain process under the launcher shell only for a local profile without the Bash sandbox', async () => {
    const resolved = resolveCheckEnvironment(input());
    expect(resolved.kind, 'ready').toBe('ready');
    if (resolved.kind !== 'ready') return;
    expect(resolved.enforcesNetwork, 'a plain process confines nothing').toBe(false);
    const command = await resolved.environment.toolCommand({ key: 'k', cwd: '/w', argv: ['pnpm', 'test'], env: { A: '1' }, network: 'none', writeDirs: [] });
    const [file, ...args] = launcherArgv(['pnpm', 'test']);
    expect([command.file, command.args, command.cwd, command.env], 'the program under the launcher shell, in the checkout, with the environment it was given').toEqual([file, args, '/w', { A: '1' }]);
  });

  it('does not run the check when the Bash sandbox is on and srt is missing', () => {
    expect(resolveCheckEnvironment(input({ bashSandbox: true })), 'local profile with the sandbox').toEqual({ kind: 'unavailable', why: 'the sandbox runtime is not installed' });
    expect(resolveCheckEnvironment(input({ provider: 'srt' })).kind, 'the srt provider without srt').toBe('unavailable');
  });

  it('wraps the check in srt when the Bash sandbox is on and srt is installed', async () => {
    const binary = fakeSrt();
    const settingsDir = tempDir('srt-settings');
    const resolved = resolveCheckEnvironment(input({ bashSandbox: true, srt: { binary, settingsDir } }));
    expect(resolved.kind, 'ready').toBe('ready');
    if (resolved.kind !== 'ready') return;
    expect(resolved.enforcesNetwork, 'srt enforces the network of the check').toBe(true);
    const command = await resolved.environment.toolCommand({ key: 'run-1', cwd: '/w/checkout', argv: ['pnpm', 'test'], env: { A: '1' }, network: 'none', writeDirs: [] });
    expect(command.file, 'srt is the program').toBe(binary);
    expect(command.args.slice(0, 1).concat(command.args.slice(2)), 'settings flag, separator, then the command under the launcher shell that changes into the checkout').toEqual(['-s', '--', ...launcherArgv(['pnpm', 'test'], { directory: '/w/checkout', inside: ['A'] })]);
  });

  it('limits the writes of the check to its checkout and its temporary directory, and its network to nothing', async () => {
    const settingsDir = tempDir('srt-settings');
    const resolved = resolveCheckEnvironment(input({ bashSandbox: true, srt: { binary: fakeSrt(), settingsDir } }));
    if (resolved.kind !== 'ready') throw new Error('expected a ready environment');
    const checkout = tempDir('checkout');
    const scratch = tempDir('scratch');
    const command = await resolved.environment.toolCommand({ key: 'run-2', cwd: checkout, argv: ['pnpm', 'test'], env: {}, network: 'none', writeDirs: [scratch] });
    const settings = JSON.parse(readFileSync(command.args[1]!, 'utf8')) as { filesystem: { allowWrite: string[] }; network: { allowedDomains: string[] } };
    expect(new Set(settings.filesystem.allowWrite), 'the checkout, the temporary directory and their resolved forms').toEqual(new Set([checkout, realpathSync(checkout), scratch, realpathSync(scratch)]));
    expect(settings.network.allowedDomains, 'no host is reachable').toEqual([]);
  });

  it('removes the settings file of a key when the run releases it', async () => {
    const settingsDir = tempDir('srt-settings');
    const resolved = resolveCheckEnvironment(input({ bashSandbox: true, srt: { binary: fakeSrt(), settingsDir } }));
    if (resolved.kind !== 'ready') throw new Error('expected a ready environment');
    const command = await resolved.environment.toolCommand({ key: 'run-3', cwd: '/w/checkout', argv: ['true'], env: {}, network: 'none', writeDirs: [] });
    expect(existsSync(command.args[1]!), 'the settings file exists while the run lives').toBe(true);
    resolved.environment.release?.('run-3');
    expect(existsSync(command.args[1]!), 'the settings file is gone after the release').toBe(false);
  });

  it('does not run the check when the only srt lies in a directory the agents of the profile may write, and says so in a reason that names no path', () => {
    const bin = dirname(fakeSrt());
    const settingsDir = tempDir('srt-settings');
    const resolve = (excluded: string[]) => resolveCheckEnvironment(input({ bashSandbox: true, srt: { binary: 'srt', settingsDir, hostTools: new HostTools({ appPath: bin, excluded: () => excluded, fixedDirectories: [] }) } }));
    expect(resolve([bin]), 'an excluded directory').toEqual({ kind: 'unavailable', why: 'the sandbox runtime exists only in a directory that an agent may write' });
    expect(resolve([dirname(bin)]), 'a parent of it is excluded as well').toMatchObject({ kind: 'unavailable' });
    expect(resolve([join(bin, 'other')]).kind, 'a directory below it or beside it is not').toBe('ready');
  });

  it('looks a bare srt name up on the absolute entries of the PATH of the app, never on a relative or empty one', () => {
    const bin = dirname(fakeSrt());
    const settingsDir = tempDir('srt-settings');
    const resolve = (appPath: string) => resolveCheckEnvironment(input({ bashSandbox: true, srt: { binary: 'srt', settingsDir, hostTools: new HostTools({ appPath, excluded: () => [], fixedDirectories: [] }) } })).kind;
    expect(resolve(bin), 'an absolute entry').toBe('ready');
    expect(resolve(relative(process.cwd(), bin)), 'the same directory spelled relative to the working directory').toBe('unavailable');
    expect(resolve(`:${bin.slice(0, 0)}`), 'an empty entry only').toBe('unavailable');
  });

  it('does not connect the container provider', () => {
    expect(resolveCheckEnvironment(input({ provider: 'container' })).kind, 'not connected').toBe('unavailable');
  });
});
