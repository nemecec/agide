// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentNodeView } from '../../../core/agents/view';
import type { UsageState } from '../../../core/usage/types';
import { installFakeApi } from '../../testing/fakeApi';
import { flush, render, type Rendered } from '../../testing/render';
import { AgentHistoryPane } from '../AgentHistoryPane';
import { UsagePane } from '../UsagePane';
import { PlanUsage } from '../rail/PlanUsage';
import { AgentRows } from '../tree/AgentRows';
import { SessionDecorations } from '../tree/SessionDecorations';
import { setAgentsView } from './agentsStore';
import { planLine } from './format';
import { resetAgentsFeeds } from './useAgents';

const now = Date.now();
const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();
const tokens = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
const agent = (over: Partial<AgentNodeView>): AgentNodeView => ({ sessionId: 's1', agentKey: 'a1', origin: 'session-started', state: 'running', label: 'Read files', hasTranscript: true, tokens, startedAt: iso(-5000), hidden: false, ...over });
const usageState = (over: Partial<UsageState> = {}): UsageState => ({
  windowMinutes: 5,
  profileWeightedTokensPerMinute: 0,
  ranking: [],
  heat: {},
  folders: {},
  plan: [],
  appStarted: { running: 0, cap: 4 },
  now: iso(0),
  ...over,
});

let mounted: Rendered | undefined;
beforeEach(() => {
  resetAgentsFeeds();
  setAgentsView({ showFinished: false, selected: undefined });
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

const answers = (agents: AgentNodeView[], usage: UsageState = usageState(), waiting: string[] = []) =>
  installFakeApi({
    agents_list: { agents, waitingSessions: waiting, settings: { removeDoneAfterSeconds: 10, removeFailedAfterSeconds: 300, maxConcurrentAppStarted: 4 } },
    usage_state: usage,
  });

describe('tree decorations', () => {
  it('shows the running count, the waiting count, the failed count and the finished tally on the session leaf', async () => {
    answers([
      agent({}),
      agent({ agentKey: 'a2', state: 'waiting' }),
      agent({ agentKey: 'a3', state: 'done', endedAt: iso(-10_000), hidden: true }),
      agent({ agentKey: 'a4', state: 'failed', endedAt: iso(-10_000), hidden: false }),
    ]);
    mounted = await render(createElement(SessionDecorations, { sessionId: 's1' }));
    expect(mounted.container.querySelector('[data-testid=agent-count]')?.textContent, 'running count leaves out the waiting agent').toBe('1 running');
    expect(mounted.container.querySelector('[data-testid=agent-waiting]')?.textContent, 'waiting count').toBe('1 waiting');
    expect(mounted.container.querySelector('[data-testid=agent-failed]')?.textContent, 'failed count is its own marker').toBe('1 failed');
    expect(mounted.container.querySelector('[data-testid=agent-finished]')?.textContent, 'finished tally').toBe('1 finished');
  });

  it('shows nothing for a session without agents, and the waiting marker for a session-level approval', async () => {
    answers([], usageState(), ['s1']);
    mounted = await render(createElement(SessionDecorations, { sessionId: 's1' }));
    expect(mounted.container.querySelector('[data-testid=agent-waiting]'), 'session approval marks the leaf').not.toBeNull();
    expect(mounted.container.querySelector('[data-testid=agent-count]'), 'no count').toBeNull();
  });

  it('draws a heat marker with a text tooltip from the usage state', async () => {
    answers([agent({})], usageState({ heat: { 'session:s1': { share: 0.45, costUsdPerMinute: 0.12, level: 2 } } }));
    mounted = await render(createElement(SessionDecorations, { sessionId: 's1' }));
    const marker = mounted.container.querySelector('[data-testid=session-heat]');
    expect(marker?.getAttribute('data-level'), 'level').toBe('2');
    expect(marker?.getAttribute('title'), 'tooltip says it is an estimate').toBe('about 0.12 USD per minute, 45 percent of the profile, estimated over the last 5 minutes');
  });

  it('lists the agents of the session, hides finished nodes whose delay passed and shows them with the filter', async () => {
    answers([agent({}), agent({ agentKey: 'a2', label: 'Gone', state: 'done', endedAt: iso(-60_000), hidden: true, outcome: 'completed', outcomeBasis: 'derived' }), agent({ sessionId: 's2', agentKey: 'x', label: 'Other session' })]);
    mounted = await render(createElement(AgentRows, { sessionId: 's1', level: 1 }));
    expect([...mounted.container.querySelectorAll('[data-testid=agent-row]')].map((row) => row.textContent), 'only the running agent of this session').toEqual([expect.stringContaining('Read files')]);
    setAgentsView({ showFinished: true });
    await flush();
    const rows = [...mounted.container.querySelectorAll('[data-testid=agent-row]')];
    expect(rows.map((row) => row.getAttribute('data-state')), 'finished node listed').toEqual(['running', 'done']);
    expect(rows[1]?.textContent, 'outcome basis labelled').toContain('outcome derived by Agide');
  });

  it('keeps a selected finished node and holds it through the command', async () => {
    const fake = answers([agent({ state: 'done', endedAt: iso(-60_000), hidden: true })]);
    mounted = await render(createElement(AgentRows, { sessionId: 's1', level: 1 }));
    expect(mounted.container.querySelector('[data-testid=agent-row]'), 'hidden before selection').toBeNull();
    setAgentsView({ selected: { sessionId: 's1', agentKey: 'a1' } });
    await flush();
    expect(mounted.container.querySelector('[data-testid=agent-row]'), 'selected node stays').not.toBeNull();
    (mounted.container.querySelector('[data-testid=agent-row]') as HTMLElement).click();
    await flush();
    expect(fake.invoke).toHaveBeenCalledWith('agents_hold', { sessionId: 's1', agentKey: 'a1', held: false });
  });
});

describe('plan usage', () => {
  it('shows each window with its percentage and a forecast labelled as an estimate', async () => {
    answers([], usageState({ plan: [{ window: 'five_hour', usedPercentage: 62, resetsAt: iso(3_600_000), observedAt: iso(-1000), source: 'status-line', runsOutInMinutes: 20, runsOutBeforeReset: true }, { window: 'seven_day', usedPercentage: 30, resetsAt: iso(86_400_000), observedAt: iso(-1000), source: 'status-line' }] }));
    mounted = await render(createElement(PlanUsage));
    const items = [...mounted.container.querySelectorAll('li')];
    expect(items[0]?.textContent, 'five-hour line with the run-out time').toMatch(/^5 h: 62%, may run out around \d\d:\d\d$/);
    expect(items[0]?.getAttribute('title'), 'forecast label').toContain('estimate at the current rate');
    expect(items[1]?.textContent, 'seven-day line').toBe('7 d: 30%');
  });

  it('says there is no plan data for a login without rate limits', async () => {
    answers([], usageState());
    mounted = await render(createElement(PlanUsage));
    expect(mounted.container.textContent, 'no plan data').toBe('no plan data');
  });

  it('words a passed reset and a window that resets before it runs out', () => {
    const base = { window: 'five_hour' as const, usedPercentage: 50, observedAt: iso(0), source: 'status-line' as const };
    expect(planLine({ ...base, resetsAt: iso(-1000) }, now), 'reset').toBe('5 h: reset, no data since');
    expect(planLine({ ...base, resetsAt: iso(60_000), runsOutInMinutes: 500, runsOutBeforeReset: false }, now), 'resets first').toBe('5 h: 50%, resets before it runs out at this rate');
  });
});

describe('usage pane', () => {
  it('lists the ranking in the order of the state with labels, the profile rate, the cap and the estimate note', async () => {
    const row = (sessionId: string, label: string, cost: number) => ({ subject: { kind: 'session' as const, sessionId }, costUsdPerMinute: cost, weightedTokensPerMinute: 100, share: 0.5, lastActivityAt: 0, label, elapsedSeconds: 90 });
    answers([], usageState({ profileCostUsdPerMinute: 0.3, ranking: [row('s1', 'Hot session', 0.2), row('s2', 'Cool session', 0.1)], heat: { 'session:s1': { share: 0.66, costUsdPerMinute: 0.2, level: 3 } }, appStarted: { running: 2, cap: 4 } }));
    mounted = await render(createElement(UsagePane, { instanceId: 'u', config: {}, inputs: {} }));
    const rows = [...mounted.container.querySelectorAll('[data-testid=usage-row]')];
    expect(rows.map((r) => r.getAttribute('data-subject')), 'order').toEqual(['session:s1', 'session:s2']);
    expect(rows[0]?.textContent, 'label and elapsed').toContain('Hot session');
    expect(mounted.container.querySelector('[data-testid=app-started-count]')?.textContent, 'cap').toBe('Started by Agide: 2 of 4 allowed');
    expect(mounted.container.querySelector('[data-testid=profile-rate]')?.textContent, 'estimate in dollars').toContain('~$0.30/min');
    expect(mounted.container.textContent, 'estimate label').toContain('estimates at list price');
  });

  it('limits the list to a folder when the config names one', async () => {
    const row = (sessionId: string, folderId: string) => ({ subject: { kind: 'session' as const, sessionId }, weightedTokensPerMinute: 1, share: 1, lastActivityAt: 0, folderId, elapsedSeconds: 1 });
    answers([], usageState({ ranking: [row('s1', 'f1'), row('s2', 'f2')] }));
    mounted = await render(createElement(UsagePane, { instanceId: 'u', config: { folderId: 'f2' }, inputs: {} }));
    expect([...mounted.container.querySelectorAll('[data-testid=usage-row]')].map((r) => r.getAttribute('data-subject')), 'folder scope').toEqual(['session:s2']);
  });
});

describe('agent history pane', () => {
  it('lists finished agents, filters them and opens the transcript of the selected row', async () => {
    const finished = [
      agent({ agentKey: 'a1', label: 'Read files', state: 'done', endedAt: iso(-30_000), outcome: 'completed', outcomeBasis: 'derived' }),
      agent({ agentKey: 'a2', label: 'Run tests', state: 'failed', endedAt: iso(-20_000), outcome: 'failed', outcomeBasis: 'reported' }),
      agent({ agentKey: 'a3', label: 'Still going', state: 'running' }),
    ];
    const fake = answers(finished);
    fake.respond('agents_transcript', { available: true, entries: [{ role: 'assistant', text: '<b>hello</b>' }], truncated: false });
    mounted = await render(createElement(AgentHistoryPane, { instanceId: 'h', config: {}, inputs: {} }));
    const labels = () => [...mounted!.container.querySelectorAll('[data-testid=history-row] td:first-child')].map((cell) => cell.textContent);
    expect(labels(), 'finished only, newest end first').toEqual(['Run tests', 'Read files']);

    const select = mounted.container.querySelector('[data-testid=history-state]') as HTMLSelectElement;
    select.value = 'done';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(labels(), 'state filter').toEqual(['Read files']);

    (mounted.container.querySelector('[data-testid=history-row]') as HTMLElement).click();
    await flush();
    const entry = mounted.container.querySelector('.transcript-entry');
    expect(fake.invoke).toHaveBeenCalledWith('agents_transcript', { sessionId: 's1', agentKey: 'a1' });
    expect(entry?.textContent, 'transcript text shown as text, not markup').toContain('<b>hello</b>');
    expect(entry?.querySelector('b'), 'no element made from agent text').toBeNull();
  });

  it('saves a removal delay through the settings command and says when a transcript is gone', async () => {
    const fake = answers([agent({ state: 'done', endedAt: iso(-1000), outcome: 'completed', outcomeBasis: 'derived' })]);
    fake.respond('agents_transcript', { available: false, entries: [], truncated: false, summary: 'The summary' });
    mounted = await render(createElement(AgentHistoryPane, { instanceId: 'h', config: {}, inputs: {} }));
    const input = mounted.container.querySelector('[data-testid=remove-done-after]') as HTMLInputElement;
    input.value = '30';
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await flush();
    expect(fake.invoke).toHaveBeenCalledWith('agents_settings_set', { removeDoneAfterSeconds: 30 });
    setAgentsView({ selected: { sessionId: 's1', agentKey: 'a1' } });
    await flush();
    expect(mounted.container.querySelector('[data-testid=transcript-removed]')?.textContent, 'removed mark with the summary').toContain('transcript removed');
  });
});
