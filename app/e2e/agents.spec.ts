import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { SESSION_PRESET } from '../src/core/blocks/presets';
import type { CommandResult } from '../src/core/commands/types';
import type { UsageState } from '../src/core/usage/types';
import type { RendererApi } from '../src/shared/ipc';

const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'agents', 'fixtures', 'fake-claude-agents.mjs');
const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

let app: ElectronApplication;
let userData: string;
let configRoot: string;
let workdir: string;

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'agide-agents-'));
  configRoot = mkdtempSync(join(tmpdir(), 'agide-agents-cfg-'));
  workdir = mkdtempSync(join(tmpdir(), 'agide-agents-cwd-'));
  // The usage and history panes sit beside the surface in this layout.
  const pane = (type: string) => ({ type, version: '^1', configVersion: 1, config: {} });
  mkdirSync(join(userData, 'layouts'), { recursive: true });
  for (const [id, active] of [['agents', 'usage'], ['agents-history', 'history']] as const) {
    writeFileSync(
      join(userData, 'layouts', `${id}.json`),
      JSON.stringify({
        ...SESSION_PRESET,
        id,
        title: id,
        instances: { ...SESSION_PRESET.instances, usage: pane('agide/usage-ranking'), history: pane('agide/agent-history') },
        arrangement: {
          split: 'row',
          children: [
            { size: 0.2, tabs: { panes: ['rail'], active: 'rail' } },
            { size: 1.4, tabs: { panes: ['tree'], active: 'tree' } },
            { size: 3, tabs: { panes: ['usage', 'history', 'main', 'inbox'], active } },
          ],
        },
      }),
    );
  }
  app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: userData,
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      CLAUDE_CONFIG_DIR: configRoot,
      FAKE_CLAUDE_ROOT: configRoot,
      FAKE_CLAUDE_RECORD: join(userData, 'launches.jsonl'),
    },
  });
});

test.afterEach(async () => {
  await app.close();
  for (const dir of [userData, configRoot, workdir]) rmSync(dir, { recursive: true, force: true });
});

const invoke = <T>(page: Page, id: string, input?: unknown) =>
  page.evaluate(([commandId, payload]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, payload), [id, input] as const) as Promise<CommandResult<T>>;

async function startPage(layoutId = 'agents'): Promise<{ page: Page; folderId: string }> {
  const page = await app.firstWindow();
  await expect(page.getByTestId('tree-pane'), 'tree pane is rendered').toBeVisible();
  const switched = await invoke(page, 'layout_switch', { layoutId });
  expect(switched.ok, 'the layout applies').toBe(true);
  const folder = await invoke<{ id: string }>(page, 'ui_create_folder', { title: 'Work' });
  if (!folder.ok) throw new Error('folder not created');
  return { page, folderId: folder.value.id };
}

async function newSession(page: Page, folderId: string): Promise<string> {
  const created = await invoke<{ sessionId: string }>(page, 'session_create', { folderId, cwd: workdir });
  if (!created.ok) throw new Error(created.error.message);
  const sessionId = created.value.sessionId;
  await expect.poll(async () => (await invoke<{ status: string }>(page, 'session_get', { sessionId })).ok, { message: 'session exists' }).toBe(true);
  await expect
    .poll(async () => {
      const got = await invoke<{ status: string }>(page, 'session_get', { sessionId });
      return got.ok ? got.value.status : '';
    }, { message: 'session is idle after SessionStart' })
    .toBe('idle');
  const folder = page.getByRole('treeitem', { name: 'Work', exact: true });
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.dblclick();
  return sessionId;
}

const type = (page: Page, sessionId: string, text: string) => invoke(page, 'session_send_text', { sessionId, text });
const rows = (page: Page): Locator => page.getByTestId('agent-row');
const usageState = async (page: Page): Promise<UsageState> => {
  const result = await invoke<UsageState>(page, 'usage_state', {});
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

test('shows subagents as nodes under the session, counts them, removes finished ones after the delay and lists them in the history', async () => {
  const { page, folderId } = await startPage();
  expect((await invoke(page, 'agents_settings_set', { removeDoneAfterSeconds: 2 })).ok, 'the removal delay is a setting').toBe(true);
  const sessionId = await newSession(page, folderId);

  await type(page, sessionId, '/agent a1 Read the files');
  await type(page, sessionId, '/agent a2 Run the tests');
  await expect(rows(page), 'two agent nodes appear under the session').toHaveCount(2);
  await expect(rows(page).first(), 'the first node is labelled with the description of the Agent tool call').toContainText('Read the files');
  await expect(page.getByTestId('agent-count'), 'the parent shows the running count').toHaveAttribute('aria-label', '2 running');

  await type(page, sessionId, '/agentstop a1');
  await expect(page.getByTestId('agent-count'), 'the count falls when an agent ends').toHaveAttribute('aria-label', '1 running');
  await expect(page.getByTestId('agent-finished'), 'the finished tally leaves a trace').toHaveAttribute('aria-label', '1 finished in the last minute');
  await expect(page.locator('[data-testid=agent-row][data-agent=a1]'), 'the finished node leaves the tree after the delay').toHaveCount(0, { timeout: 8000 });
  await expect(rows(page), 'the running node stays').toHaveCount(1);

  const history = await invoke<{ agents: { agentKey: string; state: string; outcomeBasis?: string }[] }>(page, 'agents_history', {});
  expect(history.ok && history.value.agents.map((a) => [a.agentKey, a.state, a.outcomeBasis]), 'the history lists the finished agent with a derived outcome').toEqual([['a1', 'done', 'derived']]);
});

test('lists finished agents in the history pane and opens their transcript read-only', async () => {
  const { page, folderId } = await startPage('agents-history');
  await invoke(page, 'agents_settings_set', { removeDoneAfterSeconds: 0 });
  const sessionId = await newSession(page, folderId);
  await type(page, sessionId, '/agent a1 Summarise the log');
  await type(page, sessionId, '/agentlines a1 2 100');
  await type(page, sessionId, '/agentstop a1');
  await expect.poll(async () => {
    const history = await invoke<{ agents: unknown[] }>(page, 'agents_history', {});
    return history.ok ? history.value.agents.length : 0;
  }, { message: 'the agent is in the history' }).toBe(1);
  await expect(rows(page), 'with a zero delay the node never shows once finished').toHaveCount(0);

  const row = page.getByTestId('history-row');
  await expect(row, 'the history pane lists the finished agent').toHaveCount(1);
  await expect(row, 'with its label and the label of the derived outcome').toContainText('Summarise the log');
  await expect(row, 'outcome basis is labelled').toContainText('outcome derived by Agide');
  await row.click();
  const answer = await invoke<{ available: boolean; entries: { role: string; text: string }[] }>(page, 'agents_transcript', { sessionId, agentKey: 'a1' });
  expect(answer.ok && answer.value.available, 'the transcript opens from the original file').toBe(true);
  expect(answer.ok && answer.value.entries.map((e) => e.role), 'two assistant lines').toEqual(['assistant', 'assistant']);
  await expect(page.getByTestId('transcript-view'), 'the viewer shows the transcript below the list').toBeVisible();
  await expect(page.locator('[data-testid=transcript-view] pre').first(), 'plain text of the first reply').toContainText('reply');
  const refused = await invoke<{ available: boolean }>(page, 'agents_transcript', { sessionId, agentKey: 'unknown' });
  expect(refused.ok && refused.value.available, 'an agent without a transcript shows as removed').toBe(false);
});

test('ranks sessions by their recent cost rate and shows plan usage from the status line', async () => {
  const { page, folderId } = await startPage();
  const quiet = await newSession(page, folderId);
  const busy = await newSession(page, folderId);

  await type(page, quiet, '/lines 1 10000');
  await type(page, busy, '/lines 3 400000');
  await type(page, busy, '/status 0.9 42');
  await expect
    .poll(async () => (await usageState(page)).ranking.map((r) => (r.subject.kind === 'session' ? r.subject.sessionId : '')), { message: 'the busier session leads the ranking', timeout: 15_000 })
    .toEqual([busy, quiet]);

  const state = await usageState(page);
  expect(state.ranking[0]?.costUsdPerMinute ?? 0, 'the leader has the higher cost rate').toBeGreaterThan(state.ranking[1]?.costUsdPerMinute ?? 0);
  await expect
    .poll(async () => (await usageState(page)).plan[0], { message: 'five-hour plan percentage from the status line' })
    .toMatchObject({ window: 'five_hour', usedPercentage: 42, source: 'status-line' });
  expect(state.heat[`session:${busy}`]?.level ?? 0, 'the busy session carries heat').toBeGreaterThan(0);

  await expect(page.getByTestId('usage-pane'), 'the usage pane is visible').toBeVisible();
  const order = page.locator('[data-testid=usage-row]');
  await expect(order, 'both sessions are listed').toHaveCount(2);
  await expect(order.first(), 'the first row is the busy session').toHaveAttribute('data-subject', `session:${busy}`);
  await expect(page.getByTestId('usage-pane'), 'estimates are labelled').toContainText('estimates at list price');
  await expect(page.getByTestId('session-heat').first(), 'a heat marker on a session node has a text tooltip').toHaveAttribute('title', /estimated over the last 5 minutes/);
});

test('marks the session leaf while an approval is open', async () => {
  const { page, folderId } = await startPage();
  const sessionId = await newSession(page, folderId);
  await type(page, sessionId, '/perm Bash');
  await expect(page.getByTestId('agent-waiting'), 'the leaf shows the waiting marker').toBeVisible();
  const list = await invoke<{ waitingSessions: string[] }>(page, 'agents_list', {});
  expect(list.ok && list.value.waitingSessions, 'the store marks the session').toEqual([sessionId]);
});
