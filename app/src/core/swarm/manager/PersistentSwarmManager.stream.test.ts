import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_CLAUDE_SCRIPT, streamHarness, type StreamHarness } from '../fixtures/streamHarness';
import type { SwarmCaller } from '../types';
import { scratchSwarm } from './swarmManagerContract';
import { createRig, type ManagerRig } from './testRig';

const UI: SwarmCaller = { kind: 'ui' };

let rig: ManagerRig | undefined;
let harness: StreamHarness | undefined;
let steps: string | undefined;
let off: (() => void) | undefined;

afterEach(async () => {
  off?.();
  await rig?.close();
  await harness?.runtime.dispose();
  await harness?.close();
  if (steps !== undefined) rmSync(steps, { recursive: true, force: true });
  rig = undefined;
  harness = undefined;
  steps = undefined;
});

/** The manager over the stream runtime and a real session service, wired as the swarm module wires them. */
async function wired(script: object[], retryDelayMs: number | false) {
  steps = mkdtempSync(join(tmpdir(), 'swarm-steps-'));
  const file = join(steps, 'steps.json');
  writeFileSync(file, JSON.stringify(script));
  harness = await streamHarness({ binary: FAKE_CLAUDE_SCRIPT, env: { FAKE_SCRIPT_FILE: file } });
  rig = createRig({ overrides: { runtime: harness.runtime, retryDelayMs } });
  off = harness.sessions.subscribe((event) => {
    if (event.type === 'session.closed') void rig!.manager.sessionClosed(event.sessionId);
  });
  return rig.manager;
}

describe('a CLI that exits before it writes anything', () => {
  it('fails the agent with the spawn reason and posts a failure item, instead of recording a stop by the user', async () => {
    const manager = await wired([{ exit: 1 }], false);
    const swarm = await manager.start({ definition: scratchSwarm([{ name: 'a', prompt: 'go' }]) }, UI);
    const agent = manager.status(swarm.swarmId, UI).agents[0]!;
    expect([agent.state, agent.reason], 'a failed start, not a stop').toEqual(['failed', 'spawn']);
    expect(manager.status(swarm.swarmId, UI).state, 'the swarm failed').toBe('failed');
    expect(rig!.inbox.list({}).some((item) => item.kind === 'failure'), 'a failure item tells the user').toBe(true);
  });

  it('retries the start once, so the agent waits for its retry', async () => {
    const manager = await wired([{ exit: 1 }], 60_000);
    const swarm = await manager.start({ definition: scratchSwarm([{ name: 'a', prompt: 'go' }]) }, UI);
    const agent = manager.status(swarm.swarmId, UI).agents[0]!;
    expect([agent.state, agent.reason], 'queued for the retry, not stopped by the user').toEqual(['queued', undefined]);
    await manager.stop(swarm.swarmId, {}, UI);
  });
});

describe('a session the user closes while its process starts', () => {
  it('stops the agent as stopped by the user instead of failing and retrying the start', async () => {
    const manager = await wired([{ delayMs: 400 }, { exit: 1 }], 60_000);
    const starting = manager.start({ definition: scratchSwarm([{ name: 'a', prompt: 'go' }]) }, UI);
    const deadline = Date.now() + 3_000;
    while (harness!.sessions.list().length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    await harness!.sessions.close(harness!.sessions.list()[0]!.id);
    const swarm = await starting;
    const agent = manager.status(swarm.swarmId, UI).agents[0]!;
    expect([agent.state, agent.reason], 'a close by the user is a stop, not a failed start that waits for a retry').toEqual(['stopped', 'user']);
  });
});
