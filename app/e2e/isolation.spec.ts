import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FileProfileStore } from '../src/core/profile/index';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let root: string;
let app: ElectronApplication | undefined;

const launch = async (env: Record<string, string>): Promise<Page> => {
  app = await electron.launch({
    args: [MAIN, '--profile=default'],
    env: { ...process.env, AGIDE_HIDDEN: '1', AGIDE_ROOT: root, AGIDE_CLAUDE_BIN: FAKE_CLAUDE, ...env },
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  await page.getByTestId('tree-pane').click({ button: 'right', position: { x: 200, y: 400 } });
  await page.getByRole('menuitem', { name: 'Profile settings…', exact: true }).click();
  await expect(page.getByTestId('settings-isolation'), 'the isolation section is shown').toBeVisible();
  return page;
};

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agide-isolation-e2e-'));
});

test.afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

test('a missing sandbox runtime shows the install message and cannot be chosen', async () => {
  const page = await launch({ AGIDE_SRT_BIN: join(root, 'no-such-srt') });
  await expect(page.getByTestId('isolation-srt-check'), 'the message names the runtime and the fix').toContainText('is not executable');
  await expect(page.getByTestId('isolation-srt-check')).toContainText('@anthropic-ai/sandbox-runtime');
  await expect(page.getByTestId('isolation-srt').getByRole('radio'), 'srt is disabled').toBeDisabled();
  await expect(page.getByTestId('isolation-local').getByRole('radio'), 'local stays selected').toBeChecked();
});

test('choosing srt shows its capability statement and stores the choice in the profile', async () => {
  const srt = join(root, 'srt');
  writeFileSync(srt, '#!/bin/sh\nexit 0\n');
  chmodSync(srt, 0o755);
  const page = await launch({ AGIDE_SRT_BIN: srt });
  const srtItem = page.getByTestId('isolation-srt');
  await expect(page.getByTestId('isolation-srt-check'), 'srt is ready').toHaveText('Ready.');
  await expect(srtItem, 'statement says what stays open').toContainText('Loopback');
  await expect(page.getByTestId('isolation-srt-bypass'), 'bypass answer for srt').toContainText('Allowed');
  await expect(page.getByTestId('isolation-container-bypass'), 'bypass answer for the container').toContainText('Not allowed');
  await expect(page.getByTestId('isolation-container').getByRole('radio'), 'the container is listed and not offered').toBeDisabled();

  await srtItem.getByRole('radio').click();
  await expect(srtItem.getByRole('radio'), 'srt is selected').toBeChecked();
  expect(new FileProfileStore({ root, ownerId: 'default' }).readSettings('default').isolation.provider, 'stored in the profile settings').toBe('srt');
});
