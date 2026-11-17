import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CommandResult } from '../src/core/commands/types';
import type { AppEvent } from '../src/core/events/index';
import type { RendererApi } from '../src/shared/ipc';

const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

let app: ElectronApplication;
let userData: string;
let workdir: string;

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-e2e-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-e2e-cwd-'));
  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: userData,
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_RECORD: join(userData, 'launches.jsonl'),
    },
  });
});

test.afterEach(async () => {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

type Api = Pick<RendererApi, 'invoke' | 'subscribe'>;

async function collectEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as { api: Api; seen: AppEvent[] };
    w.seen = [];
    w.api.subscribe((event) => w.seen.push(event));
  });
}

const invoke = <T>(page: Page, id: string, input: unknown) =>
  page.evaluate(([commandId, payload]) => (globalThis as unknown as { api: Api }).api.invoke(commandId as string, payload), [id, input] as const) as Promise<CommandResult<T>>;

const seenTypes = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { seen: { type: string; hookEvent?: string }[] }).seen.map((e) => (e.hookEvent ? `${e.type}:${e.hookEvent}` : e.type)));

test('runs a session in a PTY inside the Electron main process and reaches the renderer', async () => {
  const page = await app.firstWindow();
  await collectEvents(page);
  const folder = await invoke<{ id: string }>(page, 'ui_create_folder', { title: 'Work' });
  expect(folder.ok, 'folder is created').toBe(true);
  const folderId = folder.ok ? folder.value.id : '';

  const created = await invoke<{ sessionId: string; leafId: string }>(page, 'session_create', { folderId, cwd: workdir });
  expect(created, 'session_create result').toMatchObject({ ok: true });
  const sessionId = created.ok ? created.value.sessionId : '';

  await expect.poll(() => seenTypes(page), { message: 'SessionStart hook event reaches the renderer' }).toContain('session.hook:SessionStart');
  await invoke(page, 'session_send_text', { sessionId, text: 'hello' });
  await expect.poll(() => seenTypes(page), { message: 'Stop hook event reaches the renderer' }).toContain('session.hook:Stop');
  const output = await invoke<{ data: string }>(page, 'session_read_output', { sessionId });
  expect(output.ok && output.value.data, 'recent output for a reloaded renderer').toContain('echo: hello');

  await page.reload();
  const again = await invoke<{ data: string }>(page, 'session_read_output', { sessionId });
  expect(again.ok && again.value.data, 'output after the renderer reloaded').toContain('echo: hello');

  const closed = await invoke(page, 'session_close', { sessionId });
  expect(closed, 'session_close result').toMatchObject({ ok: true });
  const listed = await invoke<unknown[]>(page, 'session_list', {});
  expect(listed, 'sessions after close').toEqual({ ok: true, value: [] });
});
