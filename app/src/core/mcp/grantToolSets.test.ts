import { describe, expect, it } from 'vitest';
import { GrantStore } from './grants';

describe('grant tool sets', () => {
  it('gives a grant the default set unless one is declared or passed', () => {
    const grants = new GrantStore();
    const token = grants.issue('s1', 'f1');
    expect(grants.authenticate('s1', token)?.toolSet, 'no declaration').toBe('default');
    const reviewerToken = grants.issue('s2', 'f1', [], 'reviewer');
    expect(grants.authenticate('s2', reviewerToken)?.toolSet, 'passed at issue').toBe('reviewer');
  });

  it('keeps a declared tool set across the grants every launch issues, and changes a grant that exists', () => {
    const grants = new GrantStore();
    grants.declareToolSet('s1', 'reviewer');
    const first = grants.issue('s1', 'f1');
    expect(grants.authenticate('s1', first)?.toolSet, 'the grant issued after the declaration').toBe('reviewer');
    const second = grants.issue('s1', 'f1');
    expect(grants.authenticate('s1', second)?.toolSet, 'a later launch of the same session').toBe('reviewer');
    grants.declareToolSet('s1', 'worker');
    expect(grants.authenticate('s1', second)?.toolSet, 'an existing grant takes the new set at once').toBe('worker');
  });

  it('forgets the declaration on revoke', () => {
    const grants = new GrantStore();
    grants.declareToolSet('s1', 'reviewer');
    grants.revoke('s1');
    const token = grants.issue('s1', 'f1');
    expect(grants.authenticate('s1', token)?.toolSet, 'a revoked session starts again with the default set').toBe('default');
  });

  it('does not authenticate the token of another session', () => {
    const grants = new GrantStore();
    const mine = grants.issue('s1', 'f1', [], 'reviewer');
    grants.issue('s2', 'f1', [], 'reviewer');
    expect(grants.authenticate('s2', mine), 'the token of s1 on s2').toBeUndefined();
  });
});
