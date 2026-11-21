import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAgentRuntime } from '../runtime/InMemoryAgentRuntime';
import { RuntimeError, type AgentLaunchSpec } from '../runtime/types';
import type { SwarmCaller } from '../types';
import { scratchSwarm } from './swarmManagerContract';
import { createRig, type ManagerRig } from './testRig';

const UI: SwarmCaller = { kind: 'ui' };

let rig: ManagerRig;
afterEach(async () => {
  await rig?.close();
});

/** A runtime whose launch waits until the test opens the gate, as a slow provider start does. */
class GatedRuntime extends InMemoryAgentRuntime {
  open: () => void = () => undefined;
  /** Resolves when a launch waits at the gate. */
  reached: () => void = () => undefined;
  readonly waiting = new Promise<void>((resolve) => (this.reached = resolve));
  private readonly gate = new Promise<void>((resolve) => (this.open = resolve));

  override async launch(spec: AgentLaunchSpec): Promise<void> {
    this.reached();
    await this.gate;
    await super.launch(spec);
  }
}

/** A runtime whose stop of one session takes a while, so the agent is still ending when the test acts. */
class SlowStopRuntime extends InMemoryAgentRuntime {
  release: () => void = () => undefined;
  private readonly slow = new Promise<void>((resolve) => (this.release = resolve));
  slowSession: string | undefined;

  override async stop(sessionId: string): Promise<void> {
    if (sessionId === this.slowSession) await this.slow;
    await super.stop(sessionId);
  }
}

const stateOf = (name: string, swarmId: string) => {
  const agent = rig.manager.status(swarmId, UI).agents.find((entry) => entry.name === name)!;
  return [agent.state, agent.reason];
};

describe('a stop that a message overtakes', () => {
  it('ends the agent as stopped by the user and never retries it, and refuses the message', async () => {
    rig = createRig({ overrides: { retryDelayMs: 30_000 } });
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }]) }, UI);
    const stopping = rig.manager.stop(swarm.swarmId, { agent: 'a' }, UI);
    await expect(rig.manager.send(swarm.swarmId, { agent: 'a', message: 'go on' }, UI), 'a message to an agent that is being stopped').rejects.toMatchObject({ code: 'refused' });
    await stopping;
    expect(stateOf('a', swarm.swarmId), 'the stop held').toEqual(['stopped', 'user']);
  });

  it('keeps the budget ending of an agent when a message arrives while it is ending', async () => {
    rig = createRig({ overrides: { retryDelayMs: 30_000 } });
    const script = `${Array.from({ length: 90 }, () => '/text step').join('\n')}\n/sleep 60000`;
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: script }], { budget: { usdTotal: 5, usdPerAgent: 0.05 } }) }, UI);
    const deadline = Date.now() + 4_000;
    while (stateOf('a', swarm.swarmId)[0] === 'running' && Date.now() < deadline) {
      await rig.manager.send(swarm.swarmId, { agent: 'a', message: 'more' }, UI).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(stateOf('a', swarm.swarmId), 'the agent ended at its budget and was not relabelled or retried').toEqual(['failed', 'agent-budget']);
  });
});

describe('a group resume while one agent is being stopped', () => {
  it('resumes the other agents and does not fail on the one that is ending', async () => {
    const runtime = new SlowStopRuntime();
    rig = createRig({ overrides: { runtime, retryDelayMs: 30_000 } });
    const swarm = await rig.manager.start(
      {
        definition: scratchSwarm([
          { name: 'a', prompt: '/sleep 5000' },
          { name: 'b', prompt: '/sleep 5000' },
        ]),
      },
      UI,
    );
    await rig.manager.interrupt(swarm.swarmId, {}, UI);
    const states = () => rig.manager.status(swarm.swarmId, UI).agents.map((agent) => agent.state);
    expect(states(), 'both agents are interrupted by the pause').toEqual(['interrupted', 'interrupted']);
    runtime.slowSession = rig.manager.status(swarm.swarmId, UI).agents[0]!.sessionId;
    const stopping = rig.manager.stop(swarm.swarmId, { agent: 'a' }, UI);
    await expect(rig.manager.send(swarm.swarmId, {}, UI), 'the group resume passes the agent that is ending').resolves.toBeUndefined();
    runtime.release();
    await stopping;
    expect(stateOf('a', swarm.swarmId), 'the stop held').toEqual(['stopped', 'user']);
    expect(stateOf('b', swarm.swarmId)[0], 'the other agent was resumed').not.toBe('interrupted');
  });
});

describe('a stop during the start of a process', () => {
  it('ends the process that starts afterwards and keeps the agent stopped', async () => {
    const runtime = new GatedRuntime();
    rig = createRig({ overrides: { runtime } });
    const starting = rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }]) }, UI);
    await runtime.waiting;
    const swarmId = rig.manager.list({}, UI)[0]!.id;
    const stopping = rig.manager.stop(swarmId, { agent: 'a' }, UI);
    runtime.open();
    await Promise.all([starting, stopping]);
    const sessionId = rig.manager.status(swarmId, UI).agents[0]!.sessionId!;
    expect(runtime.isLive(sessionId), 'no process is left').toBe(false);
    expect(stateOf('a', swarmId), 'the agent stays stopped, not failed by the exit of the late process').toEqual(['stopped', 'user']);
    await runtime.dispose();
  });

  it('leaves the agent interrupted and the process ended when the app closes during the start', async () => {
    const runtime = new GatedRuntime();
    rig = createRig({ overrides: { runtime } });
    const starting = rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }]) }, UI);
    await runtime.waiting;
    const swarmId = rig.manager.list({}, UI)[0]!.id;
    await rig.manager.shutdown();
    runtime.open();
    await starting;
    const sessionId = rig.manager.status(swarmId, UI).agents[0]!.sessionId!;
    expect(runtime.isLive(sessionId), 'no process is left').toBe(false);
    expect(stateOf('a', swarmId)[0], 'the agent can be resumed later').toBe('interrupted');
    await runtime.dispose();
  });
});

describe('spawn depth', () => {
  it('puts the agents of a swarm the user starts at depth 1, so they cannot start swarms at the default limit', async () => {
    rig = createRig();
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'o', prompt: '/sleep 5000', mayStartSwarms: true }]) }, UI);
    const agent = rig.manager.status(swarm.swarmId, UI).agents[0]!;
    const found = rig.manager.agentOf(agent.sessionId!)!;
    expect(found.depth, 'an agent of a user swarm sits one level below the user').toBe(1);
    await expect(
      rig.manager.start(
        { definition: scratchSwarm([{ name: 'x', prompt: 'x' }]) },
        { kind: 'session', sessionId: agent.sessionId!, folderId: 'p', depth: found.depth, permissionMode: 'auto', swarmAgent: { swarmId: swarm.swarmId, mayStartSwarms: true } },
      ),
      'a start from that agent at a limit of 1',
    ).rejects.toMatchObject({ code: 'limit_reached' });
  });
});

describe('an interrupt the runtime cannot complete', () => {
  it('fails the command and puts the agent back to running, since its turn goes on', async () => {
    rig = createRig();
    const interrupt = rig.runtime.interrupt.bind(rig.runtime);
    rig.runtime.interrupt = async () => {
      throw new RuntimeError('timeout', 'the turn did not end after the interrupt');
    };
    const swarm = await rig.manager.start({ definition: scratchSwarm([{ name: 'a', prompt: '/sleep 5000' }]) }, UI);
    await expect(rig.manager.interrupt(swarm.swarmId, { agent: 'a' }, UI), 'the failure reaches the caller').rejects.toMatchObject({ code: 'timeout' });
    expect(stateOf('a', swarm.swarmId)[0], 'the agent is not shown as interrupted').toBe('running');
    rig.runtime.interrupt = interrupt;
  });
});
