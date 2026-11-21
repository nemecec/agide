// Real-Claude check of a swarm started from the start dialog: the JSON tab takes a two-agent Haiku swarm, one agent
// in default mode is asked to write a file, so its Write reaches the app as can_use_tool and becomes an inbox item;
// the script opens the inbox, clicks the item and answers Allow on the card, as a user would. The other agent only
// replies. The app-started cap is 2. The script reports the approval card, whether the file was written, the agents'
// states, models, spend and replies, the agent nodes and usage of the agents module, and the inbox.
// Costs a few cents (model haiku, --max-budget-usd 0.25 per process). Not part of `pnpm test` or `pnpm e2e`.
// Usage: pnpm build && node scripts/e2e-real-swarm-dialog.mjs
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, sessionCwd, timeline } from './lib/realClaude.mjs';
import { haikuSwarm, swarmReport, useTreeAndInboxLayout, waitForSwarmEnd } from './lib/realSwarm.mjs';

const DEFINITION = haikuSwarm('Real swarm from the dialog', [
  { name: 'writer', permissionMode: 'default', prompt: 'Use the Write tool to create the file note.txt in the current working directory with the content hello. Then reply with the single word WRITTEN.' },
  { name: 'reader', prompt: 'Reply with the single word READY. Do not use any tools.' },
]);

const log = timeline();
const result = { ok: false, definition: DEFINITION, timeline: log.entries };
const cwd = sessionCwd();
// Scratch directories of the agents go below the task base; a temporary one keeps them out of the home directory.
const taskBase = mkdtempSync(join(tmpdir(), 'agide-real-swarm-base-'));
const run = await launchApp({ cwd, env: { AGIDE_TASK_BASE: taskBase } });
const { invoke, page } = run;
try {
  const cap = await invoke('agents_settings_set', { maxConcurrentAppStarted: 2 });
  if (!cap.ok) throw new Error(`cap: ${JSON.stringify(cap)}`);
  await useTreeAndInboxLayout(run);
  const folder = await invoke('ui_create_folder', { title: 'Real swarm dialog' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);

  await page.getByRole('treeitem', { name: 'Real swarm dialog', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New swarm…', exact: true }).click();
  await page.getByTestId('swarm-tab-json').click();
  await page.getByTestId('swarm-json').fill(JSON.stringify(DEFINITION));
  await page.getByTestId('swarm-start').click();
  await page.getByTestId('start-swarm-dialog').waitFor({ state: 'hidden' });
  log.mark('started from the dialog');
  const swarmId = (await invoke('swarm_list', {})).value.swarms[0].id;

  const approvals = [];
  const peak = { agentsRunning: 0 };
  await waitForSwarmEnd(run, log, swarmId, async () => {
    const status = (await invoke('swarm_status', { swarmId })).value;
    const running = status?.agents.filter((agent) => agent.state === 'running' || agent.state === 'waiting').length ?? 0;
    peak.agentsRunning = Math.max(peak.agentsRunning, running);
    const open = ((await invoke('inbox_list', {})).value?.items ?? []).filter((item) => item.origin === 'swarm:can_use_tool' && item.state !== 'done');
    if (open.length === 0) return;
    await page.getByRole('tab', { name: 'Inbox' }).click();
    await page.getByTestId('inbox-row').first().click();
    const card = { message: await page.getByTestId('inbox-message').textContent(), meta: await page.getByTestId('swarm-approval-meta').textContent() };
    await page.getByTestId('swarm-approval-allow').click();
    approvals.push(card);
    log.mark(`approval answered Allow on the card: ${card.message}`);
    await page.getByRole('tab', { name: 'Inbox' }).waitFor();
  });
  result.approvals = approvals;
  result.peakAgentsRunning = peak.agentsRunning;
  const writerCwd = (await invoke('swarm_status', { swarmId })).value.agents.find((agent) => agent.name === 'writer')?.cwd;
  const note = writerCwd === undefined ? undefined : join(writerCwd, 'note.txt');
  result.fileWritten = note !== undefined && existsSync(note) ? readFileSync(note, 'utf8') : false;
  result.swarm = await swarmReport(run, swarmId);
  const texts = Object.fromEntries(result.swarm.agents.map((agent) => [agent.name, (agent.text ?? '').toUpperCase()]));
  result.ok =
    result.swarm.state === 'done' &&
    approvals.length >= 1 &&
    typeof result.fileWritten === 'string' &&
    texts.writer?.includes('WRITTEN') === true &&
    texts.reader?.includes('READY') === true &&
    result.peakAgentsRunning <= 2;
} catch (error) {
  result.error = String(error);
} finally {
  result.seconds = log.elapsed();
  await run.app.close();
  rmSync(run.userData, { recursive: true, force: true });
  rmSync(taskBase, { recursive: true, force: true });
  for (const entry of readdirSync(cwd)) rmSync(join(cwd, entry), { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
