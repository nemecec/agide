import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CommandResult } from '../src/core/commands/types';
import type { InboxItem } from '../src/core/inbox/types';
import type { McpConfigJson } from '../src/core/mcp/types';
import { defaultPermissionSettings } from '../src/core/permissions/defaults';
import { installFakeGh, samplePullRequest } from '../src/core/tasks/fixtures/fakeGh';
import { createRepositoryWithRemote, type TestRepository } from '../src/core/tasks/fixtures/gitRepo';
import type { TreeNode } from '../src/core/tree/types';
import type { UsageState } from '../src/core/usage/types';
import type { RendererApi } from '../src/shared/ipc';

// The modules of milestone 3 working together in one app: task start, permission policy, isolation provider,
// browser tabs with observation, agent nodes, usage and the inbox.

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude-m3.mjs');
const FAKE_SRT = join(import.meta.dirname, 'fixtures', 'fake-srt.mjs');

const PAGE = `<!doctype html><html><head><title>Integration page</title></head><body>
<h1>Integration heading</h1>
<button id="save" onclick="document.getElementById('out').textContent='clicked save'">Save</button>
<p id="out"></p>
</body></html>`;

interface Launch {
  readonly args: string[];
  readonly settings: {
    readonly permissions?: { readonly ask?: string[]; readonly deny?: string[] };
    readonly hooks: Record<string, { hooks: { command: string }[] }[]>;
    readonly statusLine?: { command: string };
    readonly sandbox?: unknown;
  };
  readonly mcpConfig?: McpConfigJson;
  readonly cwd: string;
}

let root: string;
let running: ElectronApplication | undefined;
const clients: Client[] = [];
const cleanups: (() => void | Promise<void>)[] = [];

test.beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agide-m3-')));
  for (const dir of ['claude-config', 'work']) mkdirSync(join(root, dir));
});

test.afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await running?.close();
  running = undefined;
  for (const cleanup of cleanups.splice(0)) await cleanup();
  rmSync(root, { recursive: true, force: true });
});

const file = (name: string) => join(root, name);
const jsonLines = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T) : []);
const launches = () => jsonLines<Launch>(file('launches.jsonl'));
const inputs = () => jsonLines<{ sessionId: string; text: string }>(file('inputs.jsonl'));
const flag = (args: readonly string[], name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const hookCommands = (launch: Launch, event: string): string => (launch.settings.hooks[event] ?? []).flatMap((group) => group.hooks.map((hook) => hook.command)).join('\n');

async function launchApp(env: Record<string, string> = {}): Promise<Page> {
  running = await electron.launch({
    args: [MAIN, '--profile=default'],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_ROOT: file('agide-root'),
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      AGIDE_SESSION_CWD: file('work'),
      AGIDE_TASK_BASE: file('tasks'),
      CLAUDE_CONFIG_DIR: file('claude-config'),
      FAKE_CLAUDE_ROOT: file('claude-config'),
      FAKE_CLAUDE_RECORD: file('launches.jsonl'),
      FAKE_CLAUDE_INPUT: file('inputs.jsonl'),
      FAKE_CLAUDE_HOOK_OUT: file('hook-out.jsonl'),
      ...env,
    },
  });
  const page = await running.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  return page;
}

async function invoke<T>(page: Page, id: string, input?: unknown): Promise<CommandResult<T>> {
  return page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args) as Promise<CommandResult<never>>, [id, input] as const) as Promise<CommandResult<T>>;
}

async function value<T>(page: Page, id: string, input?: unknown): Promise<T> {
  const result = await invoke<T>(page, id, input);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value;
}

async function createFolder(page: Page, title: string): Promise<string> {
  const folder = await value<TreeNode>(page, 'ui_create_folder', { title });
  const row = page.getByRole('treeitem', { name: title, exact: true });
  await expect(row, `folder ${title} is in the tree`).toBeVisible();
  if ((await row.getAttribute('aria-expanded')) === 'false') await row.dblclick();
  return folder.id;
}

/** Starts a session in the folder and waits for its launch; returns the session id and the launch record. */
async function startSession(page: Page, folderId: string): Promise<{ sessionId: string; launch: Launch }> {
  const before = launches().length;
  const { sessionId } = await value<{ sessionId: string }>(page, 'session_create', { folderId, cwd: file('work') });
  await expect.poll(() => launches().length, { message: 'the session launched claude' }).toBeGreaterThan(before);
  await expect.poll(async () => (await value<{ status: string }>(page, 'session_get', { sessionId })).status, { message: 'the session is idle after SessionStart' }).toBe('idle');
  return { sessionId, launch: launches().at(-1) as Launch };
}

async function connect(entry: { url: string; headers?: Record<string, string> } | undefined): Promise<Client> {
  if (!entry) throw new Error('the launch has no such MCP server');
  const client = new Client({ name: 'e2e-m3', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers ?? {} } }));
  clients.push(client);
  return client;
}

const text = (result: unknown): string => ((result as { content: { type: string; text?: string }[] }).content.find((part) => part.type === 'text')?.text ?? '');
const inboxItems = async (page: Page, kinds?: string[], states?: string[]): Promise<InboxItem[]> =>
  (await value<{ items: InboxItem[] }>(page, 'inbox_list', { ...(kinds ? { kinds } : {}), ...(states ? { states } : {}) })).items;

test('a pull request task runs in a worktree with the profile policy, types the composed prompt and opens the pull request in a tab', async () => {
  const repo: TestRepository = createRepositoryWithRemote({ claudeMd: 'Use pnpm.\n' });
  const gh = installFakeGh({ pr: samplePullRequest() });
  cleanups.push(() => rmSync(repo.root, { recursive: true, force: true }), () => rmSync(gh.dir, { recursive: true, force: true }));
  const page = await launchApp({ PATH: gh.path, ...gh.env });

  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await page.getByRole('menuitem', { name: 'New task…', exact: true }).click();
  await page.getByTestId('task-source').fill('https://github.com/acme/app/pull/1');
  await page.getByTestId('task-repo').fill(repo.repo);
  await page.getByTestId('task-start').click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog closes after the start').toBeHidden();
  await expect(page.getByRole('treeitem', { name: 'PR #1 Fix the retry in the uploader' }).first(), 'folder titled by the pull request').toBeVisible();

  await expect.poll(() => launches().length, { message: 'the task session launched' }).toBe(1);
  const [launch] = launches() as [Launch];
  const worktrees = readdirSync(file('tasks/worktrees'));
  expect(worktrees, 'one worktree').toHaveLength(1);
  expect(launch.cwd, 'the session runs in the worktree').toBe(join(file('tasks/worktrees'), worktrees[0] ?? ''));
  expect(flag(launch.args, '--permission-mode'), 'the profile default mode').toBe('auto');
  expect(launch.settings.permissions?.ask, 'ask rules for outward tools').toContain('Bash(git push *)');
  expect(hookCommands(launch, 'PreToolUse'), 'the inspector runs on every tool call').toContain('inspect.js');
  expect(launch.settings.statusLine?.command, 'the usage status line').toBeTruthy();
  expect(hookCommands(launch, 'UserPromptSubmit'), 'the browser digest hook').toContain('digest.json');
  expect(launch.args, 'Claude in Chrome off').toContain('--no-chrome');
  expect(flag(launch.args, '--add-dir'), 'the source directory').toContain(file('tasks/sources'));
  expect(Object.keys(launch.mcpConfig?.mcpServers ?? {}).sort(), 'app and browser MCP servers').toEqual(['agide-browser', 'app']);

  await expect.poll(() => inputs().map((input) => input.text).join('\n'), { message: 'the composed prompt reached the session' }).toContain('Agide started this session for a task from a GitHub pull request.');
  const prompt = inputs()[0]?.text ?? '';
  expect(prompt, 'the prompt points at the source file').toContain('task-source.md');
  expect(prompt, 'the user is named as the author of the instruction').toContain('Instruction from the user:');
  expect(prompt, 'the pull request text stays out of the prompt').not.toContain(samplePullRequest().body);

  const nodes = (await value<{ nodes: TreeNode[] }>(page, 'ui_list_tree')).nodes;
  const folder = nodes.find((node) => node.title === 'PR #1 Fix the retry in the uploader');
  const tab = nodes.find((node) => node.kind === 'leaf' && node.surfaceType === 'browser-tab' && node.parentId === folder?.id);
  expect(tab, 'a browser tab for the pull request in the task folder').toBeDefined();
  const state = await value<{ url: string; service: string }>(page, 'browser_tab_state', { leafId: tab?.id });
  expect(state, 'the tab shows the pull request').toMatchObject({ url: 'https://github.com/acme/app/pull/1', service: 'github' });
});

test('an agent reads and clicks a local page over MCP, asks through the inbox for another origin and is refused once observation is off', async () => {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const page = await launchApp();
  const folderId = await createFolder(page, 'Work');
  const { leafId } = await value<{ leafId: string }>(page, 'browser_new_tab', { folderId, url: `${origin}/` });
  await page.getByRole('treeitem', { name: '127.0.0.1', exact: true }).click();
  await expect(page.getByTestId('browser-pane'), 'the tab opens in the surface host').toBeVisible();
  await expect.poll(async () => (await value<{ title: string }>(page, 'browser_tab_state', { leafId })).title, { message: 'the page loaded' }).toBe('Integration page');

  const { launch } = await startSession(page, folderId);
  const browser = await connect(launch.mcpConfig?.mcpServers['agide-browser']);
  expect(text(await browser.callTool({ name: 'read_page', arguments: { tabId: 1 } })), 'the page tree, labelled').toMatch(/^Untrusted page content from http:\/\/127\.0\.0\.1:\d+ \(tab 1\)\.[\s\S]*Integration heading/);
  const ref = /\[(ref_\d+)\]/.exec(text(await browser.callTool({ name: 'find', arguments: { tabId: 1, query: 'Save' } })))?.[1];
  expect(ref, 'find returns a ref for the button').toBeDefined();
  await browser.callTool({ name: 'computer', arguments: { action: 'left_click', tabId: 1, ref } });
  await expect.poll(async () => text(await browser.callTool({ name: 'get_page_text', arguments: { tabId: 1 } })), { message: 'the click ran in the page' }).toContain('clicked save');

  const navigation = browser.callTool({ name: 'navigate', arguments: { tabId: 1, url: 'https://unlisted.example/' } });
  await expect.poll(async () => (await inboxItems(page, ['approval'])).map((item) => item.origin), { message: 'the approval reaches the inbox' }).toEqual(['browser:approval']);
  const [item] = await inboxItems(page, ['approval']);
  expect(item, 'the item belongs to the folder and links to the tab').toMatchObject({ folderId, linkNodeId: leafId, urgency: 'high' });
  const approvals = (await value<{ approvals: { id: string }[] }>(page, 'browser_tab_state', { leafId })).approvals;
  await value(page, 'browser_answer_approval', { id: approvals[0]?.id, answer: 'deny' });
  expect((await navigation).isError, 'the refused navigation is an error for the agent').toBe(true);
  expect((await inboxItems(page, ['approval'], ['done']))[0], 'the item records the answer').toMatchObject({ resolution: 'denied' });

  await value(page, 'ui_set_observation', { nodeId: leafId, mode: 'off' });
  const refused = await browser.callTool({ name: 'get_page_text', arguments: { tabId: 1 } });
  expect(text(refused), 'observation off refuses the page tools').toContain('observation is off');
  const app = await connect(launch.mcpConfig?.mcpServers.app);
  expect((await app.callTool({ name: 'surfaces_observe', arguments: { nodeId: leafId, kind: 'text' } })).isError, 'and surfaces_observe').toBe(true);
});

test('hook events of a session become agent nodes, usage ranking, a plan alert and a denial in the inbox', async () => {
  const page = await launchApp();
  await value(page, 'permissions_set', { settings: { ...defaultPermissionSettings({ isDefaultProfile: true }), outward: { 'git.push': 'deny' } } });
  const folderId = await createFolder(page, 'Work');
  const { sessionId, launch } = await startSession(page, folderId);
  expect(launch.settings.permissions?.deny, 'the denied class is a deny rule').toContain('Bash(git push *)');

  const type = (line: string) => value(page, 'session_send_text', { sessionId, text: line });
  await type('/agent a1 Read the files');
  await type('/lines 3 400000');
  await type('/status 0.5 85');
  await type('/tool {"tool_name":"Bash","tool_input":{"command":"cd x && git push origin main"}}');

  await expect(page.getByTestId('agent-row'), 'the subagent is a node under the session').toHaveCount(1);
  await expect(page.getByTestId('agent-row'), 'labelled with its description').toContainText('Read the files');
  const listed = await value<{ agents: { sessionId: string; agentKey: string; state: string }[] }>(page, 'agents_list');
  expect(listed.agents, 'the store holds the running agent').toEqual([expect.objectContaining({ sessionId, agentKey: 'a1', state: 'running' })]);

  await expect
    .poll(async () => (await value<UsageState>(page, 'usage_state')).ranking.map((row) => (row.subject.kind === 'session' ? row.subject.sessionId : row.subject.ref.agentKey)), { message: 'the session leads the usage ranking', timeout: 15_000 })
    .toContain(sessionId);
  await expect.poll(async () => (await value<UsageState>(page, 'usage_state')).plan[0]?.usedPercentage, { message: 'plan usage from the status line' }).toBe(85);
  await expect.poll(async () => (await inboxItems(page, ['alert'])).map((item) => item.origin), { message: 'the plan threshold raises a usage alert', timeout: 15_000 }).toContain('usage');

  await expect.poll(() => jsonLines<{ stdout: string }>(file('hook-out.jsonl')).map((out) => out.stdout).join('\n'), { message: 'the inspector denied the push' }).toContain('"permissionDecision":"deny"');
  await expect.poll(async () => (await inboxItems(page)).map((item) => item.message).join('\n'), { message: 'the denial reaches the inbox' }).toContain('Blocked git.push');
});

test('the isolation provider chosen for the profile changes how the next session launches', async () => {
  const page = await launchApp({ AGIDE_SRT_BIN: FAKE_SRT, FAKE_SRT_RECORD: file('srt.jsonl') });
  const defaults = defaultPermissionSettings({ isDefaultProfile: true });
  await value(page, 'permissions_set', { settings: { ...defaults, network: { ...defaults.network, allow: [...defaults.network.allow, 'packages.internal.example'] } } });
  const folderId = await createFolder(page, 'Work');
  expect((await invoke(page, 'isolation_set_provider', { provider: 'srt' })).ok, 'srt passes its check and is chosen').toBe(true);

  await startSession(page, folderId);
  const srtRuns = jsonLines<{ args: string[]; settings: { network: { allowedDomains: string[] }; allowPty?: boolean } }>(file('srt.jsonl'));
  expect(srtRuns, 'the launch went through srt').toHaveLength(1);
  const [run] = srtRuns as [(typeof srtRuns)[number]];
  expect(run.args.slice(0, 1).concat(run.args.slice(2, 4)), 'srt -s <settings> -- claude').toEqual(['-s', '--', FAKE_CLAUDE]);
  expect(run.settings.network.allowedDomains, 'the profile allowlist reaches the sandbox').toContain('packages.internal.example');
  expect(run.settings.allowPty, 'the TUI needs a PTY inside srt').toBe(true);
  expect(flag(launches().at(-1)?.args ?? [], '--permission-mode'), 'the mode stays the profile default').toBe('auto');

  expect((await invoke(page, 'isolation_set_provider', { provider: 'local' })).ok, 'back to local').toBe(true);
  await startSession(page, folderId);
  expect(jsonLines(file('srt.jsonl')), 'the local launch does not use srt').toHaveLength(1);
  expect(launches(), 'both sessions launched claude').toHaveLength(2);
});
