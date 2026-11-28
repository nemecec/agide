import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry } from '../commands/CommandRegistry';
import type { ProfileService, ProfileSettings } from '../profile/types';
import { buildIsolatingProvider, createIsolationProviders, registerIsolationCommands } from './defaultProviders';
import { createProfileHostTools } from './profileHostTools';
import type { ContainerProvider } from './ContainerProvider';
import type { SrtProvider } from './SrtProvider';
import type { IsolationStatus } from './statusTypes';

let dir: string;
let settings: ProfileSettings;
let registry: CommandRegistry;

const profile = (): ProfileService =>
  ({
    id: 'default',
    settings: () => settings,
    store: {
      updateSettings: (_id: string, change: Partial<ProfileSettings>) => {
        settings = { ...settings, ...change };
        return settings;
      },
    },
  }) as unknown as ProfileService;

const invoke = (id: string, input: unknown) => registry.invoke(id, input, { kind: 'ui' });
const executable = (name: string): string => {
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
  return path;
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'isolation-commands-')));
  settings = { schema: 1, claudeConfig: { mode: 'cli-default' }, tools: { mode: 'inherit' }, isolation: { provider: 'local' }, showBadge: true, shareUnread: true };
  registry = new CommandRegistry();
  const providers = createIsolationProviders({ sessionFilesDir: join(dir, 'sessions'), dataDir: dir, options: () => settings.isolation.options });
  registerIsolationCommands(registry, { providers, profile: profile() });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('isolation_status', () => {
  it('lists local, srt and container with their statements and says which one is selected', async () => {
    const result = await invoke('isolation_status', { srtBinary: join(dir, 'no-srt'), dockerBinary: join(dir, 'no-docker') });
    expect(result.ok, 'status succeeds').toBe(true);
    const status = (result as { value: IsolationStatus }).value;
    expect(status.selected, 'selected provider').toBe('local');
    expect(status.providers.map((row) => row.id), 'providers in order').toEqual(['local', 'srt', 'container']);
    const [local, srt, container] = status.providers;
    expect(local?.selectable, 'local is always selectable').toBe(true);
    expect(srt, 'srt with a missing binary is not selectable and carries the install step').toMatchObject({ selectable: false, check: { ok: false, fix: expect.stringContaining('sandbox-runtime') } });
    expect(container, 'container with no docker is not selectable').toMatchObject({ selectable: false, check: { ok: false, reason: 'Docker is not installed' } });
  });

  it('tries options without saving them', async () => {
    await invoke('isolation_status', { srtBinary: executable('srt') });
    expect(settings.isolation.options, 'nothing stored').toBeUndefined();
  });
});

describe('isolation_set_provider', () => {
  it('saves srt with its path once srt and claude pass the check', async () => {
    const claude = executable('claude');
    process.env['AGIDE_CLAUDE_BIN'] = claude;
    try {
      const result = await invoke('isolation_set_provider', { provider: 'srt', srtBinary: executable('srt') });
      expect(result, 'choice accepted').toEqual({ ok: true, value: { provider: 'srt' } });
      expect(settings.isolation, 'provider and path stored').toEqual({ provider: 'srt', options: { srtBinary: join(dir, 'srt') } });
    } finally {
      delete process.env['AGIDE_CLAUDE_BIN'];
    }
  });

  it('refuses srt when it is not installed, with the fix, and keeps the old choice', async () => {
    const result = await invoke('isolation_set_provider', { provider: 'srt', srtBinary: join(dir, 'no-srt') });
    expect(result, 'refused with the reason and the fix').toMatchObject({ ok: false, error: { message: expect.stringContaining('sandbox-runtime') } });
    expect(settings.isolation.provider, 'choice unchanged').toBe('local');
  });

  it('refuses the container provider because no real claude has run in it', async () => {
    const result = await invoke('isolation_set_provider', { provider: 'container' });
    expect(result.ok, 'refused').toBe(false);
    expect(settings.isolation.provider, 'choice unchanged').toBe('local');
  });

  it('returns to local and refuses an unknown provider', async () => {
    expect(await invoke('isolation_set_provider', { provider: 'local' }), 'local accepted').toEqual({ ok: true, value: { provider: 'local' } });
    expect((await invoke('isolation_set_provider', { provider: 'openshell' })).ok, 'openshell is not offered').toBe(false);
  });
});

describe('buildIsolatingProvider', () => {
  it('hands the host tools and the registry that they read, as one value, to the srt and the container provider', () => {
    const planted = join(dir, 'launched', 'bin');
    const host = createProfileHostTools({ options: () => ({}), claudeConfigDir: () => undefined, agentRoots: [], appPath: `${planted}:/usr/bin` });
    expect(host.tools.directories().includes(planted), 'the directory is on the lookup list before a launch makes it writable').toBe(true);
    const setup = { sessionFilesDir: join(dir, 'sessions'), dataDir: dir, options: () => undefined, host };
    for (const id of ['srt', 'container'] as const) {
      const provider = buildIsolatingProvider(id, setup, {}) as SrtProvider | ContainerProvider;
      expect([provider.options.hostTools, provider.options.writable], `${id} gets the tools and the registry`).toEqual([host.tools, host.writable]);
    }
    (buildIsolatingProvider('srt', setup, {}) as SrtProvider).options.writable?.add([join(dir, 'launched')]);
    expect(host.tools.directories().includes(planted), 'a directory the provider adds is one that the tools exclude').toBe(false);
  });

  it('gives the tools of the profile the cause of a refusal by a directory that a launch recorded', () => {
    const planted = join(dir, 'launched', 'bin');
    mkdirSync(planted, { recursive: true });
    writeFileSync(join(planted, 'wiring-recorded'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const host = createProfileHostTools({ options: () => ({}), claudeConfigDir: () => undefined, agentRoots: [], appPath: planted });
    host.writable.add([join(dir, 'launched')]);
    expect(() => host.tools.require('wiring-recorded', [], 'the program'), 'the cause').toThrow('the program (wiring-recorded) lies in a directory that an earlier agent launch made writable (such as the home directory), so it was not started');
  });

  it('leaves them out when the setup has none, so each provider builds tools over a registry of its own', () => {
    const provider = buildIsolatingProvider('srt', { sessionFilesDir: join(dir, 'sessions'), dataDir: dir, options: () => undefined }, {}) as SrtProvider;
    expect([provider.options.hostTools, provider.options.writable], 'no tools and no registry').toEqual([undefined, undefined]);
  });

  it('denies an srt session the read of the profile database when the setup names it', () => {
    const provider = buildIsolatingProvider('srt', { sessionFilesDir: join(dir, 'sessions'), dataDir: dir, options: () => undefined, profileDatabase: join(dir, 'app.db') }, {}) as SrtProvider;
    expect(provider.options.profileDatabase, 'the database of the setup').toBe(join(dir, 'app.db'));
  });

  it('puts the Claude directory that the container provider mounts writable into the registry when the provider is built', () => {
    const host = createProfileHostTools({ options: () => ({}), claudeConfigDir: () => undefined, agentRoots: [] });
    buildIsolatingProvider('container', { sessionFilesDir: join(dir, 'sessions'), dataDir: dir, options: () => undefined, host }, {});
    expect(host.writable.directories(), 'the directory below the data directory that the containers write').toContain(join(dir, 'isolation', 'container', 'claude'));
  });
});
