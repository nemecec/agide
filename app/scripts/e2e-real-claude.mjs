// Real-Claude check of the whole app: launches the built app hidden, starts a Claude session leaf from the tree menu,
// sends a prompt that asks the agent to call the app's ui_create_folder tool, answers the permission prompt in the
// terminal as a user would, and checks that the folder appears in the tree. The permission mode stays `default`.
// Costs a few cents (model haiku, --max-budget-usd 0.25). Not part of `pnpm test` or `pnpm e2e`.
// Usage: pnpm build && node scripts/e2e-real-claude.mjs
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';

const TIMEOUT_MS = 180_000;
const FOLDER = 'from-session';
const PROMPT = `Use the app MCP server's ui_create_folder tool to create a folder titled "${FOLDER}". Then reply with just: done`;
const LAUNCH_ARGS = ['--model', 'haiku', '--max-budget-usd', '0.25', '--strict-mcp-config'];

const root = new URL('..', import.meta.url).pathname;

// Variables that an enclosing Claude Code session injects are removed; CLAUDE_CONFIG_DIR stays: it selects the login.
function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|CLAUDE_PID|CLAUDE_AGENTS_.*|CLAUDE_EFFORT|AI_AGENT)$/.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}

// The same fixed empty directory as scripts/smoke-real-claude.mjs: the CLI stores its trust answer per path in the
// user's Claude config, so a new directory on every run would add an entry each time.
const cwdPath = join(tmpdir(), 'agide-smoke-cwd');
mkdirSync(cwdPath, { recursive: true });
const cwd = realpathSync(cwdPath);
if (readdirSync(cwd).length > 0) throw new Error(`${cwd} must be empty`);
const userData = mkdtempSync(join(tmpdir(), 'agide-real-e2e-'));

// Removes escape sequences; the TUI moves the cursor in place of spaces, so whitespace is dropped as well.
const plain = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '').replace(/\s+/g, '');

const started = Date.now();
const elapsed = () => Math.round((Date.now() - started) / 100) / 10;
const result = { ok: false, prompt: PROMPT, launchArgs: LAUNCH_ARGS, timeline: [] };
const mark = (what) => result.timeline.push({ s: elapsed(), what });

const app = await electron.launch({
  args: [join(root, 'out', 'main', 'index.js')],
  env: cleanEnv({
    AGIDE_HIDDEN: '1',
    AGIDE_USER_DATA: userData,
    AGIDE_SESSION_CWD: cwd,
    AGIDE_CLAUDE_ARGS: JSON.stringify(LAUNCH_ARGS),
  }),
});

let sessionId;
try {
  const page = await app.firstWindow();
  const invoke = (id, input) => page.evaluate(([commandId, payload]) => window.api.invoke(commandId, payload), [id, input]);
  await page.evaluate(() => {
    window.seen = [];
    window.screen = '';
    window.api.subscribe((event) => {
      if (event.type === 'session.output') window.screen += event.data;
      else window.seen.push(event);
    });
  });
  const seen = () => page.evaluate(() => window.seen);
  const screenTail = async (chars) => plain(await page.evaluate(() => window.screen)).slice(-chars);
  const waitFor = async (what, probe) => {
    for (;;) {
      const value = await probe();
      if (value) return value;
      if (Date.now() - started > TIMEOUT_MS) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  const item = (title) => page.getByRole('treeitem', { name: title, exact: true });

  const folder = await invoke('ui_create_folder', { title: 'Real Claude' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);
  await item('Real Claude').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Claude session', exact: true }).click();
  await item('Claude session').waitFor();
  await page.getByTestId('terminal-pane').waitFor();
  mark('session leaf created, terminal open');
  sessionId = (await invoke('session_list', {})).value[0]?.id;

  let trustAnswered = false;
  await waitFor('SessionStart', async () => {
    if (!trustAnswered && /Yes,Itrustthisfolder/.test(await screenTail(4000))) {
      trustAnswered = true;
      mark('trust prompt shown, answered in the terminal');
      await invoke('session_write', { sessionId, data: '\x1b[B' });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await invoke('session_write', { sessionId, data: '\r' });
    }
    return (await seen()).some((e) => e.type === 'session.hook' && e.hookEvent === 'SessionStart');
  });
  mark('SessionStart');
  result.trustPromptShown = trustAnswered;

  await invoke('session_send_text', { sessionId, text: PROMPT });
  mark('prompt sent');

  const permissions = [];
  const done = await waitFor('the folder or Stop', async () => {
    const events = await seen();
    const requests = events.filter((e) => e.type === 'session.hook' && e.hookEvent === 'PermissionRequest');
    if (requests.length > permissions.length) {
      const request = requests[permissions.length];
      // The dialog draws after the hook fires; the screen is read once it shows the question.
      await waitFor('permission dialog', async () => /Doyouwantto|Allow|proceed/i.test(await screenTail(1500)));
      const screen = await screenTail(1500);
      permissions.push({ tool: request.payload.tool_name, permissionMode: request.payload.permission_mode, screen });
      mark(`permission prompt for ${request.payload.tool_name}; status ${(await invoke('session_get', { sessionId })).value?.status}`);
      await page.getByTestId('terminal-host').click();
      await page.keyboard.press('Enter');
      mark('permission answered with Enter in the terminal');
    }
    const tree = await invoke('ui_list_tree', {});
    const created = tree.value.nodes.find((node) => node.title === FOLDER);
    const stopped = events.some((e) => e.type === 'session.hook' && e.hookEvent === 'Stop');
    return created || stopped ? { created, stopped } : undefined;
  });
  result.permissions = permissions;
  result.folderInStore = Boolean(done.created);
  if (done.created) {
    mark('folder in the tree store');
    result.folderParentIsSessionFolder = done.created.parentId === folder.value.id;
    await item(FOLDER).waitFor({ timeout: 10_000 });
    result.folderVisibleInTree = true;
    mark('folder visible in the tree pane');
  }

  const stop = await waitFor('Stop', async () => (await seen()).find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop'));
  mark('Stop');
  const events = await seen();
  result.hookSequence = events.filter((e) => e.type === 'session.hook').map((e) => e.hookEvent);
  result.statusSequence = events.filter((e) => e.type === 'session.status_changed').map((e) => e.session.status);
  result.lastAssistantMessage = stop.payload.last_assistant_message;

  await invoke('session_close', { sessionId });
  mark('session closed');
  sessionId = undefined;
  const rows = readFileSync(stop.payload.transcript_path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  result.toolCalls = rows
    .flatMap((row) => (Array.isArray(row.message?.content) ? row.message.content : []))
    .filter((part) => part.type === 'tool_use')
    .map((part) => part.name);
  result.model = rows.map((row) => row.message?.model).filter(Boolean).at(-1);
  result.totalCostUSD = rows.filter((row) => row.type === 'cost-state').at(-1)?.totalCostUSD;
  result.ok = Boolean(result.folderVisibleInTree && result.folderParentIsSessionFolder);
} catch (error) {
  result.error = String(error);
  try {
    const page = await app.firstWindow();
    result.screenTail = plain(await page.evaluate(() => window.screen)).slice(-1500);
  } catch {
    // The window is gone; there is no screen to report.
  }
} finally {
  result.seconds = elapsed();
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
