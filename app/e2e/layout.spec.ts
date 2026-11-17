import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PAIR_PRESET, SESSION_PRESET } from '../src/core/blocks/presets';
import type { CommandResult } from '../src/core/commands/types';
import type { RendererApi } from '../src/shared/ipc';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

let userData: string;
let running: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'agide-layout-'));
});

test.afterEach(async () => {
  await running?.close();
  running = undefined;
  rmSync(userData, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  running = await electron.launch({ args: [MAIN], env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData } });
  const page = await running.firstWindow();
  await expect(page.getByTestId('tree-pane'), 'tree pane is rendered').toBeVisible();
  return page;
}

const layoutFile = (id: string) => join(userData, 'layouts', `${id}.json`);
const writeLayout = (id: string, content: unknown) => {
  mkdirSync(join(userData, 'layouts'), { recursive: true });
  writeFileSync(layoutFile(id), typeof content === 'string' ? content : JSON.stringify(content));
};
const invoke = <T,>(page: Page, id: string, input?: unknown) =>
  page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const) as Promise<CommandResult<T>>;

test('shows the Session preset: a tree and one surface host side by side', async ({}) => {
  const page = await launch();
  await expect(page.getByTestId('surface-pane'), 'one surface host').toHaveCount(1);
  await expect(page.getByText('Open a session or tab from the tree'), 'the empty text of the preset').toBeVisible();
  const boxes = await Promise.all([page.getByTestId('tree-pane').boundingBox(), page.getByTestId('surface-pane').boundingBox()]);
  expect(boxes[0]!.x, 'tree is left of the surface').toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.width, 'the surface is wider than the tree (weights 1 to 3)').toBeGreaterThan(boxes[0]!.width * 2);
});

test('shows a layout file edited on disk without a restart, and keeps the layout when the file turns invalid', async () => {
  const page = await launch();
  await expect(page.getByTestId('surface-pane')).toHaveCount(1);

  writeLayout('session', { ...PAIR_PRESET, id: 'session', title: 'Edited', revision: 1 });
  await expect(page.getByTestId('surface-pane'), 'the edited file adds a second surface host').toHaveCount(2);
  await expect(page.getByTestId('layout-change'), 'the change is announced with an undo').toBeVisible();

  const bad = '{ "schemaVersion": 1, "broken": ';
  writeLayout('session', bad);
  await expect(page.getByTestId('layout-error'), 'the problem is shown').toBeVisible();
  await expect(page.getByTestId('surface-pane'), 'the previous layout keeps running').toHaveCount(2);
  expect(readFileSync(layoutFile('session'), 'utf8'), 'the app does not overwrite the invalid file').toBe(bad);

  writeLayout('session', { ...SESSION_PRESET, revision: 1 });
  await expect(page.getByTestId('layout-error'), 'the error goes away with a valid file').toHaveCount(0);
  await expect(page.getByTestId('surface-pane'), 'back to one surface host').toHaveCount(1);
});

test('applies a layout through the command, undoes it and survives a restart on the saved layout', async () => {
  const page = await launch();
  const applied = await invoke<{ revision: number }>(page, 'layout_switch', { layoutId: 'pair' });
  expect(applied.ok, 'switching to the Pair preset').toBe(true);
  await expect(page.getByTestId('surface-pane'), 'Pair shows two surface hosts').toHaveCount(2);

  const change = await invoke<{ revision: number }>(page, 'layout_apply', {
    layoutId: 'pair',
    expectedRevision: 1,
    patch: [{ op: 'replace', path: '/instances/side/config/emptyText', value: 'Beside' }],
  });
  expect(change.ok, 'apply by patch').toBe(true);
  await expect(page.getByText('Beside'), 'the new text shows').toBeVisible();
  expect(existsSync(layoutFile('pair')), 'the layout is saved in the profile').toBe(true);

  await invoke(page, 'layout_undo', { layoutId: 'pair' });
  await expect(page.getByText('Use Open to the side on a tree item'), 'undo brings the old text back').toBeVisible();

  await running?.close();
  running = undefined;
  const again = await launch();
  await expect(again.getByTestId('surface-pane'), 'the window opens on the Pair layout').toHaveCount(2);
});

test('returns a PNG of the window from ui_capture_window', async () => {
  const page = await launch();
  const result = await invoke<{ type: string; data: string; width: number }>(page, 'ui_capture_window');
  expect(result.ok, 'capture succeeds in a hidden window').toBe(true);
  if (!result.ok) return;
  const png = Buffer.from(result.value.data, 'base64');
  expect(png.subarray(1, 4).toString(), 'PNG signature').toBe('PNG');
  expect(result.value.width, 'the image has a size').toBeGreaterThan(100);
});
