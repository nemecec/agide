import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { FileProfileStore, profilePaths, registryFile } from '../src/core/profile/index';
import type { RendererApi } from '../src/shared/ipc';
import { connectAsSession, recordedLaunches } from './sessionMcp';

const electronPath = createRequire(import.meta.url)('electron') as string;
const { CLAUDE_CONFIG_DIR: _inheritedLogin, ...cleanEnv } = process.env;
const mainEntry = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const fakeClaude = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let root: string;
let workdir: string;
let client: Client | undefined;
const apps: ElectronApplication[] = [];
const launchesFile = (profile: string) => join(root, `launches-${profile}.jsonl`);

const launch = async (profile: string): Promise<{ app: ElectronApplication; page: Page }> => {
  const app = await electron.launch({
    args: [mainEntry, `--profile=${profile}`],
    env: { ...cleanEnv, AGIDE_HIDDEN: '1', AGIDE_ROOT: root, AGIDE_CLAUDE_BIN: fakeClaude, AGIDE_SESSION_CWD: workdir, FAKE_CLAUDE_RECORD: launchesFile(profile) },
  });
  apps.push(app);
  return { app, page: await app.firstWindow() };
};

const invoke = <T>(page: Page, id: string, input: unknown): Promise<{ ok: boolean; value?: T }> =>
  page.evaluate(([commandId, payload]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, payload) as never, [id, input] as const);

const focusRequests = (app: ElectronApplication): Promise<unknown[]> =>
  app.evaluate(() => (globalThis as unknown as { __agideTestHooks: { focusRequests: unknown[] } }).__agideTestHooks.focusRequests);

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agide-profiles-e2e-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-profiles-cwd-'));
});

test.afterEach(async () => {
  await client?.close();
  client = undefined;
  for (const app of apps.splice(0)) await app.close().catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

test('two profiles run side by side with separate data, trees and Claude directories', async () => {
  const a = await launch('default');
  new FileProfileStore({ root, ownerId: 'default' }).create({ name: 'Work', colour: '#336699' });
  const b = await launch('work');

  const userData = async (app: ElectronApplication): Promise<string> => app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(await userData(a.app), 'default data directory').toBe(profilePaths(root, 'default').data);
  expect(await userData(b.app), 'work data directory').toBe(profilePaths(root, 'work').data);
  expect(existsSync(join(profilePaths(root, 'work').data, 'app.db')), 'work has its own database').toBe(true);
  expect(statSync(profilePaths(root, 'work').claude).mode & 0o777, 'work Claude directory mode').toBe(0o700);

  const defaultSettings = JSON.parse(readFileSync(profilePaths(root, 'default').settings, 'utf8')) as { claudeConfig: unknown };
  const workSettings = JSON.parse(readFileSync(profilePaths(root, 'work').settings, 'utf8')) as { claudeConfig: unknown };
  expect(defaultSettings.claudeConfig, 'default adopts the CLI login').toEqual({ mode: 'cli-default' });
  expect(workSettings.claudeConfig, 'work has its own Claude directory').toEqual({ mode: 'directory', path: profilePaths(root, 'work').claude });

  await invoke(a.page, 'ui_create_folder', { title: 'only in default' });
  const treeA = await invoke<unknown[]>(a.page, 'ui_list_tree', {});
  const treeB = await invoke<unknown[]>(b.page, 'ui_list_tree', {});
  expect(JSON.stringify(treeA.value), 'default tree holds its folder').toContain('only in default');
  expect(JSON.stringify(treeB.value), 'work tree does not hold it').not.toContain('only in default');

  const titles = await Promise.all([a, b].map(({ app }) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())));
  expect(titles, 'window titles carry the profile name').toEqual(['Default · Agide', 'Work · Agide']);
  await expect(b.page.getByTestId('profile-identity'), 'title bar identity in the profile colour').toHaveAttribute('data-colour', '#336699');
});

test('a second start of a profile hands over to the running process and exits', async () => {
  const a = await launch('default');
  const result = spawnSync(electronPath, [mainEntry, '--profile=default'], {
    env: { ...cleanEnv, AGIDE_HIDDEN: '1', AGIDE_ROOT: root },
    timeout: 30_000,
  });
  expect(result.status, 'second process exits 0').toBe(0);
  await expect.poll(() => focusRequests(a.app), { message: 'running process got the focus request' }).toEqual([{ profileId: 'default', action: 'focus' }]);
});

test('clicking a running profile in the rail focuses it, and an inbox item posted over MCP shows as a badge in the other profile rail', async () => {
  const a = await launch('default');
  new FileProfileStore({ root, ownerId: 'default' }).create({ name: 'Work', colour: '#336699' });
  const b = await launch('work');

  await expect(a.page.getByTestId('profile-work'), 'work is running in the default rail').toHaveAttribute('data-running', 'true');
  await a.page.getByTestId('profile-work').click();
  await expect.poll(() => focusRequests(b.app), { message: 'work got the focus request from the click' }).toEqual([{ profileId: 'work', action: 'focus' }]);

  await expect(b.page.getByTestId('badge-default'), 'no badge before an item exists').toHaveCount(0);
  const folder = await invoke<{ id: string }>(a.page, 'ui_create_folder', { title: 'Billing' });
  const session = await invoke<{ sessionId: string }>(a.page, 'session_create', { folderId: folder.value?.id });
  expect(session.ok, 'a session starts in the default profile').toBe(true);
  // The setup pane also runs `claude auth status` through the same executable; the session launch is the one with a session id.
  const sessionLaunch = () => recordedLaunches(launchesFile('default')).find((launch) => launch.args.includes('--session-id'));
  await expect.poll(() => sessionLaunch() !== undefined, { message: 'the fake claude recorded the session launch' }).toBe(true);
  client = await connectAsSession(sessionLaunch()!);
  const posted = await client.callTool({ name: 'inbox_post', arguments: { message: 'Invoice job fixed' } });
  expect(posted.isError, 'inbox_post succeeds').toBeFalsy();

  await expect(b.page.getByTestId('badge-default').locator('[aria-hidden="true"]'), 'badge of default in the work rail').toHaveText('1', { timeout: 15_000 });
  const entry = readFileSync(registryFile(root, 'default'), 'utf8');
  expect(JSON.parse(entry), 'registry entry holds the count').toMatchObject({ unread: 1, profileId: 'default' });
  expect(entry, 'registry entry holds no item text').not.toContain('Invoice');
  expect(await a.app.evaluate(({ app }) => app.getBadgeCount()), 'dock badge of the default profile').toBe(1);
  await expect(a.page.getByTestId('badge-default').locator('[aria-hidden="true"]'), 'the own rail entry shows its count too').toHaveText('1');
  expect(execFileSync('stat', ['-f', '%Lp', registryFile(root, 'default')]).toString().trim(), 'registry entry mode').toBe('600');
});
