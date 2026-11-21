import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { connectAsSession, recordedLaunches, toolJson } from './sessionMcp';

const MAIN = join(import.meta.dirname, '..', 'out', 'main', 'index.js');
const FAKE_CLAUDE = join(import.meta.dirname, '..', 'src', 'core', 'session', 'fixtures', 'fake-claude.mjs');

interface SwarmStarted {
  swarmId: string;
  folderId: string;
  agents: { name: string; state: string }[];
}
interface Status {
  state: string;
  stopReason?: string;
  agents: { name: string; state: string; reason?: string; openApprovals: { requestId: string }[] }[];
}

let root: string;
let app: ElectronApplication | undefined;
let client: Client | undefined;

test.beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'agide-swarm-mgr-')));
});
test.afterEach(async () => {
  await client?.close();
  client = undefined;
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

/** The app with the in-memory swarm runtime, and an MCP client as a session in a folder (the session runs the fake `claude`). */
async function launch(): Promise<{ page: Page; folderId: string }> {
  mkdirSync(join(root, 'plain'));
  app = await electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      AGIDE_HIDDEN: '1',
      AGIDE_USER_DATA: join(root, 'data'),
      AGIDE_CLAUDE_BIN: FAKE_CLAUDE,
      AGIDE_SWARM_RUNTIME: 'fake',
      FAKE_CLAUDE_RECORD: join(root, 'launches.jsonl'),
      AGIDE_TASK_BASE: join(root, 'agide'),
      AGIDE_SESSION_CWD: join(root, 'plain'),
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
  });
  const page = await app.firstWindow();
  const folderId = await page.evaluate(async () => {
    const api = (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<{ ok: boolean; value: unknown }> } }).api;
    const folder = (await api.invoke('ui_create_folder', { title: 'Agents' })).value as { id: string };
    await api.invoke('session_create', { folderId: folder.id });
    return folder.id;
  });
  await expect.poll(() => recordedLaunches(join(root, 'launches.jsonl')).length, { message: 'caller session launched' }).toBeGreaterThan(0);
  client = await connectAsSession(recordedLaunches(join(root, 'launches.jsonl'))[0] ?? { args: [] });
  return { page, folderId };
}

const definition = (agents: object[], extra: object = {}) => ({
  version: 1,
  goal: 'End to end swarm',
  budget: { usdTotal: 2 },
  agents: agents.map((agent) => ({ workspace: 'scratch', ...agent })),
  ...extra,
});

async function status(swarmId: string): Promise<Status> {
  return toolJson<Status>(await client!.callTool({ name: 'swarm_status', arguments: { swarmId } }));
}

test('swarm_start over MCP starts agents in the caller folder and swarm_stop stops them', async () => {
  const { page, folderId } = await launch();
  const started = toolJson<SwarmStarted>(
    await client!.callTool({
      name: 'swarm_start',
      arguments: {
        definition: definition([
          { name: 'alpha', prompt: '/sleep 20000' },
          { name: 'beta', prompt: '/sleep 20000' },
        ]),
      },
    }),
  );
  expect(
    started.agents.map((agent) => [agent.name, agent.state]),
    'both agents run',
  ).toEqual([
    ['alpha', 'running'],
    ['beta', 'running'],
  ]);
  const tree = toolJson<{ nodes: { id: string; parentId: string | null; title: string }[] }>(await client!.callTool({ name: 'ui_list_tree', arguments: {} }));
  expect(
    tree.nodes.find((node) => node.id === started.folderId),
    'the swarm folder sits in the caller folder',
  ).toMatchObject({ parentId: folderId, title: 'End to end swarm' });
  const listed = toolJson<{ swarms: { id: string; state: string }[] }>(await client!.callTool({ name: 'swarm_list', arguments: {} }));
  expect(
    listed.swarms.map((swarm) => [swarm.id, swarm.state]),
    'listed as running',
  ).toEqual([[started.swarmId, 'running']]);

  const stopped = await client!.callTool({ name: 'swarm_stop', arguments: { swarmId: started.swarmId } });
  expect(stopped.isError, 'stop is accepted').toBeFalsy();
  await expect.poll(async () => (await status(started.swarmId)).agents.map((agent) => agent.state), { message: 'both agents stopped' }).toEqual(['stopped', 'stopped']);
  expect((await status(started.swarmId)).state, 'the swarm is stopped').toBe('stopped');

  const tools = (await client!.listTools()).tools.map((tool) => tool.name).filter((name) => name.startsWith('swarm_'));
  expect(tools.sort(), 'the approval answer is not an agent tool').toEqual([
    'swarm_interrupt',
    'swarm_list',
    'swarm_results',
    'swarm_send',
    'swarm_start',
    'swarm_status',
    'swarm_stop',
  ]);
  const refused = await page.evaluate(() =>
    (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<{ ok: boolean }> } }).api.invoke('swarm_status', { swarmId: 'missing' }),
  );
  expect(refused.ok, 'an unknown swarm is an error value for the UI too').toBe(false);
});

test('an agent call that needs approval shows as an inbox item and the user answers it from the UI', async () => {
  const { page } = await launch();
  const started = toolJson<SwarmStarted>(
    await client!.callTool({ name: 'swarm_start', arguments: { definition: definition([{ name: 'writer', prompt: '/tool Bash {"command":"ls build"}\n/text finished' }]) } }),
  );
  await expect.poll(async () => (await status(started.swarmId)).agents[0]?.state, { message: 'the agent waits for an answer' }).toBe('waiting');
  const approval = (await status(started.swarmId)).agents[0]!.openApprovals[0]!;
  const items = await page.evaluate(() =>
    (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<{ value: { items: { origin: string; message: string; kind: string }[] } }> } }).api.invoke(
      'inbox_list',
      {},
    ),
  );
  expect(
    items.value.items.find((item) => item.origin === 'swarm:can_use_tool'),
    'the approval is an inbox item',
  ).toMatchObject({ kind: 'approval', message: 'writer wants to run Bash: ls build' });
  const agentAnswer = await client!.callTool({
    name: 'swarm_approval_answer',
    arguments: { swarmId: started.swarmId, agent: 'writer', requestId: approval.requestId, decision: 'allow' },
  });
  expect(agentAnswer.isError, 'an agent cannot answer: the tool does not exist').toBe(true);
  const answered = await page.evaluate(
    ([swarmId, requestId]) =>
      (globalThis as unknown as { api: { invoke: (id: string, input: unknown) => Promise<{ ok: boolean }> } }).api.invoke('swarm_approval_answer', {
        swarmId,
        agent: 'writer',
        requestId,
        decision: 'allow',
      }),
    [started.swarmId, approval.requestId] as const,
  );
  expect(answered.ok, 'the user answers').toBe(true);
  await expect.poll(async () => (await status(started.swarmId)).state, { message: 'the swarm finishes after the allow' }).toBe('done');
});

test('an invalid definition comes back with every problem named', async () => {
  await launch();
  const result = await client!.callTool({
    name: 'swarm_start',
    arguments: {
      definition: definition([
        { name: 'a', prompt: 'x', dependsOn: ['b'] },
        { name: 'b', prompt: 'y', dependsOn: ['a'] },
      ]),
    },
  });
  expect(result.isError, 'refused').toBe(true);
  expect(JSON.stringify(result.content), 'the cycle is named').toContain('cycle');
});
