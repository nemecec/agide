import { describe, expect, it } from 'vitest';
import { BudgetLedger } from './BudgetLedger';

const usage = { input: 1_000_000, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

function ledger(options: { total?: number; reviewShare?: number; budget?: number } = {}): BudgetLedger {
  return new BudgetLedger({
    usdTotal: options.total ?? 2,
    reviewShare: options.reviewShare ?? 0,
    agents: [
      { name: 'a', budgetUsd: options.budget ?? 1, reviewer: false },
      { name: 'b', budgetUsd: options.budget ?? 1, reviewer: false },
      { name: 'c', budgetUsd: options.budget ?? 1, reviewer: false },
      { name: 'rev', budgetUsd: options.budget ?? 1, reviewer: true },
    ],
  });
}

describe('budget ledger', () => {
  it('reserves the agent budget and makes the next agent wait when the swarm total is held', () => {
    const l = ledger();
    expect(l.reserve('a'), 'first agent').toEqual({ ok: true, usd: 1, pot: 'work' });
    expect(l.reserve('b'), 'second agent').toEqual({ ok: true, usd: 1, pot: 'work' });
    expect(l.reserve('c'), 'the total is held by the first two').toEqual({ ok: false, reason: 'swarm-short' });
    l.release('a');
    expect(l.reserve('c'), 'a released reservation is available again').toMatchObject({ ok: true, usd: 1 });
  });

  it('reserves the remainder when it is smaller than the agent budget, and nothing below the minimum', () => {
    const l = ledger({ total: 1.2 });
    l.reserve('a');
    expect(l.reserve('b'), 'the remainder of the swarm total').toMatchObject({ ok: true, usd: expect.closeTo(0.2, 5) });
    const small = ledger({ total: 1.03 });
    small.reserve('a');
    expect(small.reserve('b'), 'a remainder under the minimum stays queued').toEqual({ ok: false, reason: 'swarm-short' });
  });

  it('subtracts what an agent spent from its budget on the next reservation, since a resumed process counts from zero', () => {
    const l = ledger({ total: 5, budget: 1 });
    l.reserve('a');
    l.onResult('a', 0.7);
    l.release('a');
    expect(l.reserve('a'), 'the remaining 0.30 of the agent budget').toMatchObject({ ok: true, usd: expect.closeTo(0.3, 5) });
    l.onResult('a', 0.3);
    l.release('a');
    expect(l.reserve('a'), 'an agent that spent its budget cannot start again').toEqual({ ok: false, reason: 'agent-spent' });
  });

  it('draws reviewers from the review allowance when there is one, and from the work pot when there is none', () => {
    const withShare = ledger({ total: 2, reviewShare: 0.25 });
    expect(withShare.reserve('rev'), 'a reviewer is limited to its share').toEqual({ ok: true, usd: 0.5, pot: 'review' });
    expect(withShare.reserve('a'), 'workers share the rest').toMatchObject({ ok: true, usd: 1, pot: 'work' });
    expect(withShare.reserve('b'), 'the work pot holds 1.5').toMatchObject({ ok: true, usd: expect.closeTo(0.5, 5) });
    expect(ledger({ total: 2 }).reserve('rev'), 'without a share a reviewer draws from the work pot').toMatchObject({ ok: true, pot: 'work' });
  });

  it('counts the reported cost of the process, the estimate since the last result and finished segments', () => {
    const l = ledger({ total: 100, budget: 100 });
    l.reserve('a');
    l.onAssistant('a', 'm1', 'sonnet', usage);
    l.onAssistant('a', 'm1', 'sonnet', usage);
    const estimate = l.spendOf('a').estimatedUsd;
    expect(estimate, 'the last copy per message id counts once, at list price').toBeGreaterThan(0);
    expect(l.spendOf('a').priced, 'a priced model').toBe(true);
    l.onResult('a', 0.5);
    expect(l.spendOf('a'), 'a result replaces the estimate with the reported cost').toMatchObject({ reportedUsd: 0.5, estimatedUsd: 0 });
    l.release('a');
    l.reserve('a');
    l.onResult('a', 0.25);
    expect(l.spendOf('a').reportedUsd, 'segments add up').toBeCloseTo(0.75, 5);
    expect(l.swarmSpend(), 'the swarm sums its agents').toBeCloseTo(0.75, 5);
    l.onAssistant('b', 'x', 'unknown-model', usage);
    expect(l.spendOf('b').priced, 'a model without a price is flagged and adds no estimate').toBe(false);
    expect(l.processSpend('b'), 'no estimate without a price').toBe(0);
  });

  it('knows the alert share and the cap, and views the whole swarm', () => {
    const l = ledger({ total: 1, budget: 1 });
    l.reserve('a');
    l.onResult('a', 0.79);
    expect(l.atAlertShare(), 'below 80 percent').toBe(false);
    l.onResult('a', 0.8);
    expect(l.atAlertShare(), 'at 80 percent').toBe(true);
    expect(l.atCap(), 'not at the total').toBe(false);
    l.onResult('a', 1);
    expect(l.atCap(), 'at the total').toBe(true);
    expect(l.view(5, 10), 'the view').toMatchObject({ usdTotal: 1, reportedUsd: 1, reservedUsd: 1, remainingUsd: 0, wallClockMs: 5, wallClockLimitMs: 10 });
    l.restore('b', 0.4);
    expect(l.spendOf('b').reportedUsd, 'restored spend after a restart').toBe(0.4);
    expect(l.reservationOf('a'), 'the reservation of a running agent').toBe(1);
  });
});

describe('budget ledger pot and calibration', () => {
  it('counts the own spend of an agent whose budget is larger than the pot, so a resume never reserves the whole pot again', () => {
    const l = ledger({ total: 1, budget: 5 });
    expect(l.reserve('a'), 'the first reservation is the pot').toMatchObject({ ok: true, usd: 1 });
    l.onResult('a', 0.9);
    l.release('a');
    expect(l.reserve('a'), 'only the rest of the pot is left').toMatchObject({ ok: true, usd: expect.closeTo(0.1, 5) });
  });

  it('calibrates the estimate of each agent from its own turns, so another agent price ratio does not scale it', () => {
    const l = ledger({ total: 20, budget: 10 });
    l.onAssistant('a', 'm1', 'claude-haiku-4-5', usage);
    l.onAssistant('b', 'm2', 'claude-haiku-4-5', usage);
    const before = l.spendOf('b').estimatedUsd;
    l.onResult('a', before * 0.1);
    expect(l.spendOf('b').estimatedUsd, 'agent b keeps its own estimate after agent a reported a tenth of it').toBeCloseTo(before, 6);
  });

  it('keeps a resumed reviewer inside the review allowance', () => {
    const l = ledger({ total: 2, reviewShare: 0.25, budget: 5 });
    expect(l.reserve('rev'), 'the allowance is 0.5').toEqual({ ok: true, usd: 0.5, pot: 'review' });
    l.onResult('rev', 0.5);
    l.release('rev');
    expect(l.reserve('rev'), 'the allowance is spent').toEqual({ ok: false, reason: 'swarm-short' });
    l.restore('a', 0);
    expect(l.reserve('a'), 'the work pot is untouched by the reviewer').toMatchObject({ ok: true, pot: 'work' });
  });

  it('scales estimates by the ratio of the reported cost of the last turn, so a price table above the real cost does not end an agent early', () => {
    const l = ledger({ total: 100, budget: 100 });
    l.reserve('a');
    l.onAssistant('a', 'm1', 'sonnet', usage);
    const listPrice = l.processSpend('a');
    l.onResult('a', listPrice / 10);
    l.onAssistant('a', 'm2', 'sonnet', usage);
    expect(l.processSpend('a'), 'the next estimate is a tenth of the list price, added to the reported cost').toBeCloseTo(listPrice / 10 + listPrice / 10, 5);
  });
});
