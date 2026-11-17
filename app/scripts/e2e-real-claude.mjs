// Real-Claude check of the whole app: launches the built app hidden, starts a Claude session leaf from the tree menu,
// sends a prompt that asks the agent to call the app's ui_create_folder tool, answers the permission prompt in the
// terminal as a user would, and checks that the folder appears in the tree. The permission mode stays `default`.
// Costs a few cents (model haiku, --max-budget-usd 0.25). Not part of `pnpm test` or `pnpm e2e`.
// Usage: pnpm build && node scripts/e2e-real-claude.mjs
import { rmSync } from 'node:fs';
import { answerPermission, LAUNCH_ARGS, launchApp, passTrustDialog, sessionCwd, timeline, transcriptFacts, waitFor } from './lib/realClaude.mjs';

const FOLDER = 'from-session';
const PROMPT = `Use the app MCP server's ui_create_folder tool to create a folder titled "${FOLDER}". Then reply with just: done`;

const log = timeline();
const result = { ok: false, prompt: PROMPT, launchArgs: LAUNCH_ARGS, timeline: log.entries };
const run = await launchApp({ cwd: sessionCwd() });
const { page, invoke } = run;

let sessionId;
try {
  const item = (title) => page.getByRole('treeitem', { name: title, exact: true });

  const folder = await invoke('ui_create_folder', { title: 'Real Claude' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);
  await item('Real Claude').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Claude session', exact: true }).click();
  await item('Claude session').waitFor();
  await page.getByTestId('terminal-pane').waitFor();
  log.mark('session leaf created, terminal open');
  sessionId = (await invoke('session_list', {})).value[0]?.id;

  result.trustPromptShown = await passTrustDialog(run, log, sessionId);

  await invoke('session_send_text', { sessionId, text: PROMPT });
  log.mark('prompt sent');

  const permissions = [];
  const done = await waitFor(log, 'the folder or Stop', async () => {
    await answerPermission(run, log, sessionId, permissions);
    const tree = await invoke('ui_list_tree', {});
    const created = tree.value.nodes.find((node) => node.title === FOLDER);
    const stopped = (await run.seen()).some((e) => e.type === 'session.hook' && e.hookEvent === 'Stop');
    return created || stopped ? { created, stopped } : undefined;
  });
  result.permissions = permissions;
  result.folderInStore = Boolean(done.created);
  if (done.created) {
    log.mark('folder in the tree store');
    result.folderParentIsSessionFolder = done.created.parentId === folder.value.id;
    await item(FOLDER).waitFor({ timeout: 10_000 });
    result.folderVisibleInTree = true;
    log.mark('folder visible in the tree pane');
  }

  const stop = await waitFor(log, 'Stop', async () => (await run.seen()).find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop'));
  log.mark('Stop');
  const events = await run.seen();
  result.hookSequence = events.filter((e) => e.type === 'session.hook').map((e) => e.hookEvent);
  result.statusSequence = events.filter((e) => e.type === 'session.status_changed').map((e) => e.session.status);
  result.lastAssistantMessage = stop.payload.last_assistant_message;

  await invoke('session_close', { sessionId });
  log.mark('session closed');
  sessionId = undefined;
  Object.assign(result, transcriptFacts(stop.payload.transcript_path));
  result.ok = Boolean(result.folderVisibleInTree && result.folderParentIsSessionFolder);
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
