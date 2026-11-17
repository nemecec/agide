import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppEvent } from '../../core/events/index';
import { PANE_TYPES } from '../../core/blocks/index';
import { startAppModules, type AppModules } from '../appForTests';

let dir: string;
let app: AppModules | undefined;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'm2-modules-'));
  delete process.env['CLAUDE_CONFIG_DIR'];
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe('milestone 2 module stubs in the real module graph', () => {
  it('run the default profile and publish its own registry entry', async () => {
    app = await startAppModules({ dataDir: dir });
    const { profile } = app.services;
    expect(profile.id, 'profile without resolution').toBe('default');
    expect(profile.settings().claudeConfig, 'default profile keeps the CLI login').toEqual({ mode: 'cli-default' });
    expect(profile.registry.statuses(), 'own entry with the count the inbox reports at init').toEqual([{ profileId: 'default', running: true, unread: 0 }]);
  });

  it('keep a Claude config directory set in the environment as the default profile login', async () => {
    process.env['CLAUDE_CONFIG_DIR'] = '/cfg';
    app = await startAppModules({ dataDir: dir });
    expect(app.services.profile.settings().claudeConfig, 'inherited directory').toEqual({ mode: 'directory', path: '/cfg' });
  });

  it('carry the inbox unread count to the bus and into the registry entry', async () => {
    app = await startAppModules({ dataDir: dir });
    const events: AppEvent[] = [];
    app.events.onAny((event) => events.push(event));
    app.services.inbox.post({ folderId: null, kind: 'status', source: 'app', origin: 'test', message: 'Hello', textAuthor: 'app' });
    expect(events.map((event) => event.type).sort(), 'inbox and profile events on the bus').toEqual([
      'inbox.item_changed',
      'inbox.unread_changed',
      'profile.statuses_changed',
    ]);
    expect(app.services.profile.registry.statuses()[0]?.unread, 'count in the registry entry').toBe(1);
  });

  it('register the first-party panes and the shipped presets', async () => {
    app = await startAppModules({ dataDir: dir });
    const { layout } = app.services;
    expect(layout.blocks.paneType(PANE_TYPES.inbox)?.origin, 'inbox pane type').toBe('first-party');
    expect(layout.list().map((entry) => entry.id), 'presets').toEqual(['session', 'pair']);
    expect(layout.get('pair')?.instances['side']?.bindings, 'pair preset side binding').toEqual({ node: { context: 'node.secondary' } });
  });
});
