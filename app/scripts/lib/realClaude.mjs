// Shared parts of the real-Claude scripts: the scrubbed environment, the fixed working directory, the built app
// launched hidden, reading the terminal, the folder-trust dialog and the permission dialog.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';

export const LAUNCH_ARGS = ['--model', 'haiku', '--max-budget-usd', '0.25', '--strict-mcp-config'];
export const TIMEOUT_MS = 180_000;

const appRoot = new URL('../..', import.meta.url).pathname;

// Variables that an enclosing Claude Code session injects are removed; CLAUDE_CONFIG_DIR stays: it selects the login.
export function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_JOB_DIR|CLAUDE_PID|CLAUDE_AGENTS_.*|CLAUDE_EFFORT|AI_AGENT)$/.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}

// The same fixed empty directory as scripts/smoke-real-claude.mjs: the CLI stores its trust answer per path in the
// user's Claude config, so a new directory on every run would add an entry each time.
export function sessionCwd() {
  const path = join(tmpdir(), 'agide-smoke-cwd');
  mkdirSync(path, { recursive: true });
  const cwd = realpathSync(path);
  if (readdirSync(cwd).length > 0) throw new Error(`${cwd} must be empty`);
  return cwd;
}

// Removes escape sequences; the TUI moves the cursor in place of spaces, so whitespace is dropped as well.
export const plain = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '').replace(/\s+/g, '');

/** A run log: seconds since start and what happened. */
export function timeline() {
  const started = Date.now();
  const entries = [];
  const elapsed = () => Math.round((Date.now() - started) / 100) / 10;
  return {
    entries,
    elapsed,
    expired: () => Date.now() - started > TIMEOUT_MS,
    mark: (what) => entries.push({ s: elapsed(), what }),
  };
}

/** Launches the built app hidden with a temporary data directory and records bus events and terminal output in the page. `env` adds variables. */
export async function launchApp({ cwd, env = {} }) {
  const userData = mkdtempSync(join(tmpdir(), 'agide-real-e2e-'));
  const app = await electron.launch({
    args: [join(appRoot, 'out', 'main', 'index.js')],
    env: cleanEnv({ AGIDE_HIDDEN: '1', AGIDE_USER_DATA: userData, AGIDE_SESSION_CWD: cwd, AGIDE_CLAUDE_ARGS: JSON.stringify(LAUNCH_ARGS), ...env }),
  });
  const page = await app.firstWindow();
  await page.evaluate(() => {
    window.seen = [];
    window.screen = '';
    window.api.subscribe((event) => {
      if (event.type === 'session.output') window.screen += event.data;
      else window.seen.push(event);
    });
  });
  return {
    app,
    page,
    userData,
    invoke: (id, input) => page.evaluate(([commandId, payload]) => window.api.invoke(commandId, payload), [id, input]),
    seen: () => page.evaluate(() => window.seen),
    screenTail: async (chars) => plain(await page.evaluate(() => window.screen)).slice(-chars),
  };
}

export async function waitFor(log, what, probe) {
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (log.expired()) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The option the trust dialog highlights in its latest frame: the text after the last selection marker. */
function trustSelection(screen) {
  const dialog = screen.slice(Math.max(0, screen.lastIndexOf('Quicksafetycheck')));
  const marker = Math.max(dialog.lastIndexOf('❯'), dialog.lastIndexOf('›'));
  if (marker < 0) return undefined;
  const after = dialog.slice(marker + 1).replace(/^\d\./, '');
  if (after.startsWith('Yes,Itrustthisfolder')) return 'yes';
  if (after.startsWith('No,exit')) return 'no';
  return undefined;
}

/**
 * Waits for SessionStart and answers the folder-trust dialog on the way. The dialog lists "No, exit" first and
 * highlights it, and the terminal's own replies to the CLI's queries can arrive while the dialog is open, so the
 * answer moves the selection, waits until the latest frame has shown "Yes, I trust this folder" highlighted on two
 * reads in a row, and only then presses Enter. Returns whether the dialog was shown.
 */
export async function passTrustDialog(run, log, sessionId) {
  let shown = false;
  let answered = false;
  let moves = 0;
  let yesReads = 0;
  await waitFor(log, 'SessionStart', async () => {
    const screen = await run.screenTail(3000);
    if (!answered && /Itrustthisfolder/.test(screen)) {
      if (!shown) log.mark('trust dialog shown');
      shown = true;
      const selected = trustSelection(screen);
      if (selected === 'yes') yesReads += 1;
      else yesReads = 0;
      if (yesReads >= 2) {
        await run.invoke('session_write', { sessionId, data: '\r' });
        answered = true;
        log.mark(`trust dialog answered with Enter on "Yes, I trust this folder" after ${moves} moves`);
      } else if (selected !== 'yes') {
        if (moves >= 6) throw new Error(`the trust dialog does not keep "Yes" selected: ${screen.slice(-400)}`);
        moves += 1;
        await run.invoke('session_write', { sessionId, data: '\x1b[B' });
        await sleep(500);
      } else {
        await sleep(500);
      }
    }
    return (await run.seen()).some((e) => e.type === 'session.hook' && e.hookEvent === 'SessionStart');
  });
  log.mark('SessionStart');
  return shown;
}

/**
 * Answers the next unanswered permission dialog with Enter in the terminal, as a user who accepts the highlighted
 * "Yes" would, and returns what the dialog showed. Returns undefined when no new PermissionRequest has fired.
 */
export async function answerPermission(run, log, sessionId, answered) {
  const requests = (await run.seen()).filter((e) => e.type === 'session.hook' && e.hookEvent === 'PermissionRequest');
  if (requests.length <= answered.length) return undefined;
  const request = requests[answered.length];
  // The dialog draws after the hook fires; the screen is read once it shows the question.
  await waitFor(log, 'permission dialog', async () => /Doyouwantto|proceed/i.test(await run.screenTail(1500)));
  const screen = await run.screenTail(1500);
  const status = (await run.invoke('session_get', { sessionId })).value?.status;
  const entry = { tool: request.payload.tool_name, permissionMode: request.payload.permission_mode, statusWhileOpen: status, screen };
  answered.push(entry);
  log.mark(`permission dialog for ${entry.tool}; session status ${status}`);
  await run.page.getByTestId('terminal-host').first().click();
  await run.page.keyboard.press('Enter');
  log.mark('permission answered with Enter in the terminal');
  return entry;
}

/** Tool calls, model and cost from the session transcript. */
export function transcriptFacts(path) {
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return {
    toolCalls: rows
      .flatMap((row) => (Array.isArray(row.message?.content) ? row.message.content : []))
      .filter((part) => part.type === 'tool_use')
      .map((part) => part.name),
    model: rows.map((row) => row.message?.model).filter(Boolean).at(-1),
    totalCostUSD: rows.filter((row) => row.type === 'cost-state').at(-1)?.totalCostUSD,
  };
}
