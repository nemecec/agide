import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CommandResult } from '../src/core/commands/types';
import type { AppearanceTestHook } from '../src/main/appearanceIpc';
import type { RendererApi } from '../src/shared/ipc';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let app: ElectronApplication;
let userData: string;
let workdir: string;

const launch = (): Promise<ElectronApplication> =>
  electron.launch({
    args: [MAIN],
    env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData, AGIDE_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CLAUDE_RECORD: join(userData, 'launches.jsonl') },
  });

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-theme-e2e-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-theme-cwd-'));
  app = await launch();
});

test.afterEach(async () => {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

const setThemeSource = (source: 'light' | 'dark') => app.evaluate(({ nativeTheme }, value) => void (nativeTheme.themeSource = value), source);

const hook = <T>(run: (appearance: AppearanceTestHook) => T) =>
  app.evaluate((_electron, source) => {
    const hooks = (globalThis as unknown as { __agideTestHooks: { appearance: AppearanceTestHook } }).__agideTestHooks;
    return new Function('appearance', `return (${source})(appearance)`)(hooks.appearance) as unknown;
  }, run.toString()) as Promise<T>;

const token = (page: Page, name: string) => page.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);
const root = (page: Page, expression: string) => page.evaluate<string>(`document.documentElement.${expression}`);
const dock = (page: Page) => page.locator('.agide-dock').first();
const terminalViewport = (page: Page) => page.locator('.terminal-host .xterm-scrollable-element');

const invokeOn = <T>(page: Page, id: string, input: unknown) =>
  page.evaluate(([commandId, payload]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, payload), [id, input] as const) as Promise<CommandResult<T>>;

async function openTerminal(page: Page): Promise<void> {
  const invoke = <T>(id: string, input: unknown) => invokeOn<T>(page, id, input);
  const folder = await invoke<{ id: string }>('ui_create_folder', { title: 'Work' });
  if (!folder.ok) throw new Error('folder was not created');
  await invoke('session_create', { folderId: folder.value.id, cwd: workdir, title: 'Themed session' });
  const work = page.getByRole('treeitem', { name: 'Work', exact: true });
  if ((await work.getAttribute('aria-expanded')) === 'false') await work.dblclick();
  await page.getByRole('treeitem', { name: 'Themed session' }).click();
  await expect(page.getByTestId('terminal-host'), 'the session shows its terminal').toBeVisible();
  await expect(page.locator('.terminal-host .xterm-scrollable-element'), 'xterm is mounted').toBeAttached();
}

test('the theme follows the OS appearance without a reload', async () => {
  const page = await app.firstWindow();
  await openTerminal(page);
  await page.evaluate('globalThis.__noReload = true');

  await setThemeSource('dark');
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'content surface follows the OS to dark' }).toBe('#1b1b1e');
  await expect(dock(page), 'dock root scheme in a dark OS').toHaveCSS('color-scheme', 'dark');
  await expect(terminalViewport(page), 'terminal background equals the dark content token').toHaveCSS('background-color', 'rgb(27, 27, 30)');
  expect(await token(page, '--agide-text-primary'), 'primary text in the dark theme').toBe('#ececf0');

  await setThemeSource('light');
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'content surface follows the OS back to light' }).toBe('#ffffff');
  await expect(dock(page), 'dock root scheme in a light OS').toHaveCSS('color-scheme', 'light');
  await expect(terminalViewport(page), 'terminal background equals the light content token').toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await page.evaluate('globalThis.__noReload'), 'the page was not reloaded').toBe(true);
});

test('the System theme follows an accent and increased contrast reported by the adapter', async () => {
  const page = await app.firstWindow();
  await setThemeSource('light');
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'light OS' }).toBe('#ffffff');
  expect(await token(page, '--agide-accent'), 'the Agide blue while the OS reports no accent override').toMatch(/^#[0-9a-f]{6}$/);

  await hook((appearance) => appearance.override({ accent: '#f74f9e' }));
  await expect.poll(() => token(page, '--agide-accent'), { message: 'pink OS accent gives the derived fill' }).toBe('#cb4182');
  expect(await token(page, '--agide-accent-on'), 'white text on the fill').toBe('#ffffff');

  await hook((appearance) => appearance.override({ accent: '#f74f9e', highContrast: true }));
  await expect.poll(() => root(page, 'dataset.contrast'), { message: 'increased contrast flag' }).toBe('more');
  expect(await token(page, '--agide-text-primary'), 'increased contrast primary text in light').toBe('#000000');
  expect(await token(page, '--agide-focus-width'), 'thicker focus ring').toBe('3px');

  await hook((appearance) => appearance.override(undefined));
  await expect.poll(() => root(page, 'dataset.contrast'), { message: 'override cleared' }).toBe('normal');
});

test('the theme choice is saved for the profile and kept after a restart', async () => {
  const page = await app.firstWindow();
  await setThemeSource('light');
  const saved = await invokeOn(page, 'theme_apply', { id: 'agide-dark', expectedRevision: 1 });
  expect(saved.ok, 'theme_apply saves Agide Dark').toBe(true);
  await expect.poll(() => token(page, '--agide-surface-content'), { message: 'Agide Dark stays dark in a light OS' }).toBe('#1b1b1e');
  expect(await root(page, 'style.colorScheme'), 'color scheme of the page').toBe('dark');
  expect(JSON.parse(readFileSync(join(userData, 'appearance.json'), 'utf8')), 'file in the profile data directory').toMatchObject({ schema: 1, themeId: 'agide-dark', revision: 2 });

  const refused = await invokeOn(page, 'theme_apply', { id: 'no-such-theme', expectedRevision: 2 });
  expect(refused.ok, 'an unknown id is refused').toBe(false);
  expect(JSON.parse(readFileSync(join(userData, 'appearance.json'), 'utf8')).themeId, 'the choice stays as it was').toBe('agide-dark');

  await app.close();
  app = await launch();
  const again = await app.firstWindow();
  await expect.poll(() => token(again, '--agide-surface-content'), { message: 'the choice is read at start' }).toBe('#1b1b1e');
});
