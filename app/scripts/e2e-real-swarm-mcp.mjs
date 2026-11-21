// Real-Claude check of a swarm started over MCP: a session of the app (profile default mode, auto) is asked to call
// swarm_start with a two-agent Haiku swarm. mcp__app__swarm_start is in the app.agent_start class, so the CLI shows a
// permission dialog in the terminal; the script accepts it with Enter as a user would and reports every dialog. The
// app-started cap is set to 1 for the run, so at most the session and one agent run at a time and the second agent
// waits in the queue for the first one's slot. The script reports the agents' states, models, spend and replies,
// the agent nodes and usage of the agents module, and the inbox.
// Costs a few cents (model haiku, --max-budget-usd 0.25 per process). Not part of `pnpm test` or `pnpm e2e`.
// Usage: pnpm build && node scripts/e2e-real-swarm-mcp.mjs
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, passTrustDialog, sessionCwd, timeline, transcriptFacts, waitFor } from './lib/realClaude.mjs';
import { haikuSwarm, swarmReport, waitForSwarmEnd } from './lib/realSwarm.mjs';

const DEFINITION = haikuSwarm('Real swarm over MCP', [
  { name: 'alpha', prompt: 'Reply with the single word ALPHA. Do not use any tools.' },
  { name: 'beta', prompt: 'Reply with the single word BETA. Do not use any tools.' },
]);
const PROMPT = [
  'Call the app MCP server tool swarm_start (mcp__app__swarm_start; use ToolSearch first if it is deferred) with exactly this input:',
  JSON.stringify({ definition: DEFINITION }),
  'Do not call any other swarm tool. Then reply with the swarmId it returned and nothing else.',
].join(' ');

const log = timeline();
const result = { ok: false, prompt: PROMPT, timeline: log.entries };
const cwd = sessionCwd();
// Scratch directories of the agents go below the task base; a temporary one keeps them out of the home directory.
const taskBase = mkdtempSync(join(tmpdir(), 'agide-real-swarm-base-'));
const run = await launchApp({ cwd, env: { AGIDE_TASK_BASE: taskBase } });
const { invoke } = run;
let sessionId;
try {
  const cap = await invoke('agents_settings_set', { maxConcurrentAppStarted: 1 });
  if (!cap.ok) throw new Error(`cap: ${JSON.stringify(cap)}`);
  const folder = await invoke('ui_create_folder', { title: 'Real swarm MCP' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);
  const created = await invoke('session_create', { folderId: folder.value.id, cwd });
  if (!created.ok) throw new Error(`session: ${JSON.stringify(created)}`);
  sessionId = created.value.sessionId;
  result.trustPromptShown = await passTrustDialog(run, log, sessionId);
  result.sessionMode = (await invoke('session_get', { sessionId })).value?.permissionMode;
  await invoke('session_send_text', { sessionId, text: PROMPT });
  log.mark('prompt sent');

  const dialogs = [];
  const stop = await waitFor(log, 'the Stop hook of the session', async () => {
    const events = await run.seen();
    const requests = events.filter((e) => e.type === 'session.hook' && e.hookEvent === 'PermissionRequest');
    if (requests.length > dialogs.length) {
      const request = requests[dialogs.length];
      await waitFor(log, 'permission dialog', async () => /Doyouwantto|proceed/i.test(await run.screenTail(1500)));
      dialogs.push({ tool: request.payload.tool_name, permissionMode: request.payload.permission_mode, screen: (await run.screenTail(600)).slice(-300) });
      await invoke('session_write', { sessionId, data: '\r' });
      log.mark(`dialog for ${request.payload.tool_name} answered with Enter`);
      return undefined;
    }
    return events.find((e) => e.type === 'session.hook' && e.hookEvent === 'Stop');
  });
  result.dialogs = dialogs;
  result.sessionReply = stop.payload?.last_assistant_message;
  const events = await run.seen();
  result.sessionTools = events.filter((e) => e.type === 'session.hook' && e.hookEvent === 'PreToolUse').map((e) => e.payload?.tool_name);
  const transcriptPath = stop.payload?.transcript_path;
  if (transcriptPath) result.session = transcriptFacts(transcriptPath);

  const listed = (await invoke('swarm_list', {})).value?.swarms ?? [];
  if (listed.length !== 1) throw new Error(`expected one swarm, found ${listed.length}`);
  const swarmId = listed[0].id;
  const caller = (await invoke('swarm_status', { swarmId })).value?.callerSessionId;
  result.startedBy = caller === sessionId ? 'the session' : (caller ?? 'the user');
  const peak = { agentsRunning: 0 };
  await waitForSwarmEnd(run, log, swarmId, async () => {
    const status = (await invoke('swarm_status', { swarmId })).value;
    const running = status?.agents.filter((agent) => agent.state === 'running' || agent.state === 'waiting').length ?? 0;
    peak.agentsRunning = Math.max(peak.agentsRunning, running);
  });
  result.peakAgentsRunning = peak.agentsRunning;
  result.swarm = await swarmReport(run, swarmId);
  const texts = result.swarm.agents.map((agent) => (agent.text ?? '').toUpperCase());
  result.ok =
    result.swarm.state === 'done' &&
    texts[0]?.includes('ALPHA') === true &&
    texts[1]?.includes('BETA') === true &&
    result.peakAgentsRunning === 1 &&
    result.swarm.agents.every((agent) => agent.model === 'haiku' || /haiku/.test(agent.model));
  await invoke('session_close', { sessionId });
  sessionId = undefined;
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
  rmSync(taskBase, { recursive: true, force: true });
  for (const entry of readdirSync(cwd)) rmSync(join(cwd, entry), { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
