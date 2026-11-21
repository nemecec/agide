// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SwarmResults } from '../../../core/swarm/types';
import { click, setValue } from '../../testing/dom';
import { installFakeApi, type FakeApi } from '../../testing/fakeApi';
import { flush, render, type Rendered } from '../../testing/render';
import { DialogRoot } from '../../ui/Dialog';
import { resetAgentsFeeds } from '../agents/useAgents';
import { SwarmActionDialogs } from './SwarmActionDialogs';
import { SwarmPane } from './SwarmPane';
import { agentStatus, swarmAnswers, swarmStatus } from './swarmFixtures';
import { closeSwarmDialog } from './swarmDialogStore';
import { resetSwarmFeed } from './useSwarms';

let rendered: Rendered | undefined;
let fake: FakeApi;

afterEach(async () => {
  closeSwarmDialog();
  await rendered?.unmount();
  rendered = undefined;
  resetSwarmFeed();
  resetAgentsFeeds();
});

const results: SwarmResults = {
  swarmId: 's1',
  agents: [
    { name: 'impl', state: 'done', text: '<b>Added</b> the checks', branch: 'agide/swarm-s1/impl', commits: [{ sha: 'a', subject: 'Add checks' }], numstat: [{ path: 'src/a.ts', added: 10, removed: 2 }], outsideOwns: ['README.md'], overlapsWith: ['tests'], editedInputs: false },
    { name: 'tests', state: 'failed', reason: 'agent-budget', commits: [], numstat: [], outsideOwns: [], overlapsWith: [], editedInputs: true, conflict: 'a.ts' },
    { name: 'review', state: 'queued', commits: [], numstat: [], outsideOwns: [], overlapsWith: [], editedInputs: false },
  ],
};

async function mount(swarm = swarmStatus('s1', [agentStatus('impl', 'running'), agentStatus('tests', 'queued', { queuedFor: 'slot' })]), config: Record<string, unknown> = { swarmId: 's1' }, extra: Record<string, unknown> = {}) {
  fake = installFakeApi({ ...swarmAnswers([swarm]), agents_list: { agents: [], waitingSessions: [], settings: { removeDoneAfterSeconds: 10, removeFailedAfterSeconds: 300, maxConcurrentAppStarted: 4 } }, swarm_results: results, swarm_interrupt: {}, swarm_send: {}, swarm_stop: {}, ...extra });
  rendered = await render(createElement(DialogRoot, { open: true, onOpenChange: () => undefined, children: [createElement(SwarmPane, { key: 'pane', instanceId: 'swarm-1', config, inputs: {} }), createElement(SwarmActionDialogs, { key: 'dialogs' })] }));
}
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

describe('SwarmPane', () => {
  it('shows the goal, the state word, the tally, the budget with its estimate label and the time against the limit', async () => {
    await mount();
    expect(byId('swarm-goal')?.textContent, 'goal').toBe('Add input validation to the signup form');
    expect(byId('swarm-state')?.textContent, 'state word').toBe('running');
    expect(byId('swarm-tally')?.textContent, 'tally').toBe('1 running, 1 queued');
    expect(byId('budget-meter-label')?.textContent, 'budget label says list-price equivalent').toContain('list-price equivalent, not billed');
    expect(byId('swarm-clock')?.textContent, 'time against the limit').toBe('5 of 60 minutes');
  });

  it('lists each agent with state word and reason, model and effort, turns, estimated spend and open approvals', async () => {
    await mount();
    const rows = all('swarm-agent-row');
    expect(rows.map((row) => row.getAttribute('data-agent')), 'rows in order').toEqual(['impl', 'tests']);
    expect(rows[1]!.textContent, 'queued reason').toContain('waiting for a free slot');
    expect(rows[0]!.textContent, 'model, tier, effort and mode').toContain('sonnet');
    expect(rows[0]!.textContent, 'spend').toContain('0.40 USD');
    expect(document.querySelector('th')?.textContent, 'table has headers').toBe('Agent');
    expect(byId('swarm-agents')?.textContent, 'spend column says estimate').toContain('Spend (estimate)');
  });

  it('enables Pause while running, calls swarm_interrupt for the group, and shows the failure of a command', async () => {
    await mount(undefined, { swarmId: 's1' }, { swarm_interrupt: { ok: false, error: { code: 'failed', message: 'the manager is busy' } } });
    expect((byId('swarm-pause') as HTMLButtonElement).disabled, 'pause enabled while running').toBe(false);
    expect((byId('swarm-resume') as HTMLButtonElement).disabled, 'resume disabled while running').toBe(true);
    await click(byId('swarm-pause')!);
    expect(fake.invoke, 'group pause').toHaveBeenCalledWith('swarm_interrupt', { swarmId: 's1' });
    expect(byId('swarm-error')?.textContent, 'the failure is shown').toBe('the manager is busy');
  });

  it('asks for confirmation before stopping the group and stops only after Stop swarm', async () => {
    await mount();
    await click(byId('swarm-stop')!);
    expect(byId('swarm-stop-dialog'), 'the confirmation shows').not.toBeNull();
    expect(fake.invoke.mock.calls.some((call) => call[0] === 'swarm_stop'), 'nothing stopped yet').toBe(false);
    await click(byId('swarm-stop-confirm')!);
    expect(fake.invoke, 'group stop').toHaveBeenCalledWith('swarm_stop', { swarmId: 's1' });
    expect(byId('swarm-stop-dialog'), 'the dialog closed').toBeNull();
  });

  it('keeps the dialog open and says why when the stop fails', async () => {
    await mount(undefined, { swarmId: 's1' }, { swarm_stop: { ok: false, error: { code: 'failed', message: 'cannot stop now' } } });
    await click(byId('swarm-stop')!);
    await click(byId('swarm-stop-confirm')!);
    expect(byId('swarm-dialog-error')?.textContent, 'error in the dialog').toBe('cannot stop now');
  });

  it('stops one agent after confirmation, interrupts one agent at once, and sends a message with the interrupt switch', async () => {
    await mount();
    const row = all('swarm-agent-row')[0]!;
    await click(row.querySelector('[data-testid="swarm-agent-interrupt"]')!);
    expect(fake.invoke, 'interrupt one agent').toHaveBeenCalledWith('swarm_interrupt', { swarmId: 's1', agent: 'impl' });
    await click(row.querySelector('[data-testid="swarm-agent-stop"]')!);
    await click(byId('swarm-stop-confirm')!);
    expect(fake.invoke, 'stop one agent').toHaveBeenCalledWith('swarm_stop', { swarmId: 's1', agent: 'impl' });
    await click(row.querySelector('[data-testid="swarm-agent-send"]')!);
    expect((byId('swarm-send-confirm') as HTMLButtonElement).disabled, 'an empty message cannot be sent').toBe(true);
    await setValue(byId('swarm-send-text') as HTMLTextAreaElement, ' Use the shared validator ');
    await click(document.querySelector('[data-testid="swarm-send-now"]')!);
    await click(byId('swarm-send-confirm')!);
    expect(fake.invoke, 'message with now').toHaveBeenCalledWith('swarm_send', { swarmId: 's1', agent: 'impl', message: 'Use the shared validator', now: true });
  });

  it('disables the row actions that the agent state does not allow', async () => {
    await mount();
    const queued = all('swarm-agent-row')[1]!;
    const state = (id: string) => (queued.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).disabled;
    expect([state('swarm-agent-send'), state('swarm-agent-interrupt'), state('swarm-agent-stop')], 'queued agent: only stop').toEqual([true, true, false]);
  });

  it('shows a Banner with Resume for a paused swarm, and calls swarm_send without an agent', async () => {
    await mount(swarmStatus('s1', [agentStatus('impl', 'interrupted', { interruptedBy: 'pause' })], { state: 'paused' }));
    expect(byId('swarm-banner')?.textContent, 'paused banner').toContain('The swarm is paused.');
    expect((byId('swarm-pause') as HTMLButtonElement).disabled, 'pause off').toBe(true);
    await click(byId('swarm-banner-resume')!);
    expect(fake.invoke, 'resume').toHaveBeenCalledWith('swarm_send', { swarmId: 's1' });
  });

  it('says why a stopped swarm stopped, offers no group Resume that would do nothing, and points to a message per agent', async () => {
    await mount(swarmStatus('s1', [agentStatus('impl', 'stopped', { reason: 'swarm-budget' })], { state: 'stopped', stopReason: 'swarm-budget' }));
    expect(byId('swarm-banner')?.textContent, 'stopped banner with the reason').toContain('the swarm spent its budget');
    expect(byId('swarm-banner')?.textContent, 'the banner names what continues an agent').toContain('Send a message to an agent');
    expect(byId('swarm-banner-resume'), 'no Resume button in the banner').toBeNull();
    expect((byId('swarm-resume') as HTMLButtonElement).disabled, 'no Resume in the toolbar').toBe(true);
    expect((all('swarm-agent-row')[0]!.querySelector('[data-testid="swarm-agent-send"]') as HTMLButtonElement).disabled, 'an ended agent can be messaged').toBe(false);
    await rendered!.unmount();
    await mount(swarmStatus('s1', [agentStatus('impl', 'stopped')], { state: 'stopped' }));
    expect(byId('swarm-banner')?.textContent, 'a stop without a reason').toContain('The swarm was stopped.');
  });

  it('lists the warnings of the swarm', async () => {
    await mount(swarmStatus('s1', [agentStatus('impl')], { warnings: ['impl runs on mid under maxTier'] }));
    expect(byId('swarm-warning')?.textContent, 'warning notice').toBe('impl runs on mid under maxTier');
  });

  it('shows the results of ended agents as plain text with their warnings, and leaves queued agents out', async () => {
    await mount();
    await act(async () => byId('swarm-tab-results')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    await flush();
    const cards = all('swarm-result');
    expect(cards.map((card) => card.getAttribute('data-agent')), 'ended agents only').toEqual(['impl', 'tests']);
    expect(byId('swarm-result-text')?.textContent, 'agent text stays text').toBe('<b>Added</b> the checks');
    expect(byId('swarm-result-text')?.querySelector('b'), 'no markup from agent text').toBeNull();
    expect(cards[0]!.textContent, 'files and branch').toContain('1 file, +10 −2');
    expect(cards[0]!.textContent, 'outside owns warning').toContain('Changed files outside its owned paths: README.md');
    expect(cards[1]!.textContent, 'conflict and edit warnings').toContain('Merge conflict: a.ts');
    expect(cards[1]!.textContent, 'reason').toContain('the agent spent its budget');
  });

  it('says so when no agent has ended and when the results fail to load', async () => {
    await mount(undefined, { swarmId: 's1' }, { swarm_results: { swarmId: 's1', agents: [] } });
    await act(async () => byId('swarm-tab-results')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    await flush();
    expect(byId('swarm-results-empty')?.textContent, 'empty state').toContain('No results yet');
    await rendered!.unmount();
    await mount(undefined, { swarmId: 's1' }, { swarm_results: { ok: false, error: { code: 'failed', message: 'no results available' } } });
    await act(async () => byId('swarm-tab-results')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    await flush();
    expect(byId('swarm-results-error')?.textContent, 'error state').toBe('no results available');
  });

  it('shows the definition as JSON in a dialog', async () => {
    await mount();
    await click(byId('swarm-show-definition')!);
    expect(JSON.parse(byId('swarm-definition-text')!.textContent ?? '').goal, 'the stored definition').toBe('Add input validation to the signup form');
  });

  it('shows empty states: no swarm named, a swarm that is not listed, and a swarm still loading', async () => {
    await mount(undefined, {});
    expect(document.body.textContent, 'no swarm').toContain('No swarm selected');
    await rendered!.unmount();
    await mount(undefined, { swarmId: 'gone' });
    expect(byId('swarm-missing')?.textContent, 'unknown swarm').toContain('no longer listed');
    await rendered!.unmount();
    fake = installFakeApi({ swarm_list: () => new Promise(() => undefined), agents_list: {} });
    rendered = await render(createElement(SwarmPane, { instanceId: 'x', config: { swarmId: 's1' }, inputs: {} }));
    expect(byId('swarm-loading')?.textContent, 'loading').toContain('Loading the swarm');
  });
});
