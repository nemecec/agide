// Launching the built app, running its commands and writing screenshots for the visual check.
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron } from '@playwright/test';

const run = promisify(execFile);
const APP_DIR = fileURLToPath(new URL('../../..', import.meta.url));
export const MAIN = join(APP_DIR, 'out', 'main', 'index.js');
export const FAKE_CLAUDE = fileURLToPath(new URL('./fakeClaude.mjs', import.meta.url));
const FAKE_GH = join(APP_DIR, 'src', 'core', 'tasks', 'fixtures', 'fake-gh.mjs');

export const DEFAULT_SIZE = { width: 1440, height: 900 };
export const NARROW_SIZE = { width: 900, height: 900 };
export const WIDE_SIZE = { width: 1920, height: 1080 };

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh run below `parent`: one directory for the screenshots and one for the data of the app instances. */
export function createRun(parent = tmpdir(), prefix = 'agide-visual-') {
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, prefix));
  const shots = join(dir, 'shots');
  const data = join(dir, 'data');
  mkdirSync(shots);
  mkdirSync(data);
  const sources = {};
  const notes = [];
  return {
    dir,
    shots,
    data,
    sources,
    notes,
    note: (text) => {
      notes.push(text);
      console.log(`note: ${text}`);
    },
    cleanup: () => rmSync(data, { recursive: true, force: true }),
  };
}

/** A directory with an executable `gh` backed by the fake and the variables that drive it. */
export function installFakeGh(runDir, pr) {
  const dir = join(runDir, 'gh');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(FAKE_GH, join(dir, 'bin', 'gh'));
  chmodSync(join(dir, 'bin', 'gh'), 0o755);
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(pr));
  return { path: `${join(dir, 'bin')}${delimiter}${process.env.PATH ?? ''}`, env: { FAKE_GH_PR: join(dir, 'pr.json'), FAKE_GH_RECORD: join(dir, 'calls.jsonl') } };
}

export const samplePullRequest = {
  number: 7,
  title: 'Fix the retry in the uploader',
  url: 'https://github.com/example-org/sample-app/pull/7',
  state: 'OPEN',
  author: { login: 'octocat' },
  headRefName: 'fix-retry',
  baseRefName: 'main',
  isCrossRepository: false,
  headRepositoryOwner: { login: 'example-org' },
  body: 'Retries the upload three times.',
  files: [{ path: 'src/upload.ts' }, { path: 'README.md' }],
};

/** A tiny HTTP server with a generic page, for browser tabs. */
export async function startPageServer() {
  const page = `<!doctype html><html><head><title>Sample page</title><style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f6f8;color:#1b2430}
header{background:#2f5d8a;color:#fff;padding:20px 32px}main{padding:24px 32px;max-width:720px}
.card{background:#fff;border:1px solid #d5dbe2;border-radius:8px;padding:16px;margin-bottom:16px}
button{padding:8px 14px;border-radius:6px;border:1px solid #2f5d8a;background:#2f5d8a;color:#fff}
</style></head><body><header><h1>Sample dashboard</h1><p>Generic content served locally</p></header>
<main><div class="card"><h2>Status</h2><p>All sample services are running.</p><button>Refresh</button></div>
<div class="card"><h2>Notes</h2><p>This page exists only to give the browser tab something to show.</p></div></main></body></html>`;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Launches the built app. `visible` shows the window; otherwise AGIDE_HIDDEN keeps it off the screen. */
export async function startApp(context, options) {
  const { name, visible = false, root, userData, profile, env = {}, size = DEFAULT_SIZE } = options;
  const dataDir = join(context.run.data, name);
  mkdirSync(dataDir, { recursive: true });
  const work = join(dataDir, 'work');
  const claudeConfig = join(dataDir, 'claude-config');
  mkdirSync(work, { recursive: true });
  mkdirSync(claudeConfig, { recursive: true });
  const userDataDir = userData ?? join(dataDir, 'user');
  const layoutsDir = root ? join(root, 'profiles', profile ?? 'default', 'data', 'layouts') : join(userDataDir, 'layouts');
  const launchEnv = {
    ...process.env,
    ...(visible && !context.forceHidden ? {} : { AGIDE_HIDDEN: '1' }),
    ...(root ? { AGIDE_ROOT: root } : { AGIDE_USER_DATA: userDataDir }),
    AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
    AGIDE_SESSION_CWD: work,
    AGIDE_TASK_BASE: join(dataDir, 'tasks'),
    CLAUDE_CONFIG_DIR: claudeConfig,
    FAKE_CLAUDE_ROOT: claudeConfig,
    FAKE_CLAUDE_RECORD: join(dataDir, 'launches.jsonl'),
    ...env,
  };
  delete launchEnv.CLAUDECODE;
  const app = await electron.launch({ args: [MAIN, ...(profile ? [`--profile=${profile}`] : [])], env: launchEnv });
  const page = await app.firstWindow();
  await page.getByRole('tree', { name: 'Task tree' }).waitFor({ state: 'visible', timeout: 30_000 });
  const instance = { name, app, page, dataDir, layoutsDir, work, claudeConfig, launches: join(dataDir, 'launches.jsonl'), visible: visible && !context.forceHidden, size };
  await resize(instance, size);
  return instance;
}

export async function closeApp(instance) {
  await Promise.allSettled((instance.clients ?? []).splice(0).map((client) => client.close()));
  await instance.app.close().catch(() => undefined);
}

export async function resize(instance, size) {
  await instance.app.evaluate(({ BrowserWindow }, { width, height }) => {
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() !== '');
    if (!window) return;
    window.setContentSize(width, height);
    window.center();
  }, size);
  await sleep(500);
}

export async function invoke(instance, id, input = {}) {
  return instance.page.evaluate(([commandId, args]) => globalThis.api.invoke(commandId, args), [id, input]);
}

export async function value(instance, id, input = {}) {
  const result = await invoke(instance, id, input);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value;
}

/** The id of the native window for `screencapture -l`, from the window's media source id. */
async function windowId(instance) {
  const source = await instance.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
    return window ? window.getMediaSourceId() : undefined;
  });
  const match = /^window:(\d+):/.exec(source ?? '');
  return match ? match[1] : undefined;
}

/**
 * Writes `<name>.png` from the app's own window capture (native views composed) and, for a visible window, the
 * macOS screen capture of the window as `<name>.screen.png` when `screen` is set. Falls back to the page
 * screenshot when the app capture fails.
 */
export async function shoot(context, instance, name, { screen = false, pageShot = false } = {}) {
  const base = join(context.run.shots, name);
  const sources = (context.run.sources[name] ??= []);
  await sleep(350);
  const captured = await invoke(instance, 'ui_capture_window', {}).catch((error) => ({ ok: false, error: { message: String(error) } }));
  const image = captured.ok ? captured.value : undefined;
  if (image && image.data) {
    writeFileSync(`${base}.png`, Buffer.from(image.data, 'base64'));
    sources.push('ui_capture_window');
  } else {
    await instance.page.screenshot({ path: `${base}.png` });
    sources.push('page.screenshot');
    context.run.note(`${name}: ui_capture_window failed (${captured.error?.message ?? 'no data'}); used page.screenshot`);
  }
  if (pageShot) {
    await instance.page.screenshot({ path: `${base}.page.png` });
    sources.push('page.screenshot');
  }
  if (screen && instance.visible && !context.run.screenBlocked) {
    try {
      const id = await windowId(instance);
      if (!id) throw new Error('no window id');
      await run('/usr/sbin/screencapture', ['-x', '-o', `-l${id}`, `${base}.screen.png`], { timeout: 15_000 });
      sources.push('screencapture');
    } catch (error) {
      context.run.screenBlocked = true;
      context.run.note(`${name}: screencapture failed (${String(error.stderr ?? error.message ?? error).trim().split('\n')[0]}); later states skip it`);
    }
  }
  console.log(`shot ${name}`);
}

/** Right-click at a position of the tree pane or on a named row, then a menu entry. */
export async function menu(instance, target, entry) {
  if (typeof target === 'string') await instance.page.getByRole('treeitem', { name: target, exact: true }).click({ button: 'right' });
  else await instance.page.getByTestId('tree-pane').click({ button: 'right', position: target });
  if (entry) await instance.page.getByRole('menuitem', { name: entry, exact: true }).click();
}

export async function createFolder(instance, title, parentId) {
  const folder = await value(instance, 'ui_create_folder', { title, ...(parentId ? { parentId } : {}) });
  return folder.id;
}

export async function expandAll(instance) {
  for (let pass = 0; pass < 6; pass++) {
    const collapsed = instance.page.locator('[role=treeitem][aria-expanded=false]');
    const count = await collapsed.count();
    if (count === 0) return;
    for (let index = count - 1; index >= 0; index--) await collapsed.nth(index).dblclick().catch(() => undefined);
    await sleep(200);
  }
}

export async function startSession(instance, folderId, title) {
  const { sessionId } = await value(instance, 'session_create', { folderId, cwd: instance.work, ...(title ? { title } : {}) });
  for (let i = 0; i < 100; i++) {
    const got = await invoke(instance, 'session_get', { sessionId });
    if (got.ok && got.value.status === 'idle') return sessionId;
    await sleep(150);
  }
  throw new Error(`session ${sessionId} did not become idle`);
}

export const type = (instance, sessionId, text) => invoke(instance, 'session_send_text', { sessionId, text });

/** Writes a layout of the session preset with extra panes next to the main surface. */
export function writeLayout(instance, id, extra) {
  const pane = (kind) => ({ type: kind, version: '^1', configVersion: 1, config: {} });
  const instances = { rail: pane('agide/profile-rail'), tree: pane('agide/tree'), main: { ...pane('agide/surface-host'), config: { emptyText: 'Open a session or tab from the tree' }, bindings: { node: { context: 'node.current' } } }, inbox: pane('agide/inbox') };
  for (const [key, kind] of Object.entries(extra.panes)) instances[key] = pane(kind);
  mkdirSync(instance.layoutsDir, { recursive: true });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id,
    title: id,
    instances,
    arrangement: { split: 'row', children: [{ size: 0.2, tabs: { panes: ['rail'], active: 'rail' } }, { size: 1.4, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3, tabs: { panes: extra.tabs, active: extra.active } }] },
  };
  writeFileSync(join(instance.layoutsDir, `${id}.json`), JSON.stringify(document));
}
