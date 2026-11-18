import { describe, expect, it } from 'vitest';
import type { AgentFact, TokenUsage } from '../agents/types';
import { UsageEngine } from './UsageEngine';

const MIN = 60_000;
const tokens = (input: number, output = 0, over: Partial<TokenUsage> = {}): TokenUsage => ({ input, output, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...over });
const usage = (sessionId: string, agentKey: string, messageId: string, u: TokenUsage, model = 'claude-haiku-5-5'): AgentFact => ({ kind: 'usage', ref: { sessionId, agentKey }, at: 't', messageId, usage: u, model });
const cost = (sessionId: string, costUsd: number, basis: 'status-line' | 'result' | 'cost-state' = 'status-line'): AgentFact => ({ kind: 'session-cost', sessionId, at: 't', costUsd, basis });

function setup() {
  let now = 1_000_000_000;
  const engine = new UsageEngine({ now: () => now, windowMinutes: () => 5 });
  return { engine, advance: (ms: number) => (now += ms), time: () => now };
}

describe('UsageEngine token counting', () => {
  it('counts each message id once and replaces the usage when a line repeats', () => {
    const { engine } = setup();
    engine.apply(usage('s', 'main', 'm1', tokens(1000, 500)));
    engine.apply(usage('s', 'main', 'm1', tokens(1000, 500)));
    engine.apply(usage('s', 'main', 'm2', tokens(10)));
    engine.apply(usage('s', 'main', 'm2', tokens(30)));
    expect(engine.sessionTotals('s')?.tokens, 'session totals').toMatchObject({ input: 1030, output: 500 });
  });

  it('never subtracts when a repeated line lowers one class of a message', () => {
    const { engine } = setup();
    engine.apply(usage('s', 'main', 'm1', tokens(1000, 500)));
    engine.apply(usage('s', 'main', 'm1', tokens(900, 800)));
    expect(engine.sessionTotals('s')?.tokens, 'input stays, output grows').toMatchObject({ input: 1000, output: 800 });
    engine.apply(usage('s', 'main', 'm1', tokens(1100, 100)));
    expect(engine.sessionTotals('s')?.tokens, 'each class keeps its largest value').toMatchObject({ input: 1100, output: 800 });
  });

  it('gives a subagent without a model of its own no model and no price, and keeps the session model for the main record', () => {
    const { engine } = setup();
    engine.apply(usage('s', 'main', 'm1', tokens(10), 'claude-opus-5-1'));
    const bare: AgentFact = { kind: 'usage', ref: { sessionId: 's', agentKey: 'a1' }, at: 't', messageId: 'm2', usage: tokens(10) };
    engine.apply(bare);
    expect(engine.modelOf({ sessionId: 's', agentKey: 'a1' }), 'no borrowed model').toBeUndefined();
    expect(engine.modelOf({ sessionId: 's', agentKey: 'main' }), 'main keeps its model').toBe('claude-opus-5-1');
    engine.apply(usage('s', 'a2', 'm3', tokens(10), 'claude-haiku-5-5'));
    expect(engine.modelOf({ sessionId: 's', agentKey: 'a2' }), 'the model its transcript names').toBe('claude-haiku-5-5');
  });

  it('counts an agent in its own figure and in its session, and main in the session only', () => {
    const { engine } = setup();
    engine.apply(usage('s', 'a1', 'm1', tokens(100)));
    engine.apply(usage('s', 'main', 'm2', tokens(50)));
    expect(engine.agentTokensOf({ sessionId: 's', agentKey: 'a1' })?.input, 'agent breakdown').toBe(100);
    expect(engine.agentTokensOf({ sessionId: 's', agentKey: 'main' }), 'main is no agent').toBeUndefined();
    expect(engine.sessionTotals('s')?.tokens.input, 'session sums both').toBe(150);
  });

  it('estimates cost from the price table and gives none for a model without a price', () => {
    const { engine } = setup();
    engine.apply(usage('priced', 'main', 'm', tokens(1_000_000), 'claude-haiku-5-5'));
    engine.apply(usage('unpriced', 'main', 'm', tokens(1_000_000), 'some-other-model'));
    expect(engine.rate({ kind: 'session', sessionId: 'priced' })?.costUsdPerMinute, 'priced session has a cost rate').toBeGreaterThan(0);
    const unpriced = engine.rate({ kind: 'session', sessionId: 'unpriced' });
    expect(unpriced?.costUsdPerMinute, 'no price, no cost').toBeUndefined();
    expect(unpriced?.weightedTokensPerMinute, 'tokens still counted').toBeGreaterThan(0);
  });
});

describe('UsageEngine session cost', () => {
  it('takes the first status-line cost as a baseline, not as activity', () => {
    const { engine } = setup();
    engine.apply(cost('s', 2.5));
    expect(engine.sessionTotals('s')?.costUsd, 'figure shows the cost').toBe(2.5);
    expect(engine.rate({ kind: 'session', sessionId: 's' }), 'a resumed session does not spike').toBeUndefined();
  });

  it('adds only the part of a status-line increase that transcript estimates have not counted', () => {
    const { engine, advance } = setup();
    engine.apply(cost('s', 0));
    advance(1000);
    engine.apply(usage('s', 'main', 'm1', tokens(1_000_000)));
    const estimated = engine.rate({ kind: 'session', sessionId: 's' })?.costUsdPerMinute ?? 0;
    engine.apply(cost('s', 1));
    const after = engine.rate({ kind: 'session', sessionId: 's' })?.costUsdPerMinute ?? 0;
    expect(after - estimated, 'the rest of one dollar above the 1 dollar of tokens at 1 USD per million is zero').toBeCloseTo(0, 6);
    engine.apply(cost('s', 3));
    const later = engine.rate({ kind: 'session', sessionId: 's' })?.costUsdPerMinute ?? 0;
    expect(later - after, 'two dollars with no estimate behind it counts in full').toBeGreaterThan(0);
  });

  it('starts a new segment when the cost drops and sums the segments', () => {
    const { engine } = setup();
    engine.apply(cost('s', 0));
    engine.apply(cost('s', 1.5));
    engine.apply(cost('s', 0.25));
    expect(engine.sessionTotals('s')?.costUsd, 'segments add up').toBeCloseTo(1.75);
  });

  it('replaces the figure with a result and marks the exit cost final', () => {
    const { engine } = setup();
    engine.apply(cost('s', 0.1, 'result'));
    engine.apply(cost('s', 0.3, 'result'));
    expect(engine.sessionTotals('s'), 'second result replaces the first').toMatchObject({ costUsd: 0.3, basis: 'result', final: false });
    engine.apply(cost('s', 0.35, 'cost-state'));
    expect(engine.sessionTotals('s'), 'cost-state is final').toMatchObject({ costUsd: 0.35, basis: 'cost-state', final: true });
  });
});

describe('UsageEngine rates and ranking', () => {
  it('divides by the window, or by the elapsed time when that is shorter', () => {
    const { engine, advance } = setup();
    engine.apply(usage('s', 'main', 'm1', tokens(1_000_000)));
    advance(30_000);
    const early = engine.rate({ kind: 'session', sessionId: 's' });
    // 1 USD over 30 seconds is 2 USD per minute.
    expect(early?.costUsdPerMinute, 'short subject uses elapsed time').toBeCloseTo(2, 1);
    advance(10 * MIN);
    expect(engine.rate({ kind: 'session', sessionId: 's' })?.costUsdPerMinute ?? 0, 'old activity left the window').toBe(0);
  });

  it('orders sessions and agents by cost rate and breaks ties by the most recent activity', () => {
    const { engine, advance } = setup();
    engine.apply(usage('slow', 'main', 'm', tokens(100_000)));
    advance(1000);
    engine.apply(usage('fast', 'main', 'm', tokens(900_000)));
    engine.apply(usage('fast', 'a1', 'm2', tokens(500_000)));
    const ranking = engine.ranking(10).map((r) => (r.subject.kind === 'session' ? `s:${r.subject.sessionId}` : r.subject.kind === 'agent' ? `a:${r.subject.ref.agentKey}` : ''));
    expect(ranking, 'highest cost rate first: the fast session, its agent, the slow session').toEqual(['s:fast', 'a:a1', 's:slow']);
    expect(engine.ranking(1), 'limit applies').toHaveLength(1);
  });

  it('gives each subject its share of the profile rate', () => {
    const { engine } = setup();
    engine.apply(usage('a', 'main', 'm', tokens(750_000)));
    engine.apply(usage('b', 'main', 'm', tokens(250_000)));
    const shares = Object.fromEntries(engine.ranking(10).map((r) => [r.subject.kind === 'session' ? r.subject.sessionId : '', r.share]));
    expect(shares['a'], 'three quarters').toBeCloseTo(0.75, 2);
    expect(shares['b'], 'one quarter').toBeCloseTo(0.25, 2);
  });

  it('forgets a session with its rates', () => {
    const { engine } = setup();
    engine.apply(usage('s', 'a1', 'm', tokens(1000)));
    engine.forgetSession('s');
    expect(engine.rankedSubjects(), 'nothing ranked').toEqual([]);
    expect(engine.sessionTotals('s'), 'no totals').toBeUndefined();
  });
});

describe('UsageEngine plan usage', () => {
  const plan = (at: string, usedPercentage: number, resetsAt = '2026-11-17T15:00:00.000Z'): AgentFact => ({ kind: 'plan', at, window: 'five_hour', usedPercentage, resetsAt, source: 'status-line' });

  it('keeps the newest observation per window and ignores an older one', () => {
    const { engine } = setup();
    engine.apply(plan('2026-11-17T10:05:00.000Z', 20));
    engine.apply(plan('2026-11-17T10:00:00.000Z', 10));
    expect(engine.plan()[0], 'newer value stays').toMatchObject({ usedPercentage: 20, observedAt: '2026-11-17T10:05:00.000Z' });
  });

  it('forecasts from the slope of recent samples and says whether the window runs out before its reset', () => {
    const { engine, advance, time } = setup();
    const resetsAt = new Date(time() + 5 * 60 * MIN).toISOString();
    for (const percent of [10, 20, 30, 40]) {
      engine.apply(plan(new Date(time()).toISOString(), percent, resetsAt));
      advance(2 * MIN);
    }
    const view = engine.plan()[0];
    // 10 points every 2 minutes, 40 percent now: 60 points left at 5 per minute is 12 minutes.
    expect(view?.runsOutInMinutes, 'minutes to full').toBeCloseTo(12, 0);
    expect(view?.runsOutBeforeReset, 'before the reset five hours away').toBe(true);
  });

  it('gives no forecast without enough samples and none for a flat series', () => {
    const { engine, advance, time } = setup();
    engine.apply(plan(new Date(time()).toISOString(), 11));
    advance(MIN);
    engine.apply(plan(new Date(time()).toISOString(), 11));
    expect(engine.plan()[0]?.runsOutInMinutes, 'two samples').toBeUndefined();
    for (let i = 0; i < 4; i += 1) {
      advance(2 * MIN);
      engine.apply(plan(new Date(time()).toISOString(), 11));
    }
    expect(engine.plan()[0]?.runsOutInMinutes, 'flat series').toBeUndefined();
  });

  it('starts a new series when the window resets', () => {
    const { engine, advance, time } = setup();
    for (const percent of [10, 20, 30]) {
      engine.apply(plan(new Date(time()).toISOString(), percent));
      advance(3 * MIN);
    }
    engine.apply(plan(new Date(time()).toISOString(), 1, '2026-11-17T20:00:00.000Z'));
    expect(engine.plan()[0], 'the old slope does not carry over').toMatchObject({ usedPercentage: 1 });
    expect(engine.plan()[0]?.runsOutInMinutes, 'no forecast from one sample').toBeUndefined();
  });
});
