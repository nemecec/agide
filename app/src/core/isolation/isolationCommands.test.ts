import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry } from '../commands/CommandRegistry';
import type { ProfileService, ProfileSettings } from '../profile/types';
import { createIsolationProviders, registerIsolationCommands } from './defaultProviders';
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
