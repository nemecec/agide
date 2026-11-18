import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { installFakeGh, samplePullRequest } from '../src/core/tasks/fixtures/fakeGh';
import { createRepositoryWithRemote, git, type TestRepository } from '../src/core/tasks/fixtures/gitRepo';
import type { TaskStartResult } from '../src/core/tasks/types';
import type { TreeNode } from '../src/core/tree/types';
import { connectAsSession, flag, recordedLaunches, toolJson } from './sessionMcp';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FIXTURES = join(import.meta.dirname, '..', 'src', 'core');
const FAKE_CLAUDE = join(FIXTURES, 'session', 'fixtures', 'fake-claude.mjs');
const FAKE_TRUST = join(FIXTURES, 'tasks', 'fixtures', 'fake-claude-trust.mjs');

let root: string;
let repo: TestRepository;
let ghDir: string;
let ghRecord: string;
let app: ElectronApplication | undefined;
let client: Client | undefined;

test.beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agide-tasks-')));
  repo = createRepositoryWithRemote({ claudeMd: 'Use pnpm.\n' });
  const gh = installFakeGh({ pr: samplePullRequest() });
  ghDir = gh.dir;
  ghRecord = gh.record;
  process.env['AGIDE_E2E_GH_PATH'] = gh.path;
  Object.assign(process.env, { AGIDE_E2E_GH_PR: gh.env['FAKE_GH_PR'] ?? '' });
});

test.afterEach(async () => {
  await client?.close();
  client = undefined;
  await app?.close();
  app = undefined;
  for (const path of [root, repo.root, ghDir]) rmSync(path, { recursive: true, force: true });
});

async function launch(claude = FAKE_CLAUDE): Promise<Page> {
  mkdirSync(join(root, 'plain'));
  app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      PATH: process.env['AGIDE_E2E_GH_PATH'] ?? '',
      FAKE_GH_PR: process.env['AGIDE_E2E_GH_PR'] ?? '',
      FAKE_GH_RECORD: ghRecord,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: join(root, 'data'),
      AGIDE_CLAUDE_BIN: claude,
      FAKE_CLAUDE_RECORD: join(root, 'launches.jsonl'),
      AGIDE_TASK_BASE: join(root, 'agide'),
      AGIDE_SESSION_CWD: join(root, 'plain'),
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
  });
  return app.firstWindow();
}

const item = (page: Page, title: string) => page.getByRole('treeitem', { name: title });

async function openDialog(page: Page): Promise<void> {
  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await page.getByRole('menuitem', { name: 'New task…', exact: true }).click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog opens').toBeVisible();
}

test('starts a task from a prompt through the dialog: folder, session leaf and the typed prompt', async () => {
  const page = await launch();
  await openDialog(page);
  await expect(page.getByTestId('task-start'), 'start is disabled without a source').toBeDisabled();
  await page.getByTestId('task-source').fill('Fix the retry in the uploader');
  await expect(page.getByTestId('task-kind'), 'detected kind').toHaveText('Prompt');
  await page.getByTestId('task-start').click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog closes after the start').toBeHidden();
  await expect(item(page, 'Fix the retry in the uploader').first(), 'folder titled by the first line').toBeVisible();
  await expect(page.getByTestId('terminal-pane'), 'the session opens its terminal').toBeVisible();
  await expect.poll(() => page.getByTestId('terminal-pane').innerText(), { message: 'the terminal shows the typed prompt echoed' }).toContain('echo');
});

test('starts a task from a pull request URL through the dialog with a fake gh and a worktree', async () => {
  const page = await launch();
  await openDialog(page);
  await page.getByTestId('task-source').fill('https://github.com/acme/app/pull/1');
  await expect(page.getByTestId('task-kind'), 'detected kind').toHaveText('Pull request');
  await page.getByTestId('task-repo').fill(repo.repo);
  await page.getByText('Preview', { exact: true }).click();
  await expect(page.getByTestId('task-preview'), 'preview lists the commands and the prompt').toContainText('gh pr view 1 --repo=acme/app');
  await page.getByTestId('task-start').click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog closes after the start').toBeHidden();
  await expect(item(page, 'PR #1 Fix the retry in the uploader').first(), 'folder titled by the pull request').toBeVisible();

  const worktrees = readdirSync(join(root, 'agide', 'worktrees'));
  expect(worktrees, 'one worktree outside the application data').toHaveLength(1);
  const path = join(root, 'agide', 'worktrees', worktrees[0] ?? '');
  expect(git(path, 'rev-parse', 'HEAD'), 'worktree at the pull ref').toBe(repo.pullCommit);
  expect(readFileSync(ghRecord, 'utf8'), 'gh was called with separate arguments').toContain('"--repo=acme/app"');
  await expect.poll(() => recordedLaunches(join(root, 'launches.jsonl')).length, { message: 'a session launched' }).toBeGreaterThan(0);
  const launched = recordedLaunches(join(root, 'launches.jsonl'))[0];
  expect(flag(launched?.args ?? [], '--add-dir'), 'source directory passed to claude').toContain(join(root, 'agide', 'sources'));
});

test('shows an error in the dialog and keeps it open when no local repository matches the pull request', async () => {
  const page = await launch();
  await openDialog(page);
  await page.getByTestId('task-source').fill('acme/app#1');
  await page.getByTestId('task-start').click();
  await expect(page.getByTestId('task-error'), 'no repository is known yet').toContainText('choose its path');
  await expect(page.getByTestId('new-task-dialog'), 'dialog stays open').toBeVisible();
});

test('shows the folder-trust state in the session pane while the dialog waits for the user', async () => {
  const page = await launch(FAKE_TRUST);
  await openDialog(page);
  await page.getByTestId('task-source').fill('Check the build');
  await page.getByTestId('task-start').click();
  const banner = page.getByTestId('trust-banner');
  await expect(banner, 'banner in the session pane').toContainText('answer in the terminal');
  await expect(banner, 'state attribute').toHaveAttribute('data-state', 'user_input');
});

test('task_start over MCP starts a task inside the caller folder', async () => {
  const page = await launch();
  const created = await page.evaluate(async () => {
    const api = (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<{ ok: boolean; value: unknown }> } }).api;
    const folder = (await api.invoke('ui_create_folder', { title: 'Agents' })).value as { id: string };
    await api.invoke('session_create', { folderId: folder.id });
    return folder.id;
  });
  await expect.poll(() => recordedLaunches(join(root, 'launches.jsonl')).length, { message: 'caller session launched' }).toBeGreaterThan(0);
  client = await connectAsSession(recordedLaunches(join(root, 'launches.jsonl'))[0] ?? { args: [] });

  const result = toolJson<TaskStartResult>(await client.callTool({ name: 'task_start', arguments: { source: 'Review the build' } }));
  expect(result.sessionId, 'a session was started').toBeTruthy();
  const listed = toolJson<{ nodes: TreeNode[] }>(await client.callTool({ name: 'ui_list_tree', arguments: {} }));
  expect(listed.nodes.find((node) => node.id === result.folderId), 'new folder under the caller folder').toMatchObject({ kind: 'folder', parentId: created, title: 'Review the build' });

  const refused = await client.callTool({ name: 'task_start', arguments: { source: 'x', permissionMode: 'bypassPermissions', confirmBypassPermissions: true } });
  expect(refused.isError, 'bypass is refused for an agent').toBe(true);
});
