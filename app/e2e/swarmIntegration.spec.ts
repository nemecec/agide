import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RendererApi } from '../src/shared/ipc';
import { connectAsSession, recordedLaunches, toolJson } from './sessionMcp';

// The whole swarm path in one app: a session starts a swarm over MCP, the agents run as stream-json processes of
// the fake CLI through the local provider, their approval is answered on the inbox card, the cap queues an agent
// of a second swarm, and swarm_stop ends the group.
const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE = join(import.meta.dirname, 'fixtures', 'fake-claude-dispatch.mjs');

interface AgentStatus {
  name: string;
  state: string;
  queuedFor?: string;
  sessionId?: string;
  spend: { reportedUsd: number };
}
interface Status {
  state: string;
  agents: AgentStatus[];
}

let root: string;
let app: ElectronApplication | undefined;
let client: Client | undefined;
let page: Page;

test.beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agide-swarm-int-')));
});
test.afterEach(async () => {
  await client?.close();
  client = undefined;
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function invoke<T = unknown>(id: string, input: unknown = {}): Promise<T> {
  const result = await page.evaluate(([commandId, args]) => (globalThis as unknown as { api: RendererApi }).api.invoke(commandId as string, args), [id, input] as const);
  if (!result.ok) throw new Error(`${id}: ${result.error.message}`);
  return result.value as T;
}

/** The tree beside the main surface and the inbox, so tree rows and the inbox card are both reachable. */
function writeLayout(dataDir: string): void {
  const pane = (type: string, config: object = {}) => ({ type, version: '^1', configVersion: 1, config });
  const document = {
    schemaVersion: 1,
    revision: 1,
    id: 'swarm-int',
    title: 'swarm-int',
    instances: { tree: pane('agide/tree'), main: { ...pane('agide/surface-host', { emptyText: 'Open a session' }), bindings: { node: { context: 'node.current' } } }, inbox: pane('agide/inbox') },
    arrangement: { split: 'row', children: [{ size: 1, tabs: { panes: ['tree'], active: 'tree' } }, { size: 3, tabs: { panes: ['main', 'inbox'], active: 'main' } }] },
  };
  mkdirSync(join(dataDir, 'layouts'), { recursive: true });
  writeFileSync(join(dataDir, 'layouts', 'swarm-int.json'), JSON.stringify(document));
}

const status = async (swarmId: string): Promise<Status> => toolJson<Status>(await client!.callTool({ name: 'swarm_status', arguments: { swarmId } }));
const agentChips = (state: string) => page.locator(`[data-testid="swarm-agent-chip"][data-agent-state="${state}"]`);

async function ensureExpanded(title: string): Promise<void> {
  const row = page.getByRole('treeitem', { name: new RegExp(`^${title}`) }).first();
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.dblclick();
  await expect(row, `${title} is expanded`).toHaveAttribute('aria-expanded', 'true');
}

test('a swarm started over MCP runs on the stream-json runtime, waits for an inbox answer, queues at the cap and stops', async () => {
  const dataDir = join(root, 'data');
  const record = join(root, 'launches.jsonl');
  mkdirSync(join(root, 'cwd'));
  app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: dataDir,
      AGIDE_CLAUDE_BIN: FAKE,
      AGIDE_SESSION_CWD: join(root, 'cwd'),
      AGIDE_TASK_BASE: join(root, 'agide'),
      FAKE_CLAUDE_STATE: join(root, 'fake-state'),
      FAKE_CLAUDE_RECORD: record,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
  });
  page = await app.firstWindow();
  await expect(page.getByRole('tree', { name: 'Task tree' }), 'the window rendered').toBeVisible();
  writeLayout(dataDir);
  await page.waitForTimeout(500);
  await invoke('layout_switch', { layoutId: 'swarm-int' });
  await invoke('agents_settings_set', { maxConcurrentAppStarted: 2 });

  const project = await invoke<{ id: string }>('ui_create_folder', { title: 'Project' });
  await invoke('session_create', { folderId: project.id });
  await expect.poll(() => recordedLaunches(record).length, { message: 'the caller session launched' }).toBeGreaterThan(0);
  client = await connectAsSession(recordedLaunches(record)[0]!);

  const started = toolJson<{ swarmId: string; folderId: string }>(
    await client.callTool({
      name: 'swarm_start',
      arguments: {
        definition: {
          version: 1,
          goal: 'Pair swarm',
          budget: { usdTotal: 2 },
          agents: [
            { name: 'worker', workspace: 'scratch', prompt: '/cost 0.2\n/tool Bash {"command":"npm test"}\n/text tests passed' },
            { name: 'helper', workspace: 'scratch', prompt: '/sleep 600000' },
          ],
        },
      },
    }),
  );
  await expect.poll(async () => (await status(started.swarmId)).agents.map((agent) => agent.state), { message: 'the worker waits and the helper runs' }).toEqual(['waiting', 'running']);
  const launches = recordedLaunches(record).filter((launch) => launch.args.includes('--input-format'));
  expect(launches, 'each agent is a stream-json claude process').toHaveLength(2);
  expect(launches[0]!.args, 'launched with the permission prompt over stdio').toEqual(expect.arrayContaining(['-p', '--permission-prompt-tool', 'stdio']));

  await ensureExpanded('Project');
  await expect(page.getByTestId('swarm-cap'), 'the project folder shows the agents against the cap').toHaveText('2 of 2 agents running');
  await ensureExpanded('Pair swarm');
  await expect(page.getByTestId('swarm-agent-chip'), 'one agent node per agent').toHaveCount(2);
  await expect(agentChips('waiting'), 'the worker node waits').toHaveCount(1);

  const agentNodes = await invoke<{ agents: { sessionId: string; origin: string; state: string }[] }>('agents_list', {});
  const sessionIds = (await status(started.swarmId)).agents.map((agent) => agent.sessionId);
  expect(
    agentNodes.agents.filter((node) => node.origin === 'app-started' && sessionIds.includes(node.sessionId)).map((node) => node.state).sort(),
    'the agents module has an app-started node per agent',
  ).toEqual(['running', 'waiting']);
  const usage = await invoke<{ appStarted: { running: number; cap: number }; ranking: { subject: { kind: string; sessionId?: string } }[] }>('usage_state', {});
  expect(usage.appStarted, 'the usage view counts the app-started agents against the cap').toEqual({ running: 2, cap: 2 });
  expect(
    usage.ranking.some((entry) => entry.subject.kind === 'session' && entry.subject.sessionId === sessionIds[0]),
    'the usage ranking lists the worker from its token usage',
  ).toBe(true);

  const second = await invoke<{ swarmId: string }>('swarm_start', {
    parentFolderId: project.id,
    definition: { version: 1, goal: 'Queued swarm', budget: { usdTotal: 1 }, agents: [{ name: 'third', workspace: 'scratch', prompt: '/text third done' }] },
  });
  expect((await status(second.swarmId)).agents[0], 'the third agent waits for a slot').toMatchObject({ state: 'queued', queuedFor: 'slot' });

  await page.getByRole('tab', { name: 'Inbox' }).click();
  await page.getByTestId('inbox-row').first().click();
  await expect(page.getByTestId('inbox-message'), 'the card names the agent and the tool').toContainText('worker wants to run Bash');
  await page.getByTestId('swarm-approval-allow').click();
  await expect.poll(async () => (await status(started.swarmId)).agents[0]?.state, { message: 'the worker continued and finished' }).toBe('done');
  await expect.poll(async () => (await status(second.swarmId)).agents[0]?.state, { message: 'the freed slot runs the queued agent' }).toBe('done');
  const worker = (await status(started.swarmId)).agents[0]!;
  const workerNode = (await invoke<{ agents: { sessionId: string; costUsd?: number }[] }>('agents_list', {})).agents.find((node) => node.sessionId === worker.sessionId);
  expect(worker.spend.reportedUsd, 'the swarm ledger has the cost the agent reported').toBeGreaterThan(0);
  expect(workerNode?.costUsd, 'the agent node shows the cost the CLI reported, as the swarm ledger does').toBeCloseTo(worker.spend.reportedUsd, 6);

  const stopped = await client.callTool({ name: 'swarm_stop', arguments: { swarmId: started.swarmId } });
  expect(stopped.isError, 'swarm_stop is accepted').toBeFalsy();
  await expect.poll(async () => (await status(started.swarmId)).state, { message: 'the group is stopped' }).toBe('stopped');
  expect((await status(started.swarmId)).agents.map((agent) => agent.state), 'the running helper is stopped, the finished worker stays done').toEqual(['done', 'stopped']);
  await expect(page.getByTestId('swarm-cap'), 'no agent holds a slot any more').toHaveText('0 of 2 agents running');
});
