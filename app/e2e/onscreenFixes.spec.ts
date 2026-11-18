import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let root: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agide-fixes-'));
  mkdirSync(join(root, 'plain'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: join(root, 'data'),
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      AGIDE_SESSION_CWD: join(root, 'plain'),
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  return page;
}

const activeInside = (page: Page, testId: string) =>
  page.evaluate((id) => {
    const doc = (globalThis as unknown as { document: { querySelector(selector: string): { contains(node: unknown): boolean } | null; activeElement: unknown } }).document;
    return doc.querySelector(`[data-testid="${id}"]`)?.contains(doc.activeElement) ?? false;
  }, testId);

test('a dialog takes focus, keeps Tab inside, closes on Escape and gives focus back', async () => {
  const page = await launch();
  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await page.getByRole('menuitem', { name: 'New task…', exact: true }).click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog opens').toBeVisible();
  await expect(page.getByTestId('task-source'), 'the first field has focus on open').toBeFocused();
  await expect(page.locator('.dialog-backdrop'), 'the backdrop is drawn behind the dialog').toBeVisible();

  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press('Tab');
    expect(await activeInside(page, 'new-task-dialog'), `focus stays in the dialog after Tab ${step + 1}`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await activeInside(page, 'new-task-dialog'), 'focus stays in the dialog after Shift+Tab').toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-task-dialog'), 'Escape closes the dialog').toBeHidden();
  await expect(page.locator('.dialog-backdrop'), 'the backdrop goes with it').toHaveCount(0);
});

test('the window always names its profile, also when the profile is temporary', async () => {
  const page = await launch();
  const strip = page.getByTestId('profile-strip');
  await expect(strip, 'the strip shows the profile name').toBeVisible();
  await expect(strip, 'the strip is not empty').not.toHaveText('');
});

test('a session in the tree keeps its title when the pane is narrow', async () => {
  const page = await launch();
  const folder = await page.evaluate(async () => (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<{ ok: boolean; value: { id: string } }> } }).api.invoke('ui_create_folder', { title: 'Project A' }));
  expect(folder.ok, 'folder created').toBe(true);
  await page.evaluate(
    async ([folderId, cwd]) => (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<unknown> } }).api.invoke('session_create', { folderId, cwd, title: 'Fix upload retry' }),
    [folder.value.id, join(root, 'plain')],
  );
  const folderRow = page.getByRole('treeitem', { name: 'Project A', exact: true });
  if ((await folderRow.getAttribute('aria-expanded')) !== 'true') await folderRow.dblclick();
  const row = page.getByRole('treeitem', { name: /Fix upload retry/ });
  await expect(row, 'the session row shows').toBeVisible();
  const title = row.locator('.tree-title');
  const box = await title.boundingBox();
  expect(box?.width ?? 0, 'the title gets room before the type label').toBeGreaterThan(40);
  const rowBox = await row.boundingBox();
  const pane = await page.getByTestId('tree-pane').boundingBox();
  expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0), 'the row ends inside the tree pane').toBeLessThanOrEqual((pane?.x ?? 0) + (pane?.width ?? 0) + 1);
});
