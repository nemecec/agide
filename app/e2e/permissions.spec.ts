import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { defaultPermissionSettings } from '../src/core/permissions/defaults';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'permissions', 'fixtures', 'fake-claude-gate.mjs');

let userData: string;
let workdir: string;
let running: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'agide-perm-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-perm-cwd-'));
});
test.afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

const launches = () => join(userData, 'launches.jsonl');
const hookOut = () => join(userData, 'hook-out.jsonl');
const lines = (file: string): Record<string, unknown>[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>) : [];

async function launch(toolCalls: unknown[] = []): Promise<Page> {
  running = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: userData,
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      AGIDE_SESSION_CWD: workdir,
      FAKE_CLAUDE_RECORD: launches(),
      FAKE_CLAUDE_HOOK_OUT: hookOut(),
      FAKE_TOOL_CALLS: JSON.stringify(toolCalls),
    },
  });
  const page = await running.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'tree is rendered').toBeVisible();
  return page;
}

type Api = { invoke(id: string, input: unknown): Promise<{ ok: boolean; value?: unknown }> };
const invoke = (page: Page, id: string, input: unknown) =>
  page.evaluate(([commandId, args]) => (globalThis as unknown as { api: Api }).api.invoke(commandId as string, args), [id, input] as const);

/** Creates a folder and starts a session in it through the new-session dialog. */
async function startSession(page: Page, mode?: string, defaultMode = 'auto'): Promise<void> {
  await invoke(page, 'ui_create_folder', { title: 'Project' });
  await page.getByRole('treeitem', { name: /Project/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Claude session', exact: true }).click();
  await expect(page.getByTestId('new-session-dialog'), 'the dialog opens').toBeVisible();
  await expect(page.getByTestId('new-session-mode'), 'the select starts at the profile default').toHaveValue(defaultMode);
  expect(await page.getByTestId('new-session-mode').locator('option').allTextContents(), 'bypass is not offered on the local provider').not.toContain('Bypass');
  if (mode) await page.getByTestId('new-session-mode').selectOption(mode);
  await page.getByTestId('new-session-start').click();
  await expect.poll(() => lines(launches()).length, 'the session launches').toBeGreaterThan(0);
}

const modeOf = (record: Record<string, unknown>): string => {
  const args = record['args'] as string[];
  return args[args.indexOf('--permission-mode') + 1] ?? '';
};

test.describe('permission mode and launch policy', () => {
  test('a session without a choice starts in auto with the ask rules, the inspector hook and the sandbox', async () => {
    const page = await launch();
    await startSession(page);
    const [launched] = lines(launches());
    expect(modeOf(launched!), 'launch mode').toBe('auto');
    const settings = launched!['settings'] as { permissions: { ask: string[] }; hooks: { PreToolUse: { hooks: { command: string }[] }[] } };
    expect(settings.permissions.ask, 'ask rules').toContain('Bash(git push *)');
    expect(settings.hooks.PreToolUse.flatMap((group) => group.hooks).map((hook) => hook.command).join('\n'), 'the inspector runs on every call').toContain('inspect.js');
  });

  test('the mode chosen in the dialog changes the launch argument', async () => {
    const page = await launch();
    await startSession(page, 'plan');
    expect(modeOf(lines(launches())[0]!), 'mode from the dialog').toBe('plan');
  });

  test('the profile default saved in the settings applies to the next session', async () => {
    const page = await launch();
    const saved = await invoke(page, 'permissions_set', { settings: { ...defaultPermissionSettings({ isDefaultProfile: true }), defaultMode: 'acceptEdits' } });
    expect(saved.ok, 'settings saved').toBe(true);
    await startSession(page, undefined, 'acceptEdits');
    expect(modeOf(lines(launches())[0]!), 'profile default').toBe('acceptEdits');
  });
});

test.describe('inspector decisions', () => {
  test('a denied class shows in the inbox as a blocked item and the hook answers deny', async () => {
    const page = await launch([{ tool_name: 'Bash', tool_input: { command: 'cd x && git push origin main' } }]);
    await invoke(page, 'permissions_set', { settings: { ...defaultPermissionSettings({ isDefaultProfile: true }), outward: { 'git.push': 'deny' } } });
    await startSession(page);
    await expect.poll(() => lines(hookOut()).length, 'the hook ran').toBeGreaterThan(0);
    const [out] = lines(hookOut());
    expect(JSON.parse(out!['stdout'] as string), 'hook output').toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    await page.evaluate(() => {
      (globalThis as unknown as { location: { hash: string } }).location.hash = '#pane=agide/inbox';
    });
    await page.reload();
    await expect(page.getByTestId('inbox-row').filter({ hasText: 'Blocked git.push' }), 'denial item in the inbox').toBeVisible();
  });

  test('a push asks and a read leaves the decision to the mode', async () => {
    const page = await launch([
      { tool_name: 'Bash', tool_input: { command: 'git -C . push' } },
      { tool_name: 'Bash', tool_input: { command: 'gh pr view 1' } },
    ]);
    await startSession(page);
    await expect.poll(() => lines(hookOut()).length, 'both hooks ran').toBe(2);
    const [push, read] = lines(hookOut());
    expect(JSON.parse(push!['stdout'] as string), 'push asks').toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } });
    expect(read!['stdout'], 'read leaves the decision open').toBe('');
  });
});
