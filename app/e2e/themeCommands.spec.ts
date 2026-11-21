import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CommandResult } from '../src/core/commands/types';
import type { RendererApi } from '../src/shared/ipc';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let app: ElectronApplication | undefined;
let userData: string;

const launch = async (): Promise<Page> => {
  app = await electron.launch({ args: [MAIN], env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData, AGIDE_CLAUDE_BIN: FAKE_CLAUDE } });
  return app.firstWindow();
};

test.beforeEach(() => void (userData = mkdtempSync(join(tmpdir(), 'agide-theme-cmd-e2e-'))));
test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userData, { recursive: true, force: true });
});

const invoke = <T>(page: Page, id: string, input: unknown = {}) =>
  page.evaluate(([commandId, payload]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, payload), [id, input] as const) as Promise<CommandResult<T>>;
const value = async <T>(page: Page, id: string, input: unknown = {}): Promise<T> => {
  const result = await invoke<T>(page, id, input);
  if (!result.ok) throw new Error(`${id} failed: ${result.error.message}`);
  return result.value;
};
const token = (page: Page, name: string) => page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);
const revision = async (page: Page) => (await value<{ revision: number }>(page, 'theme_list')).revision;

test('a preview colours the window without saving and Revert restores the saved theme', async () => {
  const page = await launch();
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'the theme is written at start' }).not.toBe('');
  const saved = await token(page, '--agide-surface-content');
  const { previewId } = await value<{ previewId: string }>(page, 'theme_preview', { id: 'catppuccin-mocha' });
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'the preview colours the content surface' }).toBe('#1e1e2e');
  expect(await token(page, '--vscode-button-background'), 'the alias carries the original VS Code colour of the file').toBe('#cba6f7');
  await expect(page.getByTestId('theme-preview-bar'), 'the notice offers Keep and Revert').toContainText('Previewing Catppuccin Mocha');
  expect(existsSync(join(userData, 'appearance.json')), 'nothing is saved by a preview').toBe(false);

  await page.getByRole('button', { name: 'Revert' }).click();
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'Revert shows the saved theme' }).toBe(saved);
  const again = await invoke(page, 'theme_apply', { previewId, expectedRevision: 1 });
  expect(again.ok, 'a reverted preview cannot be kept').toBe(false);
});

test('Keep saves the previewed theme, a stale apply is refused and Undo restores the earlier one, across a restart', async () => {
  let page = await launch();
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'the theme is written at start' }).not.toBe('');
  const before = await token(page, '--agide-surface-content');
  const { previewId } = await value<{ previewId: string }>(page, 'theme_preview', { id: 'github-dark-default' });
  await page.getByRole('button', { name: 'Keep' }).click();
  await expect.poll(() => revision(page), { message: 'Keep is a new revision' }).toBe(2);
  await expect(page.getByTestId('theme-change-bar'), 'the change is announced with Undo').toContainText('GitHub Dark Default (port)');
  expect(previewId, 'a preview id was issued').toBeTruthy();

  const stale = await invoke<unknown>(page, 'theme_apply', { id: 'agide-light', expectedRevision: 1 });
  expect(stale.ok ? undefined : stale.error.code, 'a stale revision is refused').toBe('invalid_input');
  expect(JSON.parse(readFileSync(join(userData, 'appearance.json'), 'utf8')).themeId, 'the choice is saved').toBe('github-dark-default');

  await app?.close();
  page = await launch();
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'the saved theme returns after a restart' }).toBe('#0d1117');

  await value(page, 'theme_undo');
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'undo restores the theme of before' }).toBe(before);
  expect(await revision(page), 'undo is a new revision').toBe(3);
});

test('the Settings picker previews, keeps and imports a theme file with its license shown first', async () => {
  const page = await launch();
  await page.getByRole('button', { name: 'Settings' }).click();
  const picker = page.getByTestId('settings-themes');
  await expect(picker.getByTestId('theme-detail-github-dark-default'), 'license and source of the port').toContainText('MIT');

  await picker.getByTestId('theme-row-catppuccin-mocha').getByRole('button', { name: 'Preview' }).click();
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'the dialog shows the preview' }).toBe('#1e1e2e');
  await picker.getByTestId('theme-preview-bar').getByRole('button', { name: 'Keep' }).click();
  await expect(picker.getByTestId('theme-row-catppuccin-mocha'), 'the kept theme is active').toContainText('Active');

  await picker.getByTestId('theme-import-open').click();
  const file = { name: 'Plain Light.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'light', colors: { 'editor.background': '#fafafa', foreground: '#202020', 'button.background': '#1060c0' } })) };
  await page.getByTestId('theme-import-file').setInputFiles(file);
  await expect(page.getByTestId('theme-import-license-form'), 'a bare file asks for its license').toBeVisible();
  await page.getByTestId('theme-import-license-unknown').click();
  await expect(page.getByTestId('theme-import-license'), 'the license text is shown before Keep').toHaveValue(/not known/);
  await page.getByTestId('theme-import-keep').click();
  const row = picker.getByTestId('theme-row-plain-light');
  await expect(row, 'the imported theme is listed with its license state').toContainText('License unknown');
  await row.getByRole('button', { name: 'Use' }).click();
  await expect(row, 'the imported theme is active').toContainText('Active');
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'the imported theme colours the window' }).toBe('#fafafa');
});
