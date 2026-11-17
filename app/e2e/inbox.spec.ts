import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RendererApi } from '../src/shared/ipc';
import { connectAsSession as connectWithLaunch, recordedLaunches } from './sessionMcp';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE = join(import.meta.dirname, '..', 'src', 'core', 'inbox', 'fixtures', 'fake-claude-hooks.mjs');

let userData: string;
let workdir: string;
let app: ElectronApplication | undefined;
let client: Client | undefined;
let page: Page;

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-inbox-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-inbox-cwd-'));
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

/** Runs a command as the user, through the same IPC the renderer uses. */
async function invoke<T = unknown>(id: string, input: unknown = {}): Promise<T> {
  const result = await page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value as T;
}

async function startSession(title = 'Project'): Promise<{ folderId: string; sessionId: string }> {
  const folder = await invoke<{ id: string }>('ui_create_folder', { title });
  const session = await invoke<{ sessionId: string }>('session_create', { folderId: folder.id });
  await expect.poll(async () => (await invoke<{ status: string }>('session_get', { sessionId: session.sessionId })).status, { message: 'session idle' }).toBe('idle');
  return { folderId: folder.id, sessionId: session.sessionId };
}

async function openInboxPane(): Promise<void> {
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#pane=agide/inbox';
  });
  await page.reload();
  await expect(page.getByTestId('inbox-pane'), 'the inbox pane is shown').toBeVisible();
}

const connectAsSession = (): Promise<Client> => connectWithLaunch(recordedLaunches(join(userData, 'launches.jsonl'))[0]!);

const hook = (sessionId: string, event: string, payload: object = {}) => invoke('session_send_text', { sessionId, text: `/hook ${event} ${JSON.stringify(payload)}` });
const rows = () => page.getByTestId('inbox-row');
const unread = () => page.getByTestId('inbox-unread');

test('shows an item that an agent posts over MCP and updates the unread count', async () => {
  const { folderId, sessionId } = await startSession('Billing');
  await invoke('inbox_set_project_summary', { folderId, summary: 'Rewrite of the invoice job' });
  await invoke('inbox_set_session_summary', { sessionId, summary: 'Fixing the retry loop', model: 'haiku' });
  await openInboxPane();
  await expect(unread(), 'nothing waits at first').toHaveText('Nothing waits for you');

  expect(existsSync(join(userData, 'launches.jsonl')), 'the fake claude recorded its launch').toBe(true);
  client = await connectAsSession();
  const long = 'Step one done. '.repeat(40);
  const result = await client.callTool({ name: 'inbox_post', arguments: { message: 'Invoice job fixed', details: long } });
  expect(result.isError, 'inbox_post succeeds').toBeFalsy();

  await expect(rows(), 'the item appears in the list').toHaveCount(1);
  await expect(rows().first(), 'the row shows the message').toContainText('Invoice job fixed');
  await expect(rows().first(), 'the row names the project and the session').toContainText('Billing / Claude session');
  await expect(unread(), 'the unread count rises').toHaveText('1 unread');

  await rows().first().click();
  const card = page.getByTestId('inbox-card');
  await expect(page.getByTestId('inbox-message'), 'the card shows the short message').toHaveText('Invoice job fixed');
  await expect(page.getByTestId('inbox-project-name'), 'project name from the folder node').toHaveText('Billing');
  await expect(page.getByTestId('inbox-project-summary'), 'project summary from the folder node').toHaveText('Rewrite of the invoice job');
  await expect(page.getByTestId('inbox-session-name'), 'session name').toHaveText('Claude session');
  await expect(page.getByTestId('inbox-session-summary'), 'session summary').toContainText('Fixing the retry loop');
  await expect(page.getByTestId('inbox-session-summary-time'), 'summary generation time and model').toContainText('generated just now by haiku');

  await expect(page.getByTestId('inbox-details'), 'long details start collapsed').toHaveAttribute('data-expanded', 'false');
  await page.getByTestId('inbox-expand').click();
  await expect(page.getByTestId('inbox-details'), 'details expand in place').toHaveAttribute('data-expanded', 'true');
  await expect(page.getByTestId('inbox-details'), 'the full text is shown').toContainText('Step one done.');

  await expect(unread(), 'showing the card for a second marks the item seen').toHaveText('Nothing waits for you', { timeout: 5000 });
  await page.getByTestId('inbox-mark-unread').click();
  await expect(unread(), 'mark unread raises the count again').toHaveText('1 unread');

  await page.getByTestId('inbox-done').click();
  await expect(rows(), 'a done item leaves the open list').toHaveCount(0);
  await expect(card, 'its card closes with it').toHaveCount(0);
  await page.getByTestId('inbox-filter-done').click();
  await expect(rows(), 'it shows under Done').toHaveCount(1);
  await rows().first().click();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByTestId('inbox-filter-open').click();
  await expect(rows(), 'a reopened item is open again').toHaveCount(1);
});

test('shows an approval item from a hook event of the fake claude with the raw request, and clears it when the tool runs', async () => {
  const { sessionId } = await startSession();
  await openInboxPane();
  const request = { tool_name: 'Bash', tool_input: { command: 'npm test', description: 'run the suite' } };
  await hook(sessionId, 'PermissionRequest', request);
  await expect(rows(), 'the hook produces an item').toHaveCount(1);
  await expect(rows().first(), 'row text').toContainText('Wants to run Bash: npm test');
  await expect(rows().first(), 'row kind').toHaveAttribute('data-kind', 'approval');
  await rows().first().click();
  await expect(page.getByTestId('inbox-raw'), 'the raw request is shown, not a summary').toContainText('"command": "npm test"');

  await hook(sessionId, 'PostToolUse', request);
  await expect(rows(), 'the matching PostToolUse resolves the approval').toHaveCount(0);
  await page.getByTestId('inbox-filter-done').click();
  await expect(rows(), 'the resolved item is under Done').toHaveCount(1);
});

test('keeps the item of a removed folder and marks that its folder is gone', async () => {
  type Listed = { items: { folderId: string | null; folderRemoved: boolean }[] };
  const every = { states: ['new', 'seen', 'snoozed', 'done'] };
  const { folderId, sessionId } = await startSession('Short lived');
  await hook(sessionId, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await expect.poll(async () => (await invoke<Listed>('inbox_list', every)).items.length, { message: 'the hook produces an item' }).toBe(1);
  expect((await invoke<Listed>('inbox_list', every)).items[0]?.folderId, 'the item belongs to the folder').toBe(folderId);

  await invoke('ui_remove_node', { nodeId: folderId });

  const { items } = await invoke<Listed>('inbox_list', every);
  expect(items.length, 'the item outlives its folder').toBe(1);
  expect(items[0]?.folderRemoved, 'the item is marked as left by a removed folder').toBe(true);
  expect(items[0]?.folderId, 'the item moved to the top level').toBeNull();
});

test('notifies only after the permission prompt signal and records the notification text', async () => {
  const { sessionId } = await startSession('Ops');
  await hook(sessionId, 'PermissionRequest', { tool_name: 'Write', tool_input: { file_path: 'notes.txt' } });
  await openInboxPane();
  await expect(rows(), 'approval item').toHaveCount(1);
  const recorded = () => app!.evaluate(() => (globalThis as unknown as Record<string, { title: string; body: string }[]>)['__agideNotifications'] ?? []);
  expect(await recorded(), 'no notification while the user may still answer at once').toEqual([]);
  await hook(sessionId, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' });
  await expect.poll(recorded, { message: 'the prompt signal notifies' }).toEqual([{ title: 'Default - Ops', body: 'Wants to run Write: notes.txt' }]);
  await expect.poll(() => app!.evaluate(({ app: electronApp }) => electronApp.getBadgeCount()), { message: 'the dock badge shows the unread count' }).toBe(1);
});

test('peeks at the linked session read only, and viewing it resolves its status item', async () => {
  const { sessionId } = await startSession();
  await openInboxPane();
  await hook(sessionId, 'Stop', { last_assistant_message: 'Should I continue with the migration?' });
  await expect(rows(), 'a stop item that asks a question').toHaveCount(1);
  await rows().first().click();
  await page.getByTestId('inbox-peek-open').click();
  const peek = page.getByTestId('inbox-peek');
  await expect(peek, 'the peek opens beside the card').toBeVisible();
  await expect(page.getByTestId('inbox-card'), 'the card stays visible').toBeVisible();
  await expect(peek.locator('.xterm-rows'), 'the peek shows the session output').toContainText('fake-claude-hooks ready');
  await expect(page.getByTestId('inbox-peek-status'), 'the session status shows').toHaveAttribute('data-status', 'idle');
  await expect(page.getByTestId('inbox-peek-host').locator('textarea.xterm-helper-textarea'), 'the peek takes no keyboard input').toHaveAttribute('tabindex', '-1');
  await expect(rows(), 'two seconds in view resolve the status item').toHaveCount(0, { timeout: 8000 });
  await page.getByTestId('inbox-peek-back').click();
  await expect(peek, 'Back to message closes the peek').toHaveCount(0);
});

test('shows agent text literally: no markup, no links, no escape sequences', async () => {
  await startSession();
  await openInboxPane();
  client = await connectAsSession();
  const details = 'See [the report](https://example.org/r) <a href="https://example.org">link</a> <script>window.__pwned = 1</script>\u001b[31mred\u001b[0m';
  await client.callTool({ name: 'inbox_post', arguments: { message: '<img src=x onerror="window.__pwned=1"> done', details } });
  await expect(rows(), 'item arrives').toHaveCount(1);
  await expect(rows().first(), 'row shows the markup as text').toContainText('<img src=x onerror="window.__pwned=1"> done');
  await rows().first().click();
  await expect(page.getByTestId('inbox-details'), 'details show the markup and the Markdown link as text').toContainText('[the report](https://example.org/r) <a href="https://example.org">link</a>');
  await expect(page.getByTestId('inbox-details'), 'the escape sequence is gone').not.toContainText('\u001b');
  await expect(page.getByTestId('inbox-card').locator('a, img, script, iframe'), 'no element comes from agent text').toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as unknown as { __pwned?: number }).__pwned), 'no script ran').toBeUndefined();
});
