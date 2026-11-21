import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Caller } from '../../core/commands/types';
import { startAppModules, type AppModules } from '../appForTests';

const FAKE_CLAUDE = join(import.meta.dirname, '..', '..', 'core', 'session', 'fixtures', 'fake-claude.mjs');
const saved = { ...process.env };
let dir: string;
let taskBase: string;
let app: AppModules | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swarm-module-'));
  process.env['AGIDE_CLAUDE_BIN'] = FAKE_CLAUDE;
  process.env['FAKE_CLAUDE_RECORD'] = join(dir, 'launches.jsonl');
  process.env['AGIDE_SWARM_RUNTIME'] = 'fake';
  // Scratch directories go below the task base, which must lie outside the app root.
  taskBase = mkdtempSync(join(tmpdir(), 'swarm-module-base-'));
  process.env['AGIDE_TASK_BASE'] = taskBase;
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
  rmSync(taskBase, { recursive: true, force: true });
});

describe('swarm module in the real module graph', () => {
  const definition = (agents: object[], extra: object = {}) => ({
    version: 1,
    goal: 'module swarm',
    budget: { usdTotal: 2 },
    agents: agents.map((agent) => ({ workspace: 'scratch', ...agent })),
    ...extra,
  });
  const invoke = (id: string, input: unknown, caller: Caller = { kind: 'ui' }) =>
    app!.commands.invoke(id, input, caller) as Promise<{ ok: boolean; value?: any; error?: { code: string; message: string } }>;
  const folder = async (title: string): Promise<string> => ((await invoke('ui_create_folder', { title })) as { value: { id: string } }).value.id;
  const until = async (check: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('starts a swarm for the user, lists it, shows its status and stops it', async () => {
    app = await startAppModules({ dataDir: dir });
    const started = await invoke('swarm_start', {
      definition: definition([
        { name: 'a', prompt: '/sleep 5000' },
        { name: 'b', prompt: '/sleep 5000' },
      ]),
    });
    expect(started, 'the start answers with the swarm').toMatchObject({
      ok: true,
      value: {
        agents: [
          { name: 'a', state: 'running' },
          { name: 'b', state: 'running' },
        ],
      },
    });
    const { swarmId, folderId } = started.value;
    expect(app.services.tree.get(folderId), 'the swarm has a folder titled by its goal').toMatchObject({ kind: 'folder', title: 'module swarm' });
    expect(
      (await invoke('swarm_list', {})).value.swarms.map((swarm: { id: string }) => swarm.id),
      'listed',
    ).toEqual([swarmId]);
    expect((await invoke('swarm_status', { swarmId })).value.agents[0], 'the user sees the working directory').toMatchObject({ state: 'running', cwd: expect.any(String) });
    expect(await invoke('swarm_stop', { swarmId }), 'stop').toEqual({ ok: true, value: { ok: true } });
    await until(() => app!.services.swarm.manager.status(swarmId, { kind: 'ui' }).agents.every((agent) => agent.state === 'stopped'), 'agents stopped');
    expect(app.services.swarm.manager.status(swarmId, { kind: 'ui' }).state, 'swarm stopped').toBe('stopped');
  });

  it('reports every problem of an invalid definition so an agent can fix it in one call', async () => {
    app = await startAppModules({ dataDir: dir });
    const result = await invoke('swarm_start', { definition: definition([{ name: 'a', prompt: 'x', dependsOn: ['ghost'] }]) });
    expect(result, 'a graph problem with its field').toMatchObject({
      ok: false,
      error: { code: 'invalid_input', message: expect.stringContaining('a depends on ghost, which is not in the swarm') },
    });
    const unknown = await invoke('swarm_start', { definition: { ...definition([{ name: 'a', prompt: 'x' }]), colour: 'red' } });
    expect(unknown.ok, 'an unknown field is refused by the schema').toBe(false);
  });

  it('puts events on the app bus', async () => {
    app = await startAppModules({ dataDir: dir });
    const seen: string[] = [];
    app.events.onAny((event) => {
      if (event.type.startsWith('swarm.')) seen.push(event.type);
    });
    const started = await invoke('swarm_start', { definition: definition([{ name: 'a', prompt: '/text hi' }]) });
    await until(() => app!.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).state === 'done', 'done');
    expect(new Set(seen), 'changed and agent_changed events').toEqual(new Set(['swarm.changed', 'swarm.agent_changed']));
  });

  it('scopes an MCP caller to its folder: it starts in its folder, sees only its swarms, and cannot start in another folder', async () => {
    app = await startAppModules({ dataDir: dir });
    const mine = await folder('mine');
    const other = await folder('other');
    const caller: Caller = { kind: 'mcp', sessionId: 'caller-1', folderId: mine };
    const started = await invoke('swarm_start', { definition: definition([{ name: 'a', prompt: '/sleep 5000' }]) }, caller);
    expect(started.ok, 'start in its own folder').toBe(true);
    expect(app.services.tree.get(started.value.folderId)?.parentId, 'the swarm folder sits in the caller folder').toBe(mine);
    expect((await invoke('swarm_list', {}, caller)).value.swarms.length, 'the caller sees its swarm').toBe(1);
    expect((await invoke('swarm_list', {}, { kind: 'mcp', sessionId: 'other-1', folderId: other })).value.swarms, 'another folder sees none').toEqual([]);
    expect(
      await invoke('swarm_start', { definition: definition([{ name: 'a', prompt: 'x' }]), parentFolderId: other }, caller),
      'a parent outside the caller folder',
    ).toMatchObject({ ok: false, error: { code: 'out_of_scope' } });
    expect(
      await invoke('swarm_stop', { swarmId: started.value.swarmId }, { kind: 'mcp', sessionId: 'caller-2', folderId: mine }),
      'a session that did not start it cannot stop it',
    ).toMatchObject({ ok: false, error: { code: 'out_of_scope' } });
    expect(await invoke('swarm_status', { swarmId: started.value.swarmId }, { kind: 'mcp', sessionId: 'other-1', folderId: other }), 'another folder gets not_found').toMatchObject(
      { ok: false, error: { code: 'not_found' } },
    );
    await invoke('swarm_stop', { swarmId: started.value.swarmId }, caller);
  });

  it('hides working directories from agents, wraps agent text as untrusted data, and gives the worktree path only to the starter', async () => {
    app = await startAppModules({ dataDir: dir });
    const mine = await folder('mine');
    const caller: Caller = { kind: 'mcp', sessionId: 'caller-1', folderId: mine };
    const started = await invoke('swarm_start', { definition: definition([{ name: 'a', prompt: '/text all done' }]) }, caller);
    await until(() => app!.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).state === 'done', 'done');
    const status = await invoke('swarm_status', { swarmId: started.value.swarmId }, caller);
    expect(status.value.agents[0].cwd, 'no path in the status an agent reads').toBeUndefined();
    const results = (await invoke('swarm_results', { swarmId: started.value.swarmId }, caller)).value.agents[0];
    expect(results.text, 'the text is a tagged block').toMatch(/^<untrusted-data-[0-9a-f]+ source="swarm-agent" name="a">\nall done\n<\/untrusted-data-[0-9a-f]+>$/);
    const user = (await invoke('swarm_results', { swarmId: started.value.swarmId })).value.agents[0];
    expect(user.text, 'the user reads plain text').toBe('all done');
  });

  it('refuses an approval answer from an agent and offers it to no MCP client', async () => {
    app = await startAppModules({ dataDir: dir });
    const mine = await folder('mine');
    const caller: Caller = { kind: 'mcp', sessionId: 'caller-1', folderId: mine };
    const started = await invoke('swarm_start', { definition: definition([{ name: 'w', prompt: '/tool Bash {"command":"ls"}\n/text after' }]) }, caller);
    await until(() => app!.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).agents[0]!.state === 'waiting', 'waiting');
    const open = app.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).agents[0]!.openApprovals[0]!;
    const answer = { swarmId: started.value.swarmId, agent: 'w', requestId: open.requestId, decision: 'allow' };
    expect(await invoke('swarm_approval_answer', answer, caller), 'the command does not exist for an agent, not even the one that started the swarm').toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await invoke('swarm_approval_answer', answer), 'the user can').toEqual({ ok: true, value: { ok: true } });
    await until(() => app!.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).state === 'done', 'done');
    expect(app.services.inbox.list({ kinds: ['approval'] })[0], 'the item resolved as approved').toMatchObject({ resolution: 'approved' });
    const grant = app.services.mcp.grant('swarm-tools', mine);
    const client = new Client({ name: 'swarm-tools', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(grant.url), { requestInit: { headers: { Authorization: `Bearer ${grant.token}` } } }));
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name).filter((name) => name.startsWith('swarm_'));
      expect(names.sort(), 'swarm tools agents receive').toEqual(['swarm_interrupt', 'swarm_list', 'swarm_results', 'swarm_send', 'swarm_start', 'swarm_status', 'swarm_stop']);
    } finally {
      await client.close();
    }
  });

  it('refuses a start beyond the spawn depth for an agent of a swarm, and one that may not start swarms', async () => {
    app = await startAppModules({ dataDir: dir });
    const mine = await folder('mine');
    const started = await invoke('swarm_start', { definition: definition([{ name: 'w', prompt: '/sleep 5000' }]) }, { kind: 'mcp', sessionId: 'caller-1', folderId: mine });
    const agentSession = app.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).agents[0]!.sessionId!;
    const agent: Caller = { kind: 'mcp', sessionId: agentSession, folderId: started.value.folderId };
    expect(await invoke('swarm_start', { definition: definition([{ name: 'x', prompt: 'x' }]) }, agent), 'a swarm agent without mayStartSwarms').toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    await invoke('swarm_stop', { swarmId: started.value.swarmId }, { kind: 'mcp', sessionId: 'caller-1', folderId: mine });
  });

  it('keeps the depth limit for the agents of a swarm the user starts, also through a session the agent starts with task_start', async () => {
    app = await startAppModules({ dataDir: dir });
    const started = await invoke('swarm_start', { definition: definition([{ name: 'w', prompt: '/sleep 5000', mayStartSwarms: true }]) });
    const agentSession = app.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).agents[0]!.sessionId!;
    const agent: Caller = { kind: 'mcp', sessionId: agentSession, folderId: started.value.folderId };
    expect(await invoke('swarm_start', { definition: definition([{ name: 'x', prompt: 'x' }]) }, agent), 'an agent of a user swarm that may start swarms').toMatchObject({
      ok: false,
      error: { code: 'limit_reached' },
    });
    const task = await invoke('task_start', { source: 'look around' }, agent);
    expect(task.ok, 'the agent starts a task session').toBe(true);
    const child: Caller = { kind: 'mcp', sessionId: task.value.sessionId, folderId: task.value.folderId };
    expect(await invoke('swarm_start', { definition: definition([{ name: 'y', prompt: 'y' }]) }, child), 'the task session below a swarm agent').toMatchObject({
      ok: false,
      error: { code: 'limit_reached' },
    });
    await invoke('swarm_stop', { swarmId: started.value.swarmId });
  });

  it('lets a session below a plain user session start a swarm after it started a task', async () => {
    app = await startAppModules({ dataDir: dir });
    const mine = await folder('mine');
    const user: Caller = { kind: 'mcp', sessionId: 'user-session', folderId: mine };
    const task = await invoke('task_start', { source: 'look around' }, user);
    expect(task.ok, 'the session starts a task session').toBe(true);
    const child: Caller = { kind: 'mcp', sessionId: task.value.sessionId, folderId: task.value.folderId };
    const swarm = await invoke('swarm_start', { definition: definition([{ name: 'y', prompt: '/sleep 5000' }]) }, child);
    expect(swarm.ok, 'depth 0 stays depth 0 through task_start').toBe(true);
    await invoke('swarm_stop', { swarmId: swarm.value.swarmId }, child);
  });

  it('runs a session caller at the mode of its session when it starts a swarm', async () => {
    app = await startAppModules({ dataDir: dir });
    const mine = await folder('mine');
    const work = join(dir, 'work');
    mkdirSync(work);
    const caller = await app.services.sessions.create({ id: 'plan-session', folderId: mine, cwd: work, permissionMode: 'plan' });
    const started = await invoke('swarm_start', { definition: definition([{ name: 'w', prompt: '/sleep 5000' }]) }, { kind: 'mcp', sessionId: caller.id, folderId: mine });
    expect(app.services.swarm.manager.status(started.value.swarmId, { kind: 'ui' }).agents[0]!.permissionMode, 'never looser than the caller').toBe('plan');
    await invoke('swarm_stop', { swarmId: started.value.swarmId }, { kind: 'mcp', sessionId: caller.id, folderId: mine });
  });

  it('adopts a leaf created in the session folder for a session without one, so removing that leaf closes the session', async () => {
    app = await startAppModules({ dataDir: dir });
    const { tree, sessions } = app.services;
    const folder = tree.createFolder({ title: 'swarm' });
    const other = tree.createFolder({ title: 'elsewhere' });
    const work = join(dir, 'work');
    mkdirSync(work);
    const session = await sessions.create({ id: 'agent-1', folderId: folder.id, cwd: work });
    tree.createLeaf({ title: 'forged', parentId: other.id, surfaceType: 'claude-session', surfaceId: session.id });
    const leaf = tree.createLeaf({ title: 'impl', parentId: folder.id, surfaceType: 'claude-session', surfaceId: session.id });
    tree.remove(other.id);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sessions.get(session.id), 'a leaf in another folder does not drive the session').toBeDefined();
    tree.remove(leaf.id);
    const deadline = Date.now() + 5_000;
    while (sessions.get(session.id) !== undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions.get(session.id), 'removing the adopted leaf closes the session').toBeUndefined();
  });

  it('keeps one leaf for an agent session that already has one in the tree when the agent is resumed', async () => {
    app = await startAppModules({ dataDir: dir });
    const { tree, sessions, swarm } = { ...app.services, swarm: app.services.swarm.manager };
    const started = await invoke('swarm_start', { definition: definition([{ name: 'a', prompt: '/text finished' }]) });
    const { swarmId, folderId } = started.value;
    await until(() => swarm.status(swarmId, { kind: 'ui' }).agents[0]!.state === 'done', 'agent done');
    const sessionId = swarm.status(swarmId, { kind: 'ui' }).agents[0]!.sessionId!;
    const work = join(dir, 'work');
    mkdirSync(work);
    await sessions.create({ id: sessionId, folderId, cwd: work });
    tree.createLeaf({ title: 'a', parentId: folderId, surfaceType: 'claude-session', surfaceId: sessionId });
    const leavesOf = () => tree.list().filter((node) => node.kind === 'leaf' && node.surfaceType === 'claude-session' && node.surfaceId === sessionId).length;
    expect(leavesOf(), 'one leaf before the resume').toBe(1);
    expect(await invoke('swarm_send', { swarmId, agent: 'a', message: 'go on' }), 'the resume is accepted').toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(leavesOf(), 'the resume found the leaf in the tree and made no second one').toBe(1);
  });
});
