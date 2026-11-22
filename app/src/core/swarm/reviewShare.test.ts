import { describe, expect, it } from 'vitest';
import { defaultReviewShare, swarmDefinitionSchema } from './definition';
import { ledgerFor } from './manager/rows';

const parse = (budget: object, workspaces: ('worktree' | 'readonly' | 'scratch')[]) =>
  swarmDefinitionSchema.parse({
    version: 1,
    goal: 'g',
    repository: { path: '/repo' },
    budget: { usdTotal: 10, ...budget },
    agents: workspaces.map((workspace, index) => ({ name: `a${index}`, prompt: 'work', workspace })),
  });

describe('review share default', () => {
  it('keeps 30 percent of the budget for review when an agent works in a worktree', () => {
    expect(ledgerFor(parse({}, ['worktree', 'readonly'])).view(0, 1).reviewUsd, 'the default pot').toBeCloseTo(3);
  });

  it('keeps no pot for a swarm without a worktree agent', () => {
    expect([defaultReviewShare(parse({}, ['readonly', 'scratch'])), ledgerFor(parse({}, ['readonly'])).view(0, 1).reviewUsd], 'no worktree, no pot').toEqual([0, 0]);
  });

  it('honours a share the definition names, also zero', () => {
    expect([ledgerFor(parse({ reviewShare: 0 }, ['worktree'])).view(0, 1).reviewUsd, ledgerFor(parse({ reviewShare: 0.5 }, ['worktree'])).view(0, 1).reviewUsd], 'explicit zero and half').toEqual([0, 5]);
  });
});
