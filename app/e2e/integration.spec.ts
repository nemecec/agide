import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { TreeNode } from '../src/core/tree/types';
import { connectAsSession, flag, recordedLaunches, sessionMcpConfig, toolJson } from './sessionMcp';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let userData: string;
let workdir: string;
let running: ElectronApplication | undefined;
let client: Client | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'agide-int-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-int-cwd-'));
});

test.afterEach(async () => {
  await client?.close();
  client = undefined;
  await running?.close();
  running = undefined;
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

/** Starts a Claude session in a folder from the menu. The new leaf opens its terminal. */
async function addSession(page: Page, folder: string): Promise<void> {
  await item(page, folder).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Claude session…', exact: true }).click();
  await page.getByTestId('new-session-start').click();
  await expect(item(page, SESSION), 'the session leaf appears in the tree').toBeVisible();
  await expect(page.getByTestId('terminal-pane'), 'the new session opens its terminal').toBeVisible();
}

const SESSION = 'Claude session';
const launchesFile = () => join(userData, 'launches.jsonl');

async function launch(): Promise<Page> {
  running = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: userData,
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      AGIDE_SESSION_CWD: workdir,
      FAKE_CLAUDE_RECORD: launchesFile(),
    },
  });
  const page = await running.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'tree is rendered').toBeVisible();
  return page;
}

async function restart(): Promise<Page> {
  await running?.close();
  running = undefined;
  return launch();
}

const item = (page: Page, title: string) => page.getByRole('treeitem', { name: title, exact: true });

async function addFromMenu(page: Page, target: string | null, entry: string, title: string): Promise<void> {
  if (target === null) await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  else await item(page, target).click({ button: 'right' });
  await page.getByRole('menuitem', { name: entry, exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Rename' });
  await expect(input, 'a new node starts in rename mode').toBeVisible();
  await input.fill(title);
  await input.press('Enter');
  await expect(item(page, title), `"${title}" appears in the tree`).toBeVisible();
}

/** The arguments of every `claude` launch so far, as the fake executable recorded them. */
const launches = (): string[][] => recordedLaunches(launchesFile()).map((launch) => launch.args);

const terminalText = (page: Page) => page.getByTestId('terminal-host').locator('.xterm-rows');

test('keeps folders and a Claude session leaf after a restart, and the session resumes from its leaf', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'Project');
  await addFromMenu(page, 'Project', 'New folder', 'Notes');
  await addSession(page, 'Project');
  await expect.poll(() => launches().length, { message: 'the session started one claude process' }).toBe(1);
  const sessionId = flag(launches()[0] ?? [], '--session-id');

  const reopened = await restart();
  await item(reopened, 'Project').click();
  await expect(item(reopened, 'Notes'), 'the nested folder is back').toBeVisible();
  await item(reopened, SESSION).click();
  const status = reopened.getByTestId('terminal-status');
  await expect(status, 'a session from an earlier run starts as exited').toHaveAttribute('data-status', 'exited');

  await reopened.getByRole('button', { name: 'Resume' }).click();
  await expect(status, 'the resumed session reaches idle').toHaveAttribute('data-status', 'idle');
  const resumed = launches()[1] ?? [];
  expect(flag(resumed, '--resume'), 'the second launch resumes the same session id').toBe(sessionId);
});

test('shows a folder an agent creates over MCP and lists a folder the user creates to the agent', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'Outside');
  await addFromMenu(page, null, 'New folder', 'Task');
  await addSession(page, 'Task');
  await expect.poll(() => launches().length, { message: 'the session started one claude process' }).toBe(1);
  client = await connectAsSession(recordedLaunches(launchesFile())[0]!);

  const created = toolJson<TreeNode>(await client.callTool({ name: 'ui_create_folder', arguments: { title: 'from-mcp' } }));
  await expect(item(page, 'from-mcp'), 'the folder from the MCP call appears without a reload').toBeVisible();
  const task = await item(page, 'Task').getAttribute('aria-level');
  await expect(item(page, 'from-mcp'), 'the folder sits one level below the session folder').toHaveAttribute(
    'aria-level',
    String(Number(task) + 1),
  );

  await addFromMenu(page, 'Task', 'New folder', 'from-ui');
  const listed = toolJson<{ nodes: TreeNode[] }>(await client.callTool({ name: 'ui_list_tree', arguments: {} }));
  const titles = listed.nodes.map((node) => node.title);
  expect(titles, 'the agent sees the folder the user created').toContain('from-ui');
  expect(titles, 'the agent sees the folder it created').toContain('from-mcp');
  expect(titles, 'the agent does not see folders outside its own').not.toContain('Outside');
  expect(listed.nodes.find((node) => node.title === 'from-mcp')?.id, 'the listed id matches the created one').toBe(created.id);
});

test('opens the terminal of a Claude session leaf and passes typed input to the process', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'Work');
  await addSession(page, 'Work');
  await addFromMenu(page, 'Work', 'New Browser tab', 'Docs');

  await item(page, SESSION).click();
  await expect(page.getByTestId('terminal-pane'), 'the session leaf shows a terminal').toBeVisible();
  await expect(page.getByTestId('terminal-status'), 'the session is idle after SessionStart').toHaveAttribute('data-status', 'idle');
  await expect(terminalText(page), 'the terminal shows the process output').toContainText('fake-claude ready');

  await page.getByTestId('terminal-host').click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect(terminalText(page), 'typed input reaches the process and its answer is shown').toContainText('echo: hello');

  await item(page, 'Docs').click();
  await expect(page.getByTestId('terminal-pane'), 'another surface type hides the terminal').toHaveCount(0);
  await item(page, SESSION).click();
  await expect(terminalText(page), 'reopening the leaf redraws the earlier output').toContainText('echo: hello');

});

test('launches a session with its MCP config in a 0600 file and no token in the arguments', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'Work');
  await addSession(page, 'Work');
  await expect(page.getByTestId('terminal-status'), 'the session is idle after SessionStart').toHaveAttribute('data-status', 'idle');

  const [launched] = recordedLaunches(launchesFile());
  if (!launched) throw new Error('no launch recorded');
  const { path, mode, config } = sessionMcpConfig(launched);
  const token = config.mcpServers.app.headers.Authorization;
  expect(path.startsWith(join(userData, 'sessions')), 'the config file lies in the session files of the data directory').toBe(true);
  expect(mode, 'the config file is readable by the user only').toBe(0o600);
  expect(launched.mcpConfigFile?.mode, 'the file had mode 0600 when claude read it').toBe(0o600);
  expect(config.mcpServers.app.type, 'the file holds the app MCP server config').toBe('http');
  expect(config.mcpServers.app.url, 'the MCP URL names the session').toContain(flag(launched.args, '--session-id') ?? 'missing');
  expect(token, 'the file holds a bearer token').toMatch(/^Bearer [0-9a-f]{64}$/);
  const secret = token.slice('Bearer '.length);
  expect(launched.args.some((arg) => arg.includes(secret)), 'no argument holds the token').toBe(false);
  await expect.poll(() => existsSync(path), { message: 'the config file is removed once the CLI has started' }).toBe(false);
});
