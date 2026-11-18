// Real-Claude check of milestone 3 in the whole app: a session in the profile default mode (auto) with the launch
// policy (ask rules, inspector hook) and the agide-browser server. The agent reads a local page through the browser
// tools and clicks its button, then is asked to push to a local bare origin. Permission dialogs for the browser
// tools are accepted with Enter; the dialog for the push is refused with Escape, as a user would. The script
// reports every dialog, what reached the page and the origin, the inbox items and the access log.
// Costs a few cents (model haiku, --max-budget-usd 0.25). Not part of `pnpm test` or `pnpm e2e`.
// The fixed working directory gets a git repository for the run and is emptied again at the end.
// Usage: pnpm build && node scripts/e2e-real-claude-m3.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, passTrustDialog, sessionCwd, timeline, transcriptFacts, waitFor } from './lib/realClaude.mjs';

const PAGE = `<!doctype html><html><head><title>Agide check page</title></head><body>
<h1>Agide check page</h1>
<button id="save" onclick="fetch('/clicked');document.getElementById('out').textContent='saved at the button'">Save</button>
<p id="out">not saved yet</p>
</body></html>`;

const PROMPT = [
  'Do these two steps in order.',
  'Step 1: with the agide-browser MCP server tools (tabs_context_mcp, find, computer, get_page_text; use ToolSearch if they are deferred), find the Save button in tab 1, click it, then read the page text and report the paragraph below the button.',
  'Step 2: run exactly this shell command and report its output: git push origin HEAD',
  'Then reply with a one-line summary.',
].join(' ');

const log = timeline();
const result = { ok: false, prompt: PROMPT, timeline: log.entries };

const clicks = [];
const server = createServer((req, res) => {
  if (req.url === '/clicked') clicks.push(new Date().toISOString());
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const cwd = sessionCwd();
const remoteRoot = mkdtempSync(join(tmpdir(), 'agide-real-m3-origin-'));
const bare = join(remoteRoot, 'origin.git');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
git('init', '--bare', '-q', bare);
git('init', '-q', cwd);
for (const [key, value] of [['user.name', 'Agide Check'], ['user.email', 'check@example.invalid'], ['commit.gpgsign', 'false']]) git('-C', cwd, 'config', key, value);
git('-C', cwd, 'remote', 'add', 'origin', bare);
git('-C', cwd, 'commit', '--allow-empty', '-q', '-m', 'init');

const run = await launchApp({ cwd });
const { invoke } = run;
let sessionId;
try {
  const folder = await invoke('ui_create_folder', { title: 'Real Claude m3' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);
  const tab = await invoke('browser_new_tab', { folderId: folder.value.id, url: `${origin}/` });
  if (!tab.ok) throw new Error(`tab: ${JSON.stringify(tab)}`);
  await waitFor(log, 'page title', async () => (await invoke('browser_tab_state', { leafId: tab.value.leafId })).value?.title === 'Agide check page');
  log.mark('tab loaded');

  const created = await invoke('session_create', { folderId: folder.value.id, cwd });
  if (!created.ok) throw new Error(`session: ${JSON.stringify(created)}`);
  sessionId = created.value.sessionId;
  result.trustPromptShown = await passTrustDialog(run, log, sessionId);
  const session = (await invoke('session_get', { sessionId })).value;
  result.launchMode = session.permissionMode;

  await invoke('session_send_text', { sessionId, text: PROMPT });
  log.mark('prompt sent');

  const dialogs = [];
  let refusedPush = false;
  const done = await waitFor(log, 'Stop or the interrupted turn', async () => {
    const requests = (await run.seen()).filter((e) => e.type === 'session.hook' && e.hookEvent === 'PermissionRequest');
    if (requests.length > dialogs.length) {
      const request = requests[dialogs.length];
      await waitFor(log, 'permission dialog', async () => /Doyouwantto|proceed/i.test(await run.screenTail(1500)));
      const command = String(request.payload.tool_input?.command ?? '');
      const isPush = request.payload.tool_name === 'Bash' && /\bpush\b/.test(command);
      dialogs.push({ tool: request.payload.tool_name, command: command || undefined, permissionMode: request.payload.permission_mode, answer: isPush ? 'Escape' : 'Enter', screen: (await run.screenTail(600)).slice(-300) });
      await invoke('session_write', { sessionId, data: isPush ? '\x1b' : '\r' });
      log.mark(`dialog for ${request.payload.tool_name} answered with ${isPush ? 'Escape' : 'Enter'}`);
      if (isPush) refusedPush = true;
      return undefined;
    }
    const stop = (await run.seen()).find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop');
    if (stop) return { stop };
    // Escape interrupts the turn: the TUI asks what to do instead and no Stop hook runs.
    if (refusedPush && /Interrupted/.test(await run.screenTail(1500))) {
      return { interrupted: true, statusAfterRefusal: (await invoke('session_get', { sessionId })).value?.status };
    }
    return undefined;
  });
  result.dialogs = dialogs;
  result.endedBy = done.stop ? 'Stop' : `interrupted by the refused push (session status ${done.statusAfterRefusal})`;
  log.mark(result.endedBy);

  const events = await run.seen();
  result.hookSequence = events.filter((e) => e.type === 'session.hook').map((e) => (e.hookEvent === 'PreToolUse' ? `PreToolUse:${e.payload?.tool_name}` : e.hookEvent));
  result.clicksAtServer = clicks.length;
  result.pageText = (await invoke('surfaces_observe', { nodeId: tab.value.leafId, kind: 'text' })).value;
  result.pushedToOrigin = git('-C', bare, 'rev-list', '--all', '--count') !== '0';
  result.inbox = ((await invoke('inbox_list', { states: ['new', 'seen', 'snoozed', 'done'] })).value?.items ?? []).map((item) => ({ kind: item.kind, origin: item.origin, message: item.message, state: item.state, resolution: item.resolution }));
  result.accessLog = ((await invoke('browser_access_log', { nodeId: tab.value.leafId, limit: 50 })).value?.entries ?? []).map((entry) => ({ kind: entry.kind, origin: entry.origin, outcome: entry.outcome }));
  const transcriptPath = done.stop?.payload?.transcript_path ?? events.find((e) => e.type === 'session.hook' && e.payload?.transcript_path)?.payload.transcript_path;
  if (transcriptPath) Object.assign(result, transcriptFacts(transcriptPath));
  result.lastAssistantMessage = done.stop?.payload?.last_assistant_message;

  await invoke('session_close', { sessionId });
  sessionId = undefined;
  result.ok = result.launchMode === 'auto' && result.clicksAtServer > 0 && !result.pushedToOrigin;
} catch (error) {
  result.error = String(error);
  try {
    result.screenTail = await run.screenTail(1500);
  } catch {
    // The window is gone; there is no screen to report.
  }
} finally {
  result.seconds = log.elapsed();
  await run.app.close();
  server.close();
  rmSync(run.userData, { recursive: true, force: true });
  rmSync(remoteRoot, { recursive: true, force: true });
  for (const entry of readdirSync(cwd)) rmSync(join(cwd, entry), { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
