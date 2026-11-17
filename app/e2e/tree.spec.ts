import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CommandResult } from '../src/core/commands/types';
import type { TreeNode } from '../src/core/tree/types';
import type { RendererApi } from '../src/shared/ipc';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

let userData: string;
let running: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'agide-tree-'));
});

test.afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(userData, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  running = await electron.launch({
    args: [MAIN],
    env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData },
  });
  const page = await running.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'tree is rendered').toBeVisible();
  return page;
}

async function restart(): Promise<Page> {
  await running?.close();
  running = undefined;
  return launch();
}

const item = (page: Page, title: string) => page.getByRole('treeitem', { name: title, exact: true });

async function addFromMenu(page: Page, target: string | null, entry: string, title: string): Promise<void> {
  if (target === null) await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  else await item(page, target).click({ button: 'right' });
  await page.getByRole('menuitem', { name: entry, exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Rename' });
  await expect(input, 'a new node starts in rename mode').toBeVisible();
  await input.fill(title);
  await input.press('Enter');
  await expect(item(page, title), `"${title}" appears in the tree`).toBeVisible();
}

/** The tree as `title` nested by parent, read through the same command the UI uses. */
async function treeShape(page: Page): Promise<unknown> {
  const result = await page.evaluate(() =>
    (globalThis as unknown as { api: RendererApi }).api.invoke('ui_list_tree'),
  );
  const listed = result as CommandResult<{ nodes: TreeNode[] }>;
  const nodes = listed.ok ? listed.value.nodes : [];
  const below = (parentId: string | null): unknown[] =>
    nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((n) => (n.kind === 'folder' ? { [n.title]: below(n.id) } : n.title));
  return below(null);
}

async function expandAll(page: Page): Promise<void> {
  for (;;) {
    const collapsed = page.locator('[role="treeitem"][aria-expanded="false"]');
    if ((await collapsed.count()) === 0) return;
    await collapsed.first().dblclick();
  }
}

test('creates nested folders and a leaf, moves the leaf between folders by drag and drop, and keeps the tree after a restart', async () => {
  const page = await launch();

  await addFromMenu(page, null, 'New folder', 'Work');
  await addFromMenu(page, null, 'New folder', 'Archive');
  await addFromMenu(page, 'Work', 'New folder', 'Sprint');
  await addFromMenu(page, 'Work', 'New Browser tab', 'Docs');
  expect(await treeShape(page), 'nested folders and the leaf as created').toEqual([
    { Work: [{ Sprint: [] }, 'Docs'] },
    { Archive: [] },
  ]);

  await item(page, 'Docs').dragTo(item(page, 'Archive'));
  expect(await treeShape(page), 'the leaf moved into Archive').toEqual([{ Work: [{ Sprint: [] }] }, { Archive: ['Docs'] }]);

  const expected = [{ Work: [{ Sprint: [] }] }, { Archive: ['Docs'] }];
  const reopened = await restart();
  expect(await treeShape(reopened), 'same tree after restart on the same data directory').toEqual(expected);
  await expandAll(reopened);
  await expect(item(reopened, 'Docs'), 'the moved leaf is shown under Archive').toBeVisible();
  await expect(item(reopened, 'Sprint'), 'the nested folder is shown').toBeVisible();
});

test('renames a node inline and navigates with the keyboard', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'One');
  await addFromMenu(page, null, 'New folder', 'Two');

  await item(page, 'One').click();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Two'), 'ArrowDown moves the focus to the next item').toHaveAttribute('data-focused', 'true');
  // The tree moves DOM focus after it renders the new focused item. A rename input that opens before that
  // loses focus to the item and closes.
  await expect(item(page, 'Two'), 'the DOM focus follows the focused item').toBeFocused();

  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Rename' });
  await input.fill('Second');
  await input.press('Enter');
  await expect(item(page, 'Second'), 'F2 renames the focused node').toBeVisible();
  expect(await treeShape(page), 'the rename is stored').toEqual([{ One: [] }, { Second: [] }]);
});

test('rejects a drop of a folder into its own subtree and accepts a drop elsewhere', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'Outer');
  await addFromMenu(page, 'Outer', 'New folder', 'Inner');
  await addFromMenu(page, null, 'New folder', 'Other');
  await item(page, 'Outer').dragTo(item(page, 'Inner'));
  expect(await treeShape(page), 'the rejected drop changed nothing').toEqual([{ Outer: [{ Inner: [] }] }, { Other: [] }]);

  await item(page, 'Inner').dragTo(item(page, 'Other'));
  expect(await treeShape(page), 'a drop into another folder moves the node').toEqual([{ Outer: [] }, { Other: [{ Inner: [] }] }]);
});

test('reorders siblings by dropping above an item', async () => {
  const page = await launch();
  await addFromMenu(page, null, 'New folder', 'One');
  await addFromMenu(page, null, 'New folder', 'Two');
  await addFromMenu(page, null, 'New folder', 'Three');
  await item(page, 'Three').dragTo(item(page, 'One'), { targetPosition: { x: 40, y: 2 } });
  expect(await treeShape(page), 'Three sits above One').toEqual([{ Three: [] }, { One: [] }, { Two: [] }]);
});
