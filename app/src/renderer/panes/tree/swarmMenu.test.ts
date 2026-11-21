import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../../core/tree/types';
import { agentStatus, swarmStatus } from '../swarm/swarmFixtures';

const calls: unknown[][] = [];
let swarms: ReturnType<typeof swarmStatus>[] = [];

vi.mock('../swarm/useSwarms', () => ({ currentSwarms: () => swarms }));
vi.mock('../swarm/swarmActions', () => ({
  pauseSwarm: (...args: unknown[]) => calls.push(['pause', ...args]),
  resumeSwarm: (...args: unknown[]) => calls.push(['resume', ...args]),
  interruptAgent: (...args: unknown[]) => calls.push(['interrupt', ...args]),
}));
vi.mock('../swarm/swarmDialogStore', () => ({ openSwarmDialog: (request: unknown) => calls.push(['dialog', request]) }));
vi.mock('../swarm/openSwarmPane', () => ({ openSwarmPane: (...args: unknown[]) => calls.push(['pane', ...args]) }));

const { swarmMenuEntries } = await import('./swarmMenu');

const folder = (id: string): TreeNode => ({ id, kind: 'folder', parentId: null, title: 'f', order: 0 }) as TreeNode;
const leaf = (surfaceId: string, surfaceType = 'claude-session'): TreeNode => ({ id: `leaf-${surfaceId}`, kind: 'leaf', parentId: 'f', title: 'l', order: 0, surfaceType, surfaceId }) as TreeNode;
const labels = (entries: { label: string }[]) => entries.map((entry) => entry.label);

beforeEach(() => {
  calls.length = 0;
  swarms = [swarmStatus('s1', [agentStatus('a', 'running'), agentStatus('b', 'queued')])];
});

describe('swarm folder menu', () => {
  it('lists the group entries for the folder of a swarm, with Pause enabled only while it runs', () => {
    const entries = swarmMenuEntries(folder('folder-s1'));
    expect(labels(entries), 'entries of a running swarm').toEqual(['Pause swarm', 'Resume swarm', 'Results', 'Show definition', 'Stop swarm…']);
    expect(entries.map((entry) => entry.disabled === true), 'pause and stop allowed, resume not').toEqual([false, true, false, false, false]);
    expect(entries[4]!.danger, 'stop is marked as dangerous').toBe(true);
  });

  it('enables Resume and disables Pause and Stop for a swarm that finished', () => {
    swarms = [swarmStatus('s1', [agentStatus('a', 'done')], { state: 'done' })];
    expect(swarmMenuEntries(folder('folder-s1')).map((entry) => entry.disabled === true), 'a done swarm allows neither pause, resume nor stop').toEqual([true, true, false, false, true]);
    swarms = [swarmStatus('s1', [agentStatus('a', 'interrupted')], { state: 'paused' })];
    expect(swarmMenuEntries(folder('folder-s1')).map((entry) => entry.disabled === true), 'a paused swarm resumes and stops').toEqual([true, false, false, false, false]);
  });

  it('runs the action each entry names', () => {
    const entries = swarmMenuEntries(folder('folder-s1'));
    for (const entry of entries) entry.run();
    expect(calls, 'each entry calls its action with the swarm').toEqual([
      ['pause', 's1'],
      ['resume', 's1'],
      ['pane', 's1'],
      ['dialog', { kind: 'definition', swarmId: 's1' }],
      ['dialog', { kind: 'stop-swarm', swarmId: 's1' }],
    ]);
  });

  it('adds nothing to a folder that is not a swarm folder', () => {
    expect(swarmMenuEntries(folder('plain')), 'an ordinary folder').toEqual([]);
  });
});

describe('swarm agent menu', () => {
  it('lists the agent entries for the leaf of an agent session', () => {
    const entries = swarmMenuEntries(leaf('session-a'));
    expect(labels(entries), 'entries of a running agent').toEqual(['Send message…', 'Interrupt', 'Open swarm', 'Stop agent…']);
    expect(entries.map((entry) => entry.disabled === true), 'a running agent allows everything').toEqual([false, false, false, false]);
    for (const entry of entries) entry.run();
    expect(calls, 'each entry names the swarm and the agent').toEqual([
      ['dialog', { kind: 'send', swarmId: 's1', agent: 'a' }],
      ['interrupt', 's1', 'a'],
      ['pane', 's1'],
      ['dialog', { kind: 'stop-agent', swarmId: 's1', agent: 'a' }],
    ]);
  });

  it('disables Send message and Interrupt for a queued agent and keeps Stop', () => {
    expect(swarmMenuEntries(leaf('session-b')).map((entry) => entry.disabled === true), 'a queued agent can only be stopped or shown').toEqual([true, true, false, false]);
  });

  it('adds nothing to a leaf that is not a session, or a session of no swarm', () => {
    expect(swarmMenuEntries(leaf('session-a', 'browser-tab')), 'a leaf of another surface').toEqual([]);
    expect(swarmMenuEntries(leaf('unknown')), 'a session outside every swarm').toEqual([]);
  });
});
