import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../core/events/index';
import { startAppModules, type AppModules } from '../appForTests';

let dir: string;
let app: AppModules | undefined;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm3-modules-'));
  delete process.env['CLAUDE_CONFIG_DIR'];
  delete process.env['AGIDE_PERMISSION_MODE'];
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe('milestone 3 modules in the real module graph', () => {
  it('provide every service in the documented order', async () => {
    app = await startAppModules({ dataDir: dir });
    expect(Object.keys(app.services), 'service order').toEqual(['profile', 'tree', 'mcp', 'permissions', 'sessions', 'layout', 'theme', 'inbox', 'browser', 'agents', 'tasks', 'swarm']);
  });

  it('read the default profile without permission settings as auto with the Bash sandbox off', async () => {
    app = await startAppModules({ dataDir: dir });
    expect(app.services.permissions.settings(), 'defaults of the existing default profile').toMatchObject({ defaultMode: 'auto', network: { bashSandbox: false } });
  });

  it('start sessions in auto and refuse bypass on a provider that does not isolate', async () => {
    app = await startAppModules({ dataDir: dir });
    const capabilities = { filesystem: 'host-user', network: 'none', login: 'host-keychain', hookTransports: ['inbox-dir'], transcripts: 'host-files' } as const;
    expect(app.services.permissions.resolveMode({ capabilities }), 'no request and no variable').toBe('auto');
    expect(() => app?.services.permissions.resolveMode({ requested: 'bypassPermissions', confirmBypassPermissions: true, capabilities }), 'bypass on the local provider').toThrow('bypassPermissions');
  });

  it('carry observation and agent changes to the bus', async () => {
    app = await startAppModules({ dataDir: dir });
    const events: AppEvent[] = [];
    app.events.onAny((event) => events.push(event));
    app.services.browser.observation.register('tab-1', 'github');
    app.services.browser.observation.setMode('tab-1', 'off', { kind: 'ui' });
    app.services.agents.store.apply({ kind: 'started', ref: { sessionId: 's1', agentKey: 'a1' }, at: '2026-11-17T10:00:00.000Z' });
    // The agents module coalesces changes into one event per 250 ms (0027 section 2).
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(events.map((event) => event.type), 'events on the bus').toEqual(['browser.observation_changed', 'agents.changed']);
  });

  it('refuse a browser tab in a folder that does not exist', async () => {
    app = await startAppModules({ dataDir: dir });
    await expect(app.services.browser.openTab({ folderId: 'f', url: 'https://example.com', createdBy: 'user' }), 'browser tab').rejects.toThrow('no folder f');
    expect(app.services.tasks.directories.defaultDir('f1').endsWith(join('Agide', 'f1')) || process.env['AGIDE_SESSION_CWD'] !== undefined, 'default directory').toBe(true);
  });

  it('keep browser tabs in the tree without Electron and report that no page is available', async () => {
    app = await startAppModules({ dataDir: dir });
    const ui = { kind: 'ui' } as const;
    const folder = app.services.tree.createFolder({ title: 'Work' });
    const { leafId } = await app.services.browser.openTab({ folderId: folder.id, url: 'https://example.com/', createdBy: 'user' });
    expect(await app.commands.invoke('browser_tab_state', { leafId }, ui), 'state from the stored tab').toMatchObject({ ok: true, value: { known: true, url: 'https://example.com/', loading: false, crashed: false } });
    expect(await app.commands.invoke('browser_nav', { leafId, action: 'reload' }, ui), 'history action without a view').toMatchObject({ ok: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await app.commands.invoke('browser_nav', { leafId, action: 'go', address: 'example.org' }, ui), 'go answers before the load ends').toMatchObject({ ok: true });
    await vi.waitFor(() => expect(errors, 'the failed load is logged').toHaveBeenCalledWith('load failed:', expect.objectContaining({ message: 'no browser view is available in this run' })));
    errors.mockRestore();
    const observed = await app.commands.invoke('surfaces_observe', { nodeId: leafId, kind: 'text' }, { kind: 'mcp', sessionId: 's1', folderId: folder.id });
    expect(observed.ok, 'reading a page without a view fails').toBe(false);
    app.services.tree.remove(leafId);
    expect(await app.commands.invoke('browser_tab_state', { leafId }, ui), 'forgotten with the leaf').toMatchObject({ ok: true, value: { known: false } });
  });

  it('offer the modes of the profile without bypass on a provider that does not isolate, and save settings that sessions then use', async () => {
    app = await startAppModules({ dataDir: dir });
    const ui = { kind: 'ui' } as const;
    const options = await app.commands.invoke('permissions_options', {}, ui);
    expect(options, 'options').toMatchObject({ ok: true, value: { bypassOffered: false, runsAsUser: true, settings: { defaultMode: 'auto' } } });
    const modes = ((options.ok ? options.value : {}) as { modes: { id: string }[] }).modes.map((mode) => mode.id);
    expect(modes, 'modes offered as profile defaults').toEqual(['auto', 'default', 'acceptEdits', 'plan']);
    const settings = { defaultMode: 'plan', outward: { 'slack.send': 'deny' }, network: { bashSandbox: false, allow: [], deny: [] }, trustAppCreatedFolders: false };
    expect(await app.commands.invoke('permissions_set', { settings }, ui), 'saved').toMatchObject({ ok: true, value: { saved: true } });
    expect(app.services.permissions.settings(), 'settings read back').toMatchObject({ defaultMode: 'plan', outward: { 'slack.send': 'deny' } });
  });

  it('refuse permission settings with a mode that cannot be a default or a class that does not exist', async () => {
    app = await startAppModules({ dataDir: dir });
    const ui = { kind: 'ui' } as const;
    const network = { bashSandbox: false, allow: [], deny: [] };
    const base = { defaultMode: 'auto', network, trustAppCreatedFolders: false };
    expect((await app.commands.invoke('permissions_set', { settings: { ...base, defaultMode: 'bypassPermissions' } }, ui)).ok, 'bypass as default').toBe(false);
    expect((await app.commands.invoke('permissions_set', { settings: { ...base, outward: { 'made.up': 'allow' } } }, ui)).ok, 'unknown class').toBe(false);
    expect((await app.commands.invoke('permissions_set', { settings: { ...base, outward: { 'slack.send': 'sometimes' } } }, ui)).ok, 'unknown outward mode').toBe(false);
    expect(app.services.permissions.settings(), 'settings unchanged').toMatchObject({ defaultMode: 'auto' });
  });

  it('keep the permission commands from agents', async () => {
    app = await startAppModules({ dataDir: dir });
    const agent = { kind: 'mcp', sessionId: 's1', folderId: 'f1' } as const;
    const network = { bashSandbox: false, allow: [], deny: [] };
    expect((await app.commands.invoke('permissions_set', { settings: { defaultMode: 'auto', network, trustAppCreatedFolders: true } }, agent)).ok, 'agent saving settings').toBe(false);
    expect((await app.commands.invoke('permissions_options', {}, agent)).ok, 'agent reading options').toBe(false);
  });

  it('answer terminal commands for a session that does not exist with not_found', async () => {
    app = await startAppModules({ dataDir: dir });
    const ui = { kind: 'ui' } as const;
    const inputs: [string, object][] = [
      ['session_write', { sessionId: 'nope', data: 'x' }],
      ['session_resize', { sessionId: 'nope', cols: 80, rows: 24 }],
      ['session_resume', { sessionId: 'nope' }],
      ['session_read_output', { sessionId: 'nope' }],
    ];
    for (const [id, input] of inputs) {
      const result = await app.commands.invoke(id, input, ui);
      expect(result.ok ? 'ok' : result.error.code, id).toBe('not_found');
    }
  });
});

