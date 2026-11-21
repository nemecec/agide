import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let root: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agide-focus-'));
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
    env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: join(root, 'data'), AGIDE_CLAUDE_BIN: FAKE_CLAUDE, AGIDE_SESSION_CWD: join(root, 'plain') },
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  return page;
}

type Api = { invoke(id: string, input: unknown): Promise<{ ok: boolean; value: { id: string; leafId: string } }> };
const invoke = (page: Page, id: string, input: unknown) => page.evaluate(([commandId, args]) => (globalThis as unknown as { api: Api }).api.invoke(commandId as string, args), [id, input] as const);

type Doc = { activeElement: unknown; querySelector(selector: string): { contains(node: unknown): boolean } | null };

const activeInside = (page: Page, selector: string) =>
  page.evaluate((css) => {
    const doc = (globalThis as unknown as { document: Doc }).document;
    return doc.querySelector(css)?.contains(doc.activeElement) ?? false;
  }, selector);

const windowSize = (page: Page) => page.evaluate(() => (globalThis as unknown as { innerWidth: number; innerHeight: number }).innerWidth + 'x' + (globalThis as unknown as { innerHeight: number }).innerHeight);

const ringOfActiveElement = (page: Page) =>
  page.evaluate(() => {
    const element = (globalThis as unknown as { document: Doc }).document.activeElement as { tagName: string };
    const style = (globalThis as unknown as { getComputedStyle(node: unknown): { outlineStyle: string; outlineWidth: string } }).getComputedStyle(element);
    return { tag: element.tagName, style: style.outlineStyle, width: style.outlineWidth };
  });

async function createFolder(page: Page, title: string): Promise<string> {
  const created = await invoke(page, 'ui_create_folder', { title });
  await expect(page.getByRole('treeitem', { name: title, exact: true }), `folder ${title} is in the tree`).toBeVisible();
  return created.value.id;
}

async function openTaskDialog(page: Page): Promise<void> {
  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await page.getByRole('menuitem', { name: 'New task…', exact: true }).click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog opens').toBeVisible();
}

test('a dialog traps Tab, closes on Escape and gives focus back to the element that had it', async () => {
  const page = await launch();
  await createFolder(page, 'Project');
  const row = page.getByRole('treeitem', { name: 'Project', exact: true });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New task…', exact: true }).click();
  await expect(page.getByTestId('new-task-dialog'), 'the dialog opens').toBeVisible();
  await expect(page.getByTestId('task-source'), 'the first field has focus on open').toBeFocused();

  for (let step = 0; step < 16; step += 1) {
    await page.keyboard.press('Tab');
    expect(await activeInside(page, '[data-testid="new-task-dialog"]'), `focus stays in the dialog after Tab ${step + 1}`).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await activeInside(page, '[data-testid="new-task-dialog"]'), 'focus stays in the dialog after Shift+Tab').toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-task-dialog'), 'Escape closes the dialog').toBeHidden();
  await expect.poll(() => activeInside(page, '[data-testid="tree-pane"]'), { message: 'focus is back in the tree, where the dialog was opened' }).toBe(true);
});

test('a context menu takes the arrow keys, runs the entry on Enter and closes on Escape', async () => {
  const page = await launch();
  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await expect(page.getByRole('menu'), 'the menu opens at the pointer').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu'), 'Escape closes the menu').toBeHidden();

  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'New task…', exact: true }), 'the arrow keys moved the highlight to the second entry').toHaveAttribute('data-highlighted', '');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('new-task-dialog'), 'Enter ran the highlighted entry').toBeVisible();
  await expect(page.getByRole('menu'), 'the menu closed with it').toBeHidden();
});

test('a context menu opened at the bottom of the pane stays inside the window and sets the destructive entry apart', async () => {
  const page = await launch();
  await createFolder(page, 'Project');
  const pane = await page.getByTestId('tree-pane').boundingBox();
  const [width, height] = (await windowSize(page)).split('x').map(Number) as [number, number];
  expect(pane, 'the tree pane has a box').not.toBeNull();
  await page.getByRole('treeitem', { name: 'Project', exact: true }).click({ button: 'right' });
  await page.mouse.click(pane!.x + 40, pane!.y + pane!.height - 3, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu, 'the menu opens near the bottom edge').toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.y + box!.height, 'the menu ends above the bottom edge of the window').toBeLessThanOrEqual(height);
  expect(box!.x + box!.width, 'the menu ends left of the right edge of the window').toBeLessThanOrEqual(width);

  await page.keyboard.press('Escape');
  await page.getByRole('treeitem', { name: 'Project', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true }), 'the destructive entry is marked').toHaveAttribute('data-danger', 'true');
  await expect(page.getByRole('separator'), 'a separator sits above the destructive entry').toHaveCount(1);
});

test('the tab menu of a browser tab opens with the keyboard, closes on Escape and returns focus to its button', async () => {
  const page = await launch();
  const folderId = (await invoke(page, 'ui_create_folder', { title: 'Work' })).value.id;
  const tab = await invoke(page, 'browser_new_tab', { folderId, url: 'about:blank' });
  expect(tab.ok, 'the tab is created').toBe(true);
  await page.getByRole('treeitem', { name: 'Work', exact: true }).dblclick();
  await page.getByRole('treeitem').filter({ hasNotText: 'Work' }).first().click();
  await expect(page.getByTestId('browser-pane'), 'the tab opens').toBeVisible();

  const button = page.getByRole('button', { name: 'Tab menu' });
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu, 'Enter opens the menu').toBeVisible();
  await expect(page.getByRole('menuitem'), 'the entries of the tab menu').toHaveText(['Copy URL', 'DevTools', 'Clear this service\'s site data…']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu, 'Escape closes the menu').toBeHidden();
  await expect(button, 'focus is back on the button that opened it').toBeFocused();
});

test('the focus ring shows after Tab and not after a click', async () => {
  const page = await launch();
  await openTaskDialog(page);
  const preview = page.getByRole('button', { name: 'Preview', exact: true });
  await preview.click();
  await expect(preview, 'the click gave the disclosure focus').toBeFocused();
  expect((await ringOfActiveElement(page)).style, 'no ring on a button after a click').toBe('none');

  await page.keyboard.press('Tab');
  const ring = await ringOfActiveElement(page);
  expect(ring.tag, 'Tab moved to a button').toBe('BUTTON');
  expect(ring.style, 'a ring after Tab').toBe('solid');
  expect(ring.width, 'two pixels wide').toBe('2px');
});
