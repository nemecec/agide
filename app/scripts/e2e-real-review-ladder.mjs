// Real-Claude check of the review ladder: a swarm with one Haiku worktree agent is started from the start dialog in a
// temporary git repository. The agent writes a file with a planted problem; at its end the app captures the
// worktree, runs the rules, and starts a rung B reviewer (Haiku) on the swarm runtime in a read-only checkout, which
// reports through report_review. The repository's review policy sets retryLimit 0, so a revise goes to a person and
// the agent does not run again. The script answers any approval card with Allow and reports every one, and reports
// the changeset, its reasons, the reviewer's report, the runs and their cost, the inbox and the merge gate.
// Costs a few cents (model haiku, --max-budget-usd 0.25 per process, at most two processes). Not part of `pnpm test`
// or `pnpm e2e`.
// Usage: pnpm build && node scripts/e2e-real-review-ladder.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, sessionCwd, timeline, waitFor } from './lib/realClaude.mjs';
import { useTreeAndInboxLayout, waitForSwarmEnd } from './lib/realSwarm.mjs';

const IDENTITY = { GIT_AUTHOR_NAME: 'Agide test', GIT_AUTHOR_EMAIL: 'test.invalid', GIT_COMMITTER_NAME: 'Agide test', GIT_COMMITTER_EMAIL: 'test.invalid' };
const HAIKU = { model: 'haiku', effort: 'low' };

const log = timeline();
const result = { ok: false, timeline: log.entries };
const cwd = sessionCwd();
const scratch = mkdtempSync(join(tmpdir(), 'agide-real-review-'));
const repo = join(scratch, 'repo');
const taskBase = join(scratch, 'agide');
mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...IDENTITY }, encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'price.ts'), 'export const price = (base: number): number => base;\n');
mkdirSync(join(repo, '.agide'));
// retryLimit 0: a revise goes to a person, so the worker never runs a second time.
writeFileSync(join(repo, '.agide', 'review-policy.json'), `${JSON.stringify({ version: 1, retryLimit: 0 })}\n`);
git('add', '-A');
git('commit', '-q', '-m', 'base');

const DEFINITION = {
  version: 1,
  goal: 'Add a ten percent discount',
  maxTier: 'small',
  repository: { path: repo, base: 'main' },
  budget: { usdTotal: 0.5, usdPerAgent: 0.25, maxTurnsPerMessage: 6, wallClockMinutes: 5 },
  agents: [
    {
      name: 'worker',
      role: 'mechanical',
      workspace: 'worktree',
      permissionMode: 'acceptEdits',
      prompt:
        'Create the file discount.ts in the current working directory with exactly this one line: export const discount = (p: number): number => p * 2; Use the Write tool. Do not run any command. Then reply with the single sentence: I added a ten percent discount.',
    },
  ],
};
result.definition = DEFINITION;

// A profile root of its own makes the profile settings a file the script can change.
const profileRoot = join(scratch, 'root');
const run = await launchApp({ cwd, env: { AGIDE_TASK_BASE: taskBase, AGIDE_ROOT: profileRoot } });
const { invoke, page } = run;
// The app's warnings about the review, for the report.
const appLog = [];
for (const stream of [run.app.process().stdout, run.app.process().stderr]) stream?.on('data', (chunk) => appLog.push(...String(chunk).split('\n').filter((line) => /review/i.test(line))));
try {
  // Every tier is Haiku for this run, so the reviewer (tier strong by default) runs on Haiku too.
  const settingsFile = join(profileRoot, 'profiles', 'default', 'settings.json');
  await waitFor(log, 'the profile settings file', async () => {
    try {
      return readFileSync(settingsFile, 'utf8');
    } catch {
      return undefined;
    }
  });
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  writeFileSync(settingsFile, JSON.stringify({ ...settings, swarm: { ...(settings.swarm ?? {}), tiers: { strong: HAIKU, mid: HAIKU, small: HAIKU } } }, null, 2));
  const cap = await invoke('agents_settings_set', { maxConcurrentAppStarted: 2 });
  if (!cap.ok) throw new Error(`cap: ${JSON.stringify(cap)}`);
  await useTreeAndInboxLayout(run, join(profileRoot, 'profiles', 'default', 'data'));
  const folder = await invoke('ui_create_folder', { title: 'Real review' });
  if (!folder.ok) throw new Error(`folder: ${JSON.stringify(folder)}`);

  await page.getByRole('treeitem', { name: 'Real review', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New swarm…', exact: true }).click();
  await page.getByTestId('swarm-tab-json').click();
  await page.getByTestId('swarm-json').fill(JSON.stringify(DEFINITION));
  await page.getByTestId('swarm-start').click();
  await page.getByTestId('start-swarm-dialog').waitFor({ state: 'hidden' });
  log.mark('started from the dialog');
  const swarmId = (await invoke('swarm_list', {})).value.swarms[0].id;
  result.warnings = (await invoke('swarm_status', { swarmId })).value?.warnings;

  const approvals = [];
  const answerApprovals = async () => {
    const open = ((await invoke('inbox_list', {})).value?.items ?? []).filter((item) => item.origin === 'swarm:can_use_tool' && item.state !== 'done');
    if (open.length === 0) return;
    await page.getByRole('tab', { name: 'Inbox' }).click();
    await page.getByTestId('inbox-row').first().click();
    const card = { message: await page.getByTestId('inbox-message').textContent() };
    await page.getByTestId('swarm-approval-allow').click();
    approvals.push(card);
    log.mark(`approval answered Allow on the card: ${card.message}`);
  };
  await waitForSwarmEnd(run, log, swarmId, async () => {
    await answerApprovals();
    const state = (await invoke('swarm_status', { swarmId })).value?.state;
    // A rate-limit event that is not `allowed` pauses every running swarm (0037); the run cannot go on by itself.
    if (state === 'paused') throw new Error('the swarm paused');
  });
  const peak = { processes: 0 };
  const changeset = await waitFor(log, 'the review to reach a decision', async () => {
    await answerApprovals();
    const live = ((await invoke('agents_list', {})).value?.agents ?? []).filter((node) => node.state === 'running').length;
    peak.processes = Math.max(peak.processes, live);
    const newest = (await invoke('review_list', { swarmId, limit: 10 })).value?.changesets?.[0];
    if (newest === undefined) return undefined;
    return ['awaiting_human', 'accepted', 'sent_back', 'queued_for_budget', 'rejected'].includes(newest.state) ? newest : undefined;
  });
  // The reviewer's cost arrives with its process end, which can follow the report by a few seconds.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !((await invoke('review_get', { changesetId: changeset.id })).value?.runs ?? []).every((entry) => entry.reportedUsd > 0)) await new Promise((resolve) => setTimeout(resolve, 500));
  const detail = (await invoke('review_get', { changesetId: changeset.id })).value;
  result.approvals = approvals;
  result.changeset = { id: changeset.id, state: changeset.state, rung: changeset.rung, floor: changeset.floor, files: detail.files.map((file) => `${file.status} ${file.newPath ?? file.oldPath}`) };
  result.reasons = detail.reasons.map((reason) => `${reason.id} ${reason.minRung}${reason.hard ? ' hard' : ''}`);
  result.claim = detail.changeset.claim;
  result.report = detail.report === undefined ? undefined : { verdict: detail.report.verdict, escalateTo: detail.report.escalateTo, claimCheck: detail.report.claimCheck, summary: detail.report.summary, findings: detail.report.findings, droppedFindings: detail.report.droppedFindings };
  result.runs = detail.runs.map((entry) => ({ attempt: entry.attempt, state: entry.state, failure: entry.failure, model: entry.model, promptVersion: entry.promptVersion, reservedUsd: entry.reservedUsd, reportedUsd: entry.reportedUsd, rejectedCalls: entry.rejectedCalls }));
  const status = (await invoke('swarm_status', { swarmId })).value;
  result.worker = status.agents.map((agent) => ({ state: agent.state, model: agent.model, turns: agent.turns, spendUsd: agent.spend.reportedUsd }))[0];
  result.budget = status.budget;
  result.inbox = ((await invoke('inbox_list', { states: ['new', 'seen', 'snoozed', 'done'] })).value?.items ?? []).map((item) => ({ kind: item.kind, origin: item.origin, message: item.message, state: item.state }));
  const gate = await invoke('swarm_merge', { swarmId, dryRun: true });
  result.mergeGate = gate.ok ? { open: true, merged: gate.value.merged.map((entry) => entry.agent) } : { open: false, error: gate.error };
  result.peakAppStartedRunning = peak.processes;
  result.reviewCostUsd = result.runs.reduce((sum, entry) => sum + entry.reportedUsd, 0);
  result.ok = result.report !== undefined && result.runs.some((entry) => entry.state === 'reported') && result.changeset.files.some((file) => file.endsWith('discount.ts'));
} catch (error) {
  result.error = String(error);
  try {
    result.inbox ??= ((await invoke('inbox_list', { states: ['new', 'seen', 'snoozed', 'done'] })).value?.items ?? []).map((item) => ({ kind: item.kind, origin: item.origin, message: item.message, details: item.details, state: item.state }));
    const swarms = (await invoke('swarm_list', {})).value?.swarms ?? [];
    if (swarms[0] !== undefined) result.swarmAtError = (await invoke('swarm_status', { swarmId: swarms[0].id })).value?.agents.map((agent) => ({ state: agent.state, reason: agent.reason, spendUsd: agent.spend.reportedUsd, model: agent.model }));
  } catch {
    // The window is gone.
  }
} finally {
  result.appLog = appLog.slice(0, 40);
  result.seconds = log.elapsed();
  await run.app.close();
  // A reviewer checkout is read-only; one the app did not remove is reported and then made writable to remove it.
  const runsDir = join(taskBase, 'review-runs');
  result.reviewerCheckoutsLeft = existsSync(runsDir) ? readdirSync(runsDir) : [];
  execFileSync('chmod', ['-R', 'u+w', scratch]);
  rmSync(run.userData, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
  for (const entry of readdirSync(cwd)) rmSync(join(cwd, entry), { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
