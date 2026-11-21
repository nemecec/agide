// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../../core/tree/types';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';
import { flush, render, type Rendered } from '../../testing/render';
import { resetAgentsFeeds } from '../agents/useAgents';
import { SwarmAgentDecorations, SwarmFolderDecorations } from '../tree/SwarmDecorations';
import { swarmMenuEntries } from '../tree/swarmMenu';
import { BudgetMeter } from './BudgetMeter';
import { agentStatus, swarmAnswers, swarmStatus } from './swarmFixtures';
import { closeSwarmDialog } from './swarmDialogStore';
import { currentSwarms, resetSwarmFeed, useSwarmAgent, useSwarmByFolder } from './useSwarms';

let rendered: Rendered | undefined;
let fake: FakeApi;

afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  resetSwarmFeed();
  resetAgentsFeeds();
  closeSwarmDialog();
  vi.useRealTimers();
});

const agentsList = { agents: [], waitingSessions: [], settings: { removeDoneAfterSeconds: 10, removeFailedAfterSeconds: 300, maxConcurrentAppStarted: 4 } };
const swarm = swarmStatus('s1', [agentStatus('impl', 'running'), agentStatus('tests', 'waiting'), agentStatus('review', 'queued', { queuedFor: 'dependencies' })]);

function mount(element: ReturnType<typeof createElement>, answers: Record<string, unknown> = swarmAnswers([swarm])) {
  fake = installFakeApi({ agents_list: agentsList, swarm_interrupt: {}, swarm_send: {}, swarm_stop: {}, layout_get: undefined, ...answers });
  return render(element).then((value) => (rendered = value));
}
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const folder = (id: string): TreeNode => ({ kind: 'folder', id, parentId: null, title: id, order: 0 });
const leaf = (sessionId: string): TreeNode => ({ kind: 'leaf', id: `leaf-${sessionId}`, parentId: 'folder-s1', title: sessionId, order: 0, surfaceType: 'claude-session', surfaceId: sessionId });

describe('BudgetMeter', () => {
  it('draws the bar with the words as its accessible name, and the words beside it unless compact', async () => {
    await mount(createElement(BudgetMeter, { budget: { usdTotal: 3, reportedUsd: 1.2, estimatedUsd: 0.3, reservedUsd: 0.5 } }));
    expect(byId('budget-meter-label')?.textContent, 'label beside the bar').toBe('1.50 of 3.00 USD, list-price equivalent, not billed, 0.30 of it estimated from tokens');
    expect(byId('budget-meter-bar')?.getAttribute('aria-label'), 'the bar names the same state').toBe(byId('budget-meter-label')?.textContent);
    await rendered!.rerender(createElement(BudgetMeter, { budget: { usdTotal: 3, reportedUsd: 2.5, estimatedUsd: 0, reservedUsd: 0 }, compact: true, 'data-testid': 'small' }));
    expect(byId('small-label'), 'compact has no words beside the bar').toBeNull();
    expect(byId('small')?.getAttribute('title'), 'compact keeps the words as its tooltip').toContain('over 80 percent');
    expect(byId('small-bar')?.getAttribute('data-level'), 'the bar level follows the share').toBe('warning');
  });
});

describe('swarm folder decorations', () => {
  it('shows the state word, the budget bar, the waiting marker and the tally of a swarm folder', async () => {
    await mount(createElement(SwarmFolderDecorations, { folderId: 'folder-s1' }));
    expect(byId('swarm-chip')?.textContent, 'state word beside the glyph').toBe('running');
    expect(byId('swarm-folder-decorations')?.getAttribute('title'), 'tooltip tally').toBe('2 running, 1 queued, 1 waiting for an answer');
    expect(byId('swarm-waiting')?.getAttribute('aria-label'), 'waiting marker').toBe('1 waiting for an answer');
    expect(byId('swarm-row-meter')?.getAttribute('title'), 'budget bar words').toContain('list-price equivalent, not billed');
  });

  it('shows no waiting marker when no agent waits', async () => {
    const calm = swarmStatus('s1', [agentStatus('impl', 'running')]);
    await mount(createElement(SwarmFolderDecorations, { folderId: 'folder-s1' }), swarmAnswers([calm]));
    expect(byId('swarm-waiting'), 'no marker').toBeNull();
  });

  it('shows the N of M cap label on the folder that holds swarms and nothing on other folders', async () => {
    await mount(createElement('div', null, createElement(SwarmFolderDecorations, { folderId: 'project' }), createElement(SwarmFolderDecorations, { folderId: 'elsewhere' })));
    expect(byId('swarm-cap')?.textContent, 'running agents against the cap of the setting').toBe('2 of 4 agents running');
    expect(document.querySelectorAll('[data-testid="swarm-cap-decorations"]'), 'one label, on the project folder only').toHaveLength(1);
    expect(document.querySelector('[data-testid="swarm-folder-decorations"]'), 'a project folder is not a swarm folder').toBeNull();
  });

  it('renders nothing while no swarm is known', async () => {
    await mount(createElement(SwarmFolderDecorations, { folderId: 'folder-s1' }), swarmAnswers([]));
    expect(rendered!.container.innerHTML, 'empty').toBe('');
  });
});

describe('swarm agent decorations', () => {
  it('shows the run-state icon and word of an agent leaf, with the reason as a tooltip', async () => {
    await mount(createElement('div', null, createElement(SwarmAgentDecorations, { sessionId: 'session-review' }), createElement(SwarmAgentDecorations, { sessionId: 'session-unrelated' })));
    const chips = document.querySelectorAll<HTMLElement>('[data-testid="swarm-agent-chip"]');
    expect(chips, 'only the swarm agent gets a chip').toHaveLength(1);
    expect(chips[0]?.textContent, 'state word').toBe('queued');
    expect(chips[0]?.getAttribute('title'), 'reason').toBe('queued: waiting for earlier agents');
    expect(chips[0]?.getAttribute('data-status'), 'queued has its own glyph kind').toBe('queued');
  });

  it('puts the approval count in the title of a waiting agent', async () => {
    const request = { requestId: 'r1', request: { subtype: 'can_use_tool' as const, tool_name: 'Bash', input: {} }, openedAt: '' };
    const waiting = swarmStatus('s1', [agentStatus('impl', 'waiting', { openApprovals: [request] })]);
    await mount(createElement(SwarmAgentDecorations, { sessionId: 'session-impl' }), swarmAnswers([waiting]));
    expect(byId('swarm-agent-chip')?.getAttribute('title'), 'waiting reason').toBe('waiting: one approval is open');
  });

  it('follows swarm events: a state change reloads the chip', async () => {
    await mount(createElement(SwarmAgentDecorations, { sessionId: 'session-impl' }), swarmAnswers([swarmStatus('s1', [agentStatus('impl', 'running')])]));
    expect(byId('swarm-agent-chip')?.textContent, 'before').toBe('running');
    fake.respond('swarm_status', swarmStatus('s1', [agentStatus('impl', 'failed', { reason: 'agent-budget' })]));
    await act(async () => fake.emit({ type: 'swarm.agent_changed', swarmId: 's1', agent: 'impl', state: 'failed' }));
    await flush();
    expect(byId('swarm-agent-chip')?.textContent, 'after the event').toBe('failed');
  });

  it('reloads on a timer, since the spend moves between events', async () => {
    vi.useFakeTimers();
    await mount(createElement(SwarmAgentDecorations, { sessionId: 'session-impl' }));
    const before = fake.invoke.mock.calls.filter((call) => call[0] === 'swarm_list').length;
    await act(async () => void vi.advanceTimersByTime(3100));
    expect(fake.invoke.mock.calls.filter((call) => call[0] === 'swarm_list').length, 'one more load after the interval').toBe(before + 1);
  });
});

describe('hooks', () => {
  it('find a swarm by its folder and an agent by its session', async () => {
    const Probe = () => {
      const byFolder = useSwarmByFolder('folder-s1');
      const agent = useSwarmAgent('session-tests');
      return createElement('span', { 'data-testid': 'probe' }, `${byFolder?.id}:${agent?.agent.name}`);
    };
    await mount(createElement(Probe));
    expect(byId('probe')?.textContent, 'both lookups').toBe('s1:tests');
    expect(currentSwarms().map((entry) => entry.id), 'the snapshot for code outside components').toEqual(['s1']);
  });

  it('keep the last data when a load fails', async () => {
    await mount(createElement(SwarmAgentDecorations, { sessionId: 'session-impl' }));
    fake.respond('swarm_list', { ok: false, error: { code: 'failed', message: 'down' } });
    await act(async () => fake.emit({ type: 'swarm.changed', swarmId: 's1', state: 'running' }));
    await flush();
    expect(byId('swarm-agent-chip')?.textContent, 'the chip stays').toBe('running');
  });
});

describe('swarm menu entries', () => {
  async function prime(answers = swarmAnswers([swarm])) {
    await mount(createElement(SwarmFolderDecorations, { folderId: 'folder-s1' }), answers);
  }
  const labels = (entries: ReturnType<typeof swarmMenuEntries>) => entries.map((entry) => entry.label);
  const entry = (entries: ReturnType<typeof swarmMenuEntries>, label: string) => entries.find((candidate) => candidate.label === label)!;

  it('offers the group controls on a swarm folder, with only the fitting ones enabled', async () => {
    await prime();
    const entries = swarmMenuEntries(folder('folder-s1'));
    expect(labels(entries), 'folder entries').toEqual(['Pause swarm', 'Resume swarm', 'Results', 'Show definition', 'Stop swarm…']);
    expect([entry(entries, 'Pause swarm').disabled, entry(entries, 'Resume swarm').disabled, entry(entries, 'Stop swarm…').disabled], 'running: pause and stop on, resume off').toEqual([false, true, false]);
    expect(entry(entries, 'Stop swarm…').danger, 'stop is destructive').toBe(true);
    await act(async () => entry(entries, 'Pause swarm').run());
    expect(fake.invoke, 'pause calls swarm_interrupt for the group').toHaveBeenCalledWith('swarm_interrupt', { swarmId: 's1' });
  });

  it('enables Resume on a paused swarm and calls swarm_send without an agent', async () => {
    await prime(swarmAnswers([swarmStatus('s1', [agentStatus('impl', 'interrupted', { interruptedBy: 'pause' })], { state: 'paused' })]));
    const entries = swarmMenuEntries(folder('folder-s1'));
    expect([entry(entries, 'Pause swarm').disabled, entry(entries, 'Resume swarm').disabled], 'paused: resume on, pause off').toEqual([true, false]);
    await act(async () => entry(entries, 'Resume swarm').run());
    expect(fake.invoke, 'resume').toHaveBeenCalledWith('swarm_send', { swarmId: 's1' });
  });

  it('offers the agent controls on an agent leaf', async () => {
    await prime();
    const entries = swarmMenuEntries(leaf('session-impl'));
    expect(labels(entries), 'leaf entries').toEqual(['Send message…', 'Interrupt', 'Open swarm', 'Stop agent…']);
    await act(async () => entry(entries, 'Interrupt').run());
    expect(fake.invoke, 'interrupt one agent').toHaveBeenCalledWith('swarm_interrupt', { swarmId: 's1', agent: 'impl' });
    const queued = swarmMenuEntries(leaf('session-review'));
    expect([entry(queued, 'Send message…').disabled, entry(queued, 'Interrupt').disabled, entry(queued, 'Stop agent…').disabled], 'a queued agent can only be stopped').toEqual([true, true, false]);
  });

  it('returns nothing for nodes outside any swarm', async () => {
    await prime();
    expect(swarmMenuEntries(folder('other')), 'plain folder').toEqual([]);
    expect(swarmMenuEntries(leaf('unknown-session')), 'a session that is no swarm agent').toEqual([]);
    expect(swarmMenuEntries({ kind: 'leaf', id: 'b', parentId: null, title: 'tab', order: 0, surfaceType: 'browser-tab', surfaceId: 'session-impl' }), 'a browser tab').toEqual([]);
  });
});
