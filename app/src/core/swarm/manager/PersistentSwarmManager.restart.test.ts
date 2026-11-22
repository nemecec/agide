import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAgentRuntime } from '../runtime/InMemoryAgentRuntime';
import { SWARM_APPROVAL_ORIGIN, type SwarmCaller, type SwarmStatus } from '../types';
import type { PersistentSwarmManager } from './PersistentSwarmManager';
import { scratchSwarm } from './swarmManagerContract';
import { SwarmStore } from './SwarmStore';
import { createRig, type ManagerRig } from './testRig';

const UI: SwarmCaller = { kind: 'ui' };
let rig: ManagerRig;
afterEach(async () => {
  await rig?.close();
});

const until = async (manager: PersistentSwarmManager, swarmId: string, check: (status: SwarmStatus) => boolean, what: string): Promise<SwarmStatus> => {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const status = manager.status(swarmId, UI);
    if (check(status)) return status;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}; ${JSON.stringify(status.agents.map((agent) => [agent.name, agent.state, agent.reason]))} swarm ${status.state}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** The runtime knows a session id after it ran once, as the CLI does after a crash. */
async function registerKnown(runtime: InMemoryAgentRuntime, sessionId: string): Promise<void> {
  await runtime.launch({
    sessionId,
    folderId: 'f',
    title: 't',
    cwd: '.',
    model: 'haiku',
    effort: 'low',
    permissionMode: 'auto',
    maxBudgetUsd: 1,
    maxTurnsPerMessage: 1,
    connectors: false,
    denyRules: [],
    addDirs: [],
    firstMessage: '/text x',
  });
  await runtime.end(sessionId);
}

describe('persistence and restart', () => {
  it('keeps swarms, agent rows and spend across a restart and shows finished swarms as they were', async () => {
    rig = createRig();
    const swarm = await rig.manager.start(
      {
        definition: scratchSwarm([
          { name: 'a', prompt: '/cost 0.3\n/text done a' },
          { name: 'b', dependsOn: ['a'], prompt: '/text done b' },
        ]),
      },
      UI,
    );
    const before = await until(rig.manager, swarm.swarmId, (s) => s.state === 'done', 'done');
    await rig.manager.shutdown();
    const restarted = rig.restart();
    const after = restarted.status(swarm.swarmId, UI);
    expect(after.state, 'the finished swarm stays done').toBe('done');
    expect(
      after.agents.map((agent) => [agent.name, agent.state, agent.sessionId]),
      'agents and their sessions',
    ).toEqual(before.agents.map((agent) => [agent.name, agent.state, agent.sessionId]));
    expect(after.agents[0]!.spend.reportedUsd, 'the reported spend is restored').toBeGreaterThanOrEqual(0.3);
    expect(after.budget.reportedUsd, 'and counts in the swarm budget').toBeGreaterThanOrEqual(0.3);
    expect(
      (await restarted.results(swarm.swarmId, {}, UI)).agents.map((agent) => agent.text),
      'the result text is restored',
    ).toEqual(['done a', 'done b']);
    expect(restarted.list({}, UI)[0]?.counts.done, 'the list shows the counts').toBe(2);
  });

  it('pauses a swarm on quit, keeps queued agents queued, expires open approvals, and resumes nothing by itself', async () => {
    rig = createRig();
    rig.cap = 1;
    const swarm = await rig.manager.start(
      {
        definition: scratchSwarm([
          { name: 'a', prompt: '/tool Bash {"command":"ls"}' },
          { name: 'b', prompt: '/text b' },
        ]),
      },
      UI,
    );
    await until(rig.manager, swarm.swarmId, (s) => s.agents[0]!.state === 'waiting', 'waiting');
    await rig.manager.shutdown();
    expect(rig.inbox.list({ kinds: ['approval'] })[0], 'the open approval expired').toMatchObject({ state: 'done', resolution: 'expired', origin: SWARM_APPROVAL_ORIGIN });
    const restarted = rig.restart();
    const status = restarted.status(swarm.swarmId, UI);
    expect(status.state, 'paused').toBe('paused');
    expect(
      status.agents.map((agent) => [agent.state, agent.interruptedBy, agent.queuedFor]),
      'a interrupted by quit, b queued for the pause',
    ).toEqual([
      ['interrupted', 'quit', undefined],
      ['queued', undefined, 'pause'],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rig.runtime.launches.length, 'no process started after the restart').toBe(1);
    await restarted.send(swarm.swarmId, { message: '/text resumed' }, UI);
    const done = await until(restarted, swarm.swarmId, (s) => s.state === 'done', 'resumed and done');
    expect(
      done.agents.map((agent) => agent.state),
      'both finished',
    ).toEqual(['done', 'done']);
    expect(rig.runtime.launches[1]?.sessionId, 'a was resumed on its session').toBe(rig.runtime.launches[0]?.sessionId);
    expect(rig.runtime.launches[1]?.firstMessage, 'a quit that interrupted cleanly needs no crash note').toBe('/text resumed');
  });

  it('after a crash, marks running agents interrupted by crash, pauses the swarm, expires approvals, and ends an orphan that names the session', async () => {
    rig = createRig();
    const swarm = await rig.manager.start(
      {
        definition: scratchSwarm([
          { name: 'a', prompt: '/tool Bash {"command":"ls"}' },
          { name: 'b', prompt: '/sleep 5000' },
        ]),
      },
      UI,
    );
    await until(rig.manager, swarm.swarmId, (s) => s.agents[0]!.state === 'waiting' && s.agents[1]!.state === 'running', 'both busy');
    const [a, b] = rig.manager.status(swarm.swarmId, UI).agents;
    const terminated: number[] = [];
    const fresh = new InMemoryAgentRuntime();
    const pids = new Map<number, string>();
    const row = new SwarmStore(rig.db).agents(swarm.swarmId);
    row.forEach((r) => r.pid !== null && r.session_id !== null && pids.set(r.pid, `claude -p --session-id ${r.session_id}`));
    expect(pids.size, 'the rows hold the pids of both processes').toBe(2);
    const restarted = rig.restart({
      runtime: fresh,
      processes: { alive: (pid) => pid === row[0]!.pid, commandLine: (pid) => pids.get(pid), terminate: (pid) => terminated.push(pid) },
    });
    const status = restarted.status(swarm.swarmId, UI);
    expect(status.state, 'paused').toBe('paused');
    expect(
      status.agents.map((agent) => [agent.name, agent.state, agent.interruptedBy]),
      'interrupted by crash',
    ).toEqual([
      ['a', 'interrupted', 'crash'],
      ['b', 'interrupted', 'crash'],
    ]);
    expect(terminated, 'only the live process that names the session is ended').toEqual([row[0]!.pid]);
    expect(rig.inbox.list({ kinds: ['approval'] })[0], 'the open approval expired').toMatchObject({ state: 'done', resolution: 'expired' });
    await registerKnown(fresh, a!.sessionId!);
    await registerKnown(fresh, b!.sessionId!);
    await restarted.send(swarm.swarmId, { message: '/text carry on' }, UI);
    await until(restarted, swarm.swarmId, (s) => s.state === 'done', 'both resumed');
    expect(
      fresh.launches.slice(-2).map((launch) => launch.firstMessage),
      'a crashed turn gets the note about the working directory before the message',
    ).toEqual(Array(2).fill('Agide was closed during your last turn. Check the state of your working directory before you continue.\n\n/text carry on'));
    expect(a!.sessionId, 'a keeps its session for a later resume').toBeDefined();
    await fresh.dispose();
  });

  it('leaves alone a live process whose command line does not name the session, as after a reused pid', async () => {
    rig = createRig();
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }]) }, UI);
    const row = new SwarmStore(rig.db).agents(swarm.swarmId)[0]!;
    const terminated: number[] = [];
    rig.restart({ runtime: new InMemoryAgentRuntime(), processes: { alive: () => true, commandLine: () => 'vim notes.txt', terminate: (pid) => terminated.push(pid) } });
    expect(terminated, 'a process of something else is not signalled').toEqual([]);
    expect(row.pid, 'the row did hold a pid').not.toBeNull();
  });

  it('refuses a database that a newer build migrated further and records the migration steps', () => {
    rig = createRig();
    const rows = rig.db.prepare("SELECT version FROM schema_versions WHERE module = 'swarm'").get() as { version: number };
    expect(rows.version, 'the swarm module is at its latest migration').toBe(2);
    expect(
      () =>
        rig.db
          .prepare(
            "INSERT INTO swarm_agents (swarm_id, name, position, state, model, effort, permission_mode, workspace, queued_at) VALUES ('nope', 'a', 0, 'queued', 'm', 'low', 'auto', 'scratch', 'now')",
          )
          .run(),
      'a row without its swarm',
    ).toThrow();
  });

  it('rejects rows the design forbids: a running agent without a session, an ended agent without an end time', async () => {
    rig = createRig();
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/text x' }]) }, UI);
    await until(rig.manager, swarm.swarmId, (s) => s.state === 'done', 'done');
    const insert = (state: string, session: string | null, ended: string | null) =>
      rig.db
        .prepare(
          `INSERT INTO swarm_agents (swarm_id, name, position, state, session_id, model, effort, permission_mode, workspace, queued_at, ended_at) VALUES (?, 'x', 1, ?, ?, 'm', 'low', 'auto', 'scratch', 'now', ?)`,
        )
        .run(swarm.swarmId, state, session, ended);
    expect(() => insert('running', null, null), 'a running agent without a session').toThrow();
    expect(() => insert('done', 's-x', null), 'an ended agent without an end time').toThrow();
    expect(() => insert('queued', null, null), 'a queued agent without a session').not.toThrow();
  });

  it('stops an agent whose session was closed from outside and drops its retry', async () => {
    rig = createRig();
    const swarm = await rig.manager.start(
      {
        definition: scratchSwarm([
          { name: 'a', prompt: '/sleep 5000' },
          { name: 'b', dependsOn: ['a'], prompt: 'x' },
        ]),
      },
      UI,
    );
    const sessionId = rig.manager.status(swarm.swarmId, UI).agents[0]!.sessionId!;
    await rig.manager.sessionClosed(sessionId);
    await rig.manager.sessionClosed('unknown-session');
    const status = await until(rig.manager, swarm.swarmId, (s) => s.state === 'failed' || s.state === 'stopped', 'swarm ended');
    expect(
      status.agents.map((agent) => [agent.state, agent.reason]),
      'a stopped by the user, b follows the policy',
    ).toEqual([
      ['stopped', 'user'],
      ['failed', 'dependency'],
    ]);
  });

  it('pauses every running swarm when the plan reports a limit, alerts on a warning without pausing, and raises one alert per window', async () => {
    rig = createRig();
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }]) }, UI);
    const sessionId = rig.manager.status(swarm.swarmId, UI).agents[0]!.sessionId!;
    const emit = (info: Record<string, unknown>) => (rig.runtime as unknown as { emit(event: unknown): void }).emit({ type: 'rate_limit', sessionId, info });
    emit({ status: 'allowed' });
    expect(rig.manager.status(swarm.swarmId, UI).state, 'an allowed status changes nothing').toBe('running');
    emit({ status: 'allowed_warning', rateLimitType: 'seven_day', resetsAt: 1_800_000_000 });
    expect(rig.manager.status(swarm.swarmId, UI).state, 'a warning that still allows requests does not pause').toBe('running');
    expect(rig.inbox.list({ kinds: ['alert'] }).map((item) => [item.dedupeKey, item.message]), 'the warning is an alert that says nothing paused').toEqual([['swarm:rate:seven_day:1800000000', 'The plan reports allowed_warning for the seven_day window; swarms keep running']]);
    emit({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_900_000_000 });
    await until(rig.manager, swarm.swarmId, (s) => s.state === 'paused' && s.agents[0]!.state === 'interrupted', 'paused');
    expect(
      rig.inbox.list({ kinds: ['alert'] }).map((item) => item.dedupeKey),
      'the alert is keyed by window and reset time',
    ).toEqual(expect.arrayContaining(['swarm:rate:five_hour:1900000000', 'swarm:rate:seven_day:1800000000']));
  });

  it('does not charge the time a swarm was paused across a restart to its wall clock when it resumes', async () => {
    rig = createRig({ timers: 'manual' });
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }], { budget: { usdTotal: 1, wallClockMinutes: 5 } }) }, UI);
    rig.clock.advance(60_000);
    await rig.manager.shutdown();
    rig.clock.advance(3 * 60 * 60_000);
    const restarted = rig.restart();
    expect(restarted.status(swarm.swarmId, UI).budget.wallClockMs, 'the clock stopped at the quit').toBeCloseTo(60_000, -3);
    await restarted.send(swarm.swarmId, { message: '/sleep 5000' }, UI);
    rig.clock.advance(5_000);
    expect(restarted.status(swarm.swarmId, UI), 'a resumed swarm has used its earlier minute plus the new seconds, not the hours it was closed').toMatchObject({
      state: 'running',
      budget: { wallClockMs: expect.closeTo(65_000, -3) },
    });
  });

  it('sees the agent of a session for the commands, with its depth and may-start flag', async () => {
    rig = createRig();
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000', mayStartSwarms: true }]) }, UI);
    const sessionId = rig.manager.status(swarm.swarmId, UI).agents[0]!.sessionId!;
    expect(rig.manager.agentOf(sessionId), 'the agent of the session').toEqual({ swarmId: swarm.swarmId, agent: 'a', depth: 1, mayStartSwarms: true });
    expect(rig.manager.agentOf('someone-else'), 'a session that is no agent').toBeUndefined();
  });
});

describe('swarms whose tree folder is gone', () => {
  it('stay hidden from sessions after a restart and stay visible to the user', async () => {
    rig = createRig();
    rig.folders.add('p');
    const caller: SwarmCaller = { kind: 'session', sessionId: 'caller', folderId: 'p', depth: 0, permissionMode: 'auto' };
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'w', prompt: '/text done' }]) }, caller);
    await until(rig.manager, swarm.swarmId, (status) => status.state === 'done', 'swarm done');
    rig.db.prepare('UPDATE swarms SET folder_id = NULL WHERE id = ?').run(swarm.swarmId);
    const restarted = rig.restart();
    expect(() => restarted.status(swarm.swarmId, caller), 'a session finds nothing without a folder to be inside of').toThrowError(expect.objectContaining({ code: 'not_found' }));
    expect(restarted.list({ limit: 10 }, caller), 'the session list is empty').toEqual([]);
    expect(restarted.status(swarm.swarmId, UI).state, 'the user still sees the swarm').toBe('done');
  });
});
