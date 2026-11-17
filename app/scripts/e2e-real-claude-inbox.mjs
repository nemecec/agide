// Real-Claude check of the inbox: launches the built app hidden, starts a Claude session in a folder, asks the
// agent to call the app's inbox_post tool, answers the permission dialog in the terminal as a user would, and checks
// that the item appears in the inbox pane of the layout. The permission mode stays the app default (no bypass).
// Costs a few cents (model haiku, --max-budget-usd 0.25). Not part of `pnpm test` or `pnpm e2e`.
// Usage: pnpm build && node scripts/e2e-real-claude-inbox.mjs
import { existsSync, rmSync, statSync } from 'node:fs';
import { answerPermission, LAUNCH_ARGS, launchApp, passTrustDialog, sessionCwd, timeline, transcriptFacts, waitFor } from './lib/realClaude.mjs';

const MESSAGE = 'Build is green';
const PROMPT = `Use the app MCP server's inbox_post tool to post the message "${MESSAGE}" to the inbox. Then reply with just: done`;

const log = timeline();
const result = { ok: false, prompt: PROMPT, launchArgs: LAUNCH_ARGS, timeline: log.entries };
const run = await launchApp({ cwd: sessionCwd() });
const { page, invoke } = run;

let sessionId;
try {
  await page.getByRole('tree', { name: 'Task tree' }).waitFor();
  const folder = await invoke('ui_create_folder', { title: 'Inbox check' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);
  const created = await invoke('session_create', { folderId: folder.value.id });
  if (!created.ok) throw new Error(`session: ${JSON.stringify(created)}`);
  sessionId = created.value.sessionId;
  await invoke('ui_focus_node', { nodeId: created.value.leafId });
  await page.getByTestId('terminal-pane').waitFor();
  log.mark('session started, terminal open');

  // The app removes the config file on the first SessionStart, so its mode is read right after the launch.
  const mcpConfig = `${run.userData}/sessions/${sessionId}/mcp.json`;
  const stat = statSync(mcpConfig, { throwIfNoEntry: false });
  result.mcpConfigFileMode = stat === undefined ? 'removed before the read' : (stat.mode & 0o777).toString(8);

  const launch = (await invoke('session_get', { sessionId })).value;
  result.permissionMode = launch.permissionMode;
  result.trustDialogShown = await passTrustDialog(run, log, sessionId);

  await invoke('session_send_text', { sessionId, text: PROMPT });
  log.mark('prompt sent');

  const permissions = [];
  const itemRow = () => page.getByTestId('inbox-row').filter({ hasText: MESSAGE });
  await waitFor(log, 'the inbox item or Stop', async () => {
    await answerPermission(run, log, sessionId, permissions);
    const items = await invoke('inbox_list', {});
    const posted = items.ok && items.value.items.find((item) => item.message === MESSAGE);
    const stopped = (await run.seen()).some((e) => e.type === 'session.hook' && e.hookEvent === 'Stop');
    if (posted) result.item = { kind: posted.kind, origin: posted.origin, folderIsSessionFolder: posted.folderId === folder.value.id, sessionId: posted.sessionId === sessionId };
    return posted || stopped;
  });
  result.permissions = permissions;

  if (result.item) {
    log.mark('item in the inbox store');
    await page.locator('.pane-tab', { hasText: /^inbox$/ }).click();
    await itemRow().waitFor({ timeout: 10_000 });
    result.itemVisibleInInboxPane = true;
    result.unreadText = await page.getByTestId('inbox-unread').textContent();
    log.mark('item visible in the inbox pane');
  }

  const stop = await waitFor(log, 'Stop', async () => (await run.seen()).find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop'));
  log.mark('Stop');
  const events = await run.seen();
  result.hookSequence = events.filter((e) => e.type === 'session.hook').map((e) => e.hookEvent);
  result.statusSequence = events.filter((e) => e.type === 'session.status_changed').map((e) => e.session.status);
  result.lastAssistantMessage = stop.payload.last_assistant_message;
  result.mcpConfigRemovedAfterStart = !existsSync(mcpConfig);

  await invoke('session_close', { sessionId });
  log.mark('session closed');
  sessionId = undefined;
  Object.assign(result, transcriptFacts(stop.payload.transcript_path));
  result.ok = Boolean(result.itemVisibleInInboxPane && result.item?.folderIsSessionFolder);
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
  rmSync(run.userData, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
