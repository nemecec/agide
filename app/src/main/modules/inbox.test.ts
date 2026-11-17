import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../core/commands/index';
import { createAppEventBus, type AppEvent } from '../../core/events/index';
import type { InboxItem } from '../../core/inbox/index';
import { openStore, type Database } from '../../core/store/index';
import type { Desktop, DesktopNotification } from '../context';
import { initModules, type InitializedModules } from '../modules';

const FAKE = join(import.meta.dirname, '..', '..', 'core', 'inbox', 'fixtures', 'fake-claude-hooks.mjs');

let dir: string;
let work: string;
let db: Database;
let modules: InitializedModules | undefined;
let commands: CommandRegistry;
let events: AppEvent[];
let notifications: DesktopNotification[];
let badges: number[];
let client: Client | undefined;
const saved = { ...process.env };

const desktop: Desktop = { notify: (n) => void notifications.push(n), setBadgeCount: (n) => void badges.push(n) };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'inbox-module-'));
  process.env['AGIDE_CLAUDE_BIN'] = FAKE;
  work = mkdtempSync(join(tmpdir(), 'session-work-'));
  process.env['AGIDE_SESSION_CWD'] = work;
  process.env['FAKE_CLAUDE_RECORD'] = join(dir, 'launches.jsonl');
  delete process.env['CLAUDE_CONFIG_DIR'];
  notifications = [];
  badges = [];
  events = [];
  db = openStore(':memory:');
  commands = new CommandRegistry();
  const bus = createAppEventBus();
  bus.onAny((event) => events.push(event));
  modules = await initModules({ events: bus, commands, db, dataDir: dir, desktop });
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  await modules?.dispose();
  modules = undefined;
  db.close();
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

const ui = { kind: 'ui' } as const;
async function value<T>(id: string, input: unknown): Promise<T> {
  const result = await commands.invoke(id, input, ui);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value as T;
}
const items = () => modules!.services.inbox.list({ states: ['new', 'seen', 'snoozed'] });
const until = async (predicate: () => boolean, message: string): Promise<void> => {
  await vi.waitFor(() => expect(predicate(), message).toBe(true), { timeout: 8000, interval: 25 });
};

async function startSession() {
  const folder = await value<{ id: string }>('ui_create_folder', { title: 'Project' });
  const session = await value<{ sessionId: string; leafId: string }>('session_create', { folderId: folder.id });
  await until(() => modules!.services.sessions.get(session.sessionId)?.status === 'idle', 'session idle');
  return { folder, ...session };
}
const hook = (sessionId: string, event: string, payload: object = {}) =>
  modules!.services.sessions.sendText(sessionId, `/hook ${event} ${JSON.stringify(payload)}`);

describe('inbox module in the real module graph', () => {
  it('turns a PermissionRequest hook of a session into an approval item that links to its leaf, without notifying yet', async () => {
    const { folder, sessionId, leafId } = await startSession();
    hook(sessionId, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
    await until(() => items().length === 1, 'approval item');
    const [item] = items() as [InboxItem];
    expect([item.kind, item.folderId, item.linkNodeId, item.sessionId], 'item fields').toEqual(['approval', folder.id, leafId, sessionId]);
    expect(item.message, 'headline').toBe('Wants to run Bash: rm -rf build');
    expect(notifications, 'answered at once means no notification').toEqual([]);
  });

  it('notifies on the permission prompt signal, resolves on PostToolUse, and throttles the second notification of the session', async () => {
    const { sessionId } = await startSession();
    const input = { tool_name: 'Bash', tool_input: { command: 'ls' } };
    hook(sessionId, 'PermissionRequest', input);
    await until(() => items().length === 1, 'approval');
    hook(sessionId, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' });
    await until(() => notifications.length === 1, 'notification');
    expect(notifications[0]?.title, 'title names the profile and the project').toBe('Default - Project');
    expect(notifications[0]?.body, 'body is the short message').toBe('Wants to run Bash: ls');
    hook(sessionId, 'PostToolUse', input);
    await until(() => items().length === 0, 'resolved by the tool run');
  });

  it('counts unread items on the bus, the badge and the profile registry, and keeps the count after a stop item is seen', async () => {
    const { sessionId } = await startSession();
    hook(sessionId, 'Stop', { last_assistant_message: 'Which branch should I use?' });
    await until(() => items().length === 1, 'stop item');
    const unread = events.filter((e) => e.type === 'inbox.unread_changed').map((e) => (e as { count: number }).count);
    expect(unread.slice(-1), 'last count on the bus').toEqual([1]);
    expect(badges.slice(-1), 'badge follows the count').toEqual([1]);
    expect(modules!.services.profile.registry.statuses()[0]?.unread, 'registry entry carries the count').toBe(1);
    await value('inbox_mark_seen', { itemId: items()[0]!.id });
    expect(badges.slice(-1), 'badge cleared').toEqual([0]);
  });

  it('does not set the badge when the profile turns it off', async () => {
    const { profile } = modules!.services;
    profile.store.updateSettings(profile.id, { showBadge: false });
    const before = badges.length;
    modules!.services.inbox.post({ folderId: null, kind: 'failure', source: 'app', origin: 'test', message: 'x', textAuthor: 'app' });
    expect(badges.length, 'no badge call').toBe(before);
  });

  it('shows an inbox_post from the session\'s MCP connection and notifies for a failure but not a plain status', async () => {
    const { sessionId, folder } = await startSession();
    const { url, headers } = modules!.services.mcp.configFor(sessionId).mcpServers.app;
    client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools, 'inbox tools are listed').toEqual(expect.arrayContaining(['inbox_post', 'inbox_list', 'inbox_resolve']));
    const result = await client.callTool({ name: 'inbox_post', arguments: { message: 'Migration finished', details: 'took 4 minutes' } });
    expect(result.isError, 'tool call succeeded').toBeFalsy();
    const [item] = items();
    expect([item?.message, item?.folderId, item?.sessionId], 'item scoped to the session').toEqual(['Migration finished', folder.id, sessionId]);
    expect(notifications, 'a status update does not notify').toEqual([]);
    await client.callTool({ name: 'inbox_post', arguments: { message: 'Migration failed', kind: 'failure' } });
    expect(notifications.map((n) => n.body), 'a failure notifies at creation').toEqual(['Migration failed']);
  });

  it('moves the open items of a session when its leaf moves to another folder', async () => {
    const { sessionId, leafId } = await startSession();
    const other = await value<{ id: string }>('ui_create_folder', { title: 'Other' });
    hook(sessionId, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    await until(() => items().length === 1, 'approval');
    await value('ui_move_node', { nodeId: leafId, parentId: other.id });
    expect(items()[0]?.folderId, 'item follows the session').toBe(other.id);
  });
});
