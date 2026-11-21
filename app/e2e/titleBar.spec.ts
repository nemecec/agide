import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

let root: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agide-titlebar-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  app = await electron.launch({ args: [MAIN], env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: join(root, 'data'), CLAUDE_CONFIG_DIR: join(root, 'claude-config') } });
  const page = await app.firstWindow();
  await expect(page.getByTestId('title-bar'), 'the title bar rendered').toBeVisible();
  return page;
}

test('the title bar is a 38 px drag region whose controls do not drag', async () => {
  const page = await launch();
  const regions = await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(selector: string): unknown } }).document;
    const win = globalThis as unknown as { getComputedStyle(element: unknown): { getPropertyValue(name: string): string }; };
    const region = (selector: string) => win.getComputedStyle(doc.querySelector(selector)).getPropertyValue('-webkit-app-region');
    return { bar: region('[data-testid="title-bar"]'), settings: region('[data-testid="title-bar-settings"]'), layout: region('[data-testid="layout-switcher"]') };
  });
  expect(regions.bar, 'the bar drags the window').toBe('drag');
  expect(regions.settings, 'the settings button does not drag').toBe('no-drag');
  expect(regions.layout, 'the layout switcher does not drag').toBe('no-drag');
  expect((await page.getByTestId('title-bar').boundingBox())?.height, 'the bar is 38 px high').toBe(38);
});

test('the layout switcher lists the presets and switches the window', async () => {
  const page = await launch();
  await page.getByTestId('layout-switcher').click();
  await page.getByRole('menuitem', { name: 'Pair', exact: true }).click();
  await expect(page.getByTestId('layout-switcher'), 'the switcher shows the new layout').toHaveText('Pair');
});

test('the settings button opens the profile settings dialog', async () => {
  const page = await launch();
  await page.getByTestId('title-bar-settings').click();
  await expect(page.getByRole('dialog'), 'a dialog opens').toBeVisible();
});

test('the OS window title names the profile', async () => {
  await launch();
  const title = await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle());
  expect(title, 'the window title carries the profile name').toContain('Agide');
});
