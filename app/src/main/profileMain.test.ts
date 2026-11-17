import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../core/commands/index';
import { createAppEventBus } from '../core/events/index';
import { profilePaths } from '../core/profile/index';
import { openStore } from '../core/store/index';
import type { Desktop } from './context';
import { initModules } from './modules';
import { bootProfile } from './profileBoot';
import { installProfileHost } from './profileHost';
import { createProfileLauncher } from './profileLauncher';

const dirs: string[] = [];
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agide-main-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('profile boot', () => {
  it('creates the default profile on a new root and sets up its data directory with mode 0700', () => {
    const root = tmp();
    const boot = bootProfile({ argv: [], env: { AGIDE_ROOT: root }, defaultRoot: '/unused' });
    if (boot.kind !== 'profile') throw new Error(`expected a profile, got ${boot.kind}`);
    expect(boot.resolved.id, 'default profile').toBe('default');
    expect(boot.dataDir, 'data directory path').toBe(profilePaths(root, 'default').data);
    expect(statSync(boot.dataDir).mode & 0o777, 'data directory mode').toBe(0o700);
  });

  it('opens the profile named by --profile and falls back to default with a notice for an unknown one', () => {
    const root = tmp();
    bootProfile({ argv: [], env: { AGIDE_ROOT: root }, defaultRoot: '/unused' });
    const unknown = bootProfile({ argv: ['--profile=nope'], env: { AGIDE_ROOT: root }, defaultRoot: '/unused' });
    expect(unknown.kind === 'profile' && unknown.resolved.id, 'fallback id').toBe('default');
    expect(unknown.kind === 'profile' && unknown.notice, 'notice').toContain('nope');
  });

  it('keeps the single unnamed profile mode when only AGIDE_USER_DATA is set', () => {
    expect(bootProfile({ argv: [], env: { AGIDE_USER_DATA: '/x' }, defaultRoot: '/unused' }).kind, 'legacy mode').toBe('legacy');
  });
});

describe('profile launcher', () => {
  const make = () => {
    const focus = vi.fn();
    const child = { unref: vi.fn(), on: vi.fn() };
    const spawn = vi.fn(() => child);
    const open = createProfileLauncher({ ownId: 'a', focusOwnWindow: focus, executable: '/bin/app', appArgs: ['entry.js'], env: { X: '1' }, spawn });
    return { open, focus, spawn, child };
  };

  it('focuses the own window for the own profile and starts nothing', () => {
    const { open, focus, spawn } = make();
    open('a');
    expect(focus, 'own window focused').toHaveBeenCalledOnce();
    expect(spawn, 'no process started').not.toHaveBeenCalled();
  });

  it('starts another profile detached with --profile and the base environment', () => {
    const { open, spawn, child } = make();
    open('b');
    expect(spawn, 'spawn call').toHaveBeenCalledWith('/bin/app', ['entry.js', '--profile=b'], { detached: true, stdio: 'ignore', env: { X: '1' } });
    expect(child.unref, 'child is released').toHaveBeenCalled();
  });
});

describe('profile module on a file store', () => {
  it('lists profiles, creates one through the command, opens it and carries the unread count to registry and badge', async () => {
    const root = tmp();
    const boot = bootProfile({ argv: [], env: { AGIDE_ROOT: root }, defaultRoot: '/unused' });
    if (boot.kind !== 'profile') throw new Error('expected a profile');
    const opened: string[] = [];
    installProfileHost({ open: (id) => opened.push(id) });
    const badge = vi.fn();
    const desktop: Desktop = { notify: vi.fn(), setBadgeCount: badge };
    const events = createAppEventBus();
    const commands = new CommandRegistry();
    const db = openStore(':memory:');
    const modules = await initModules({ events, commands, db, dataDir: boot.dataDir, profile: boot.resolved, desktop });
    try {
      const created = await commands.invoke('profile_create', { name: 'Work', colour: '#336699' }, { kind: 'ui' });
      expect(created, 'create result').toMatchObject({ ok: true, value: { id: 'work' } });
      expect(opened, 'new profile is opened').toEqual(['work']);
      const listed = await commands.invoke('profile_list', {}, { kind: 'ui' });
      expect(listed.ok && (listed.value as { profiles: { id: string }[] }).profiles.map((p) => p.id), 'both profiles listed').toEqual(['default', 'work']);
      events.emit({ type: 'inbox.unread_changed', count: 3 });
      expect(badge, 'dock badge follows the count').toHaveBeenLastCalledWith(3);
      expect(modules.services.profile.registry.statuses()[0], 'registry entry holds the count').toMatchObject({ profileId: 'default', unread: 3 });
      expect(commands.list().filter((c) => c.id.startsWith('profile_')).every((c) => !c.mcp), 'no profile command is an MCP tool').toBe(true);
    } finally {
      await modules.dispose();
      db.close();
      installProfileHost({ open: () => undefined });
    }
  });

  it('keeps the badge off when the profile setting says so', async () => {
    const root = tmp();
    const boot = bootProfile({ argv: [], env: { AGIDE_ROOT: root }, defaultRoot: '/unused' });
    if (boot.kind !== 'profile') throw new Error('expected a profile');
    const badge = vi.fn();
    const events = createAppEventBus();
    const db = openStore(':memory:');
    const modules = await initModules({
      events, commands: new CommandRegistry(), db, dataDir: boot.dataDir, profile: boot.resolved,
      desktop: { notify: vi.fn(), setBadgeCount: badge },
    });
    try {
      badge.mockClear();
      modules.services.profile.store.updateSettings('default', { showBadge: false });
      events.emit({ type: 'inbox.unread_changed', count: 2 });
      expect(badge, 'badge untouched').not.toHaveBeenCalled();
    } finally {
      await modules.dispose();
      db.close();
    }
  });
});
