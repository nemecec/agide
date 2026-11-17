import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PAIR_PRESET } from '../src/core/blocks/presets';
import type { RendererApi } from '../src/shared/ipc';
import { connectAsSession, recordedLaunches, toolJson } from './sessionMcp';

// The modules working together in one window: the layout host with the profile rail and the inbox pane,
// sessions that reach the app over MCP, and hook events that become inbox items.

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE = join(import.meta.dirname, '..', 'src', 'core', 'inbox', 'fixtures', 'fake-claude-hooks.mjs');

let userData: string;
let workdir: string;
let app: ElectronApplication | undefined;
let client: Client | undefined;
let page: Page;

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-workspace-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-workspace-cwd-'));
  app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData, AGIDE_CLAUDE_BIN: FAKE, AGIDE_SESSION_CWD: workdir, FAKE_CLAUDE_RECORD: join(userData, 'launches.jsonl') },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
});

test.afterEach(async () => {
  await client?.close();
  client = undefined;
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

async function invoke<T = unknown>(id: string, input: unknown = {}): Promise<T> {
  const result = await page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value as T;
}

async function startSession(title: string): Promise<{ folderId: string; sessionId: string; leafId: string }> {
  const folder = await invoke<{ id: string }>('ui_create_folder', { title });
  const session = await invoke<{ sessionId: string; leafId: string }>('session_create', { folderId: folder.id });
  await expect.poll(async () => (await invoke<{ status: string }>('session_get', { sessionId: session.sessionId })).status, { message: 'session idle' }).toBe('idle');
  return { folderId: folder.id, ...session };
}

const surfaces = () => page.getByTestId('surface-pane');
const tab = (title: string) => page.locator('.pane-tab', { hasText: new RegExp(`^${title}$`) });
const undoNotice = () => page.getByTestId('layout-change').getByRole('button', { name: 'Undo' });

test('the Session layout places the tree, the surface host, the inbox and the profile rail', async () => {
  const layout = await invoke<{ layout: { instances: Record<string, { type: string }> } }>('layout_get');
  const types = Object.values(layout.layout.instances).map((instance) => instance.type).sort();
  expect(types, 'instances of the Session preset').toEqual(['agide/inbox', 'agide/profile-rail', 'agide/surface-host', 'agide/tree']);
  await expect(tab('inbox'), 'the inbox is a tab beside the surface').toBeVisible();
  await expect(tab('profile-rail'), 'the rail group shows no tab header').toBeHidden();
  await expect(page.locator('[data-instance-id="rail"]'), 'the rail has its pane frame').toHaveCount(1);
});

test('a layout file edit and a layout_apply over MCP change the window, and Undo restores it', async () => {
  await expect(surfaces(), 'Session shows one surface host').toHaveCount(1);

  mkdirSync(join(userData, 'layouts'), { recursive: true });
  writeFileSync(join(userData, 'layouts', 'session.json'), JSON.stringify({ ...PAIR_PRESET, id: 'session', title: 'Edited', revision: 1 }));
  await expect(surfaces(), 'the edited file adds a second surface host').toHaveCount(2);
  await expect(page.getByTestId('layout-change'), 'the file change is announced').toContainText('The layout file changed');
  await undoNotice().click();
  await expect(surfaces(), 'Undo restores one surface host').toHaveCount(1);

  const { leafId } = await startSession('Layout work');
  await invoke('ui_focus_node', { nodeId: leafId });
  client = await connectAsSession(recordedLaunches(join(userData, 'launches.jsonl'))[0]!);
  const current = toolJson<{ revision: number }>(await client.callTool({ name: 'layout_get', arguments: {} }));
  const applied = await client.callTool({
    name: 'layout_apply',
    arguments: {
      expectedRevision: current.revision,
      patch: [
        { op: 'add', path: '/instances/side', value: { type: 'agide/surface-host', version: '^1', configVersion: 1, config: { emptyText: 'Added by the agent' }, bindings: { node: { context: 'node.secondary' } } } },
        { op: 'add', path: '/arrangement/children/-', value: { size: 2, tabs: { panes: ['side'], active: 'side' } } },
      ],
    },
  });
  expect(applied.isError, `layout_apply over MCP succeeds: ${JSON.stringify(applied.content)}`).toBeFalsy();
  await expect(page.getByText('Added by the agent'), 'the agent pane shows in the window').toBeVisible();
  await expect(page.getByTestId('layout-change'), 'the agent change is announced').toContainText('An agent changed the layout');
  await undoNotice().click();
  await expect(page.getByText('Added by the agent'), 'Undo removes the agent pane').toHaveCount(0);
  await expect(surfaces(), 'one surface host is left').toHaveCount(1);
});

test('a hook event of a session shows as an item in the inbox pane of the layout', async () => {
  const { sessionId } = await startSession('Hooks');
  await tab('inbox').click();
  const inbox = page.getByTestId('inbox-pane');
  await expect(inbox, 'the inbox tab shows the inbox pane').toBeVisible();

  await invoke('session_send_text', { sessionId, text: `/hook PermissionRequest ${JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' } })}` });
  await expect(inbox.getByTestId('inbox-row'), 'the hook produces an item').toHaveCount(1);
  await expect(inbox.getByTestId('inbox-row').first(), 'the row names the request').toContainText('Wants to run Bash: npm test');
  await expect(inbox.getByTestId('inbox-unread'), 'the unread count rises').toHaveText('1 unread');
  await expect.poll(() => app!.evaluate(({ app: electronApp }) => electronApp.getBadgeCount()), { message: 'the dock badge follows the count' }).toBe(1);
});
