import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { RendererApi } from '../src/shared/ipc';

let app: ElectronApplication;
let userData: string;

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-e2e-'));
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData },
  });
});

test.afterEach(async () => {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
});

test('opens a hidden window with the app title, a tree pane and a surface pane', async () => {
  const page = await app.firstWindow();
  await expect(page, 'window title').toHaveTitle('Agide');
  await expect(page.getByTestId('tree-pane'), 'tree pane is rendered').toBeAttached();
  await expect(page.getByTestId('surface-pane'), 'surface pane is rendered').toBeAttached();
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
  expect(visible, 'the only window stays hidden').toEqual([false]);
});

test('exposes the command API to the renderer', async () => {
  const page = await app.firstWindow();
  const result = await page.evaluate(() =>
    (globalThis as unknown as { api: RendererApi }).api.invoke('nothing_here', {}),
  );
  expect(result, 'unknown command comes back as a not_found result').toMatchObject({ ok: false, error: { code: 'not_found' } });
});
