import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEW_POLICY, reviewPolicySchema, userPolicySchema } from './policy/schema';
import { REASON_CATALOGUE, REASON_IDS } from './reasonCatalogue';
import { computeRung, maxRung, reviewerTier, rungAbove, summaryHash } from './rungs';
import type { Rung, StoredReason } from './schemas';

const reason = (id: string, minRung: Rung, hard: boolean, createdAt: string): StoredReason => ({
  id,
  subject: '',
  source: 'rule',
  evidence: {},
  minRung,
  hard,
  changesetId: 'cs_0000000000000000',
  createdAt,
});

describe('rungs', () => {
  it('takes the highest rung of the reasons and of the hard reasons as the floor', () => {
    expect(computeRung([]), 'no reasons').toEqual({ rung: 'A', floor: 'A' });
    const reasons = [reason('size.medium', 'B', false, 't1'), reason('deps.changed', 'C', false, 't1'), reason('path.migration', 'D', true, 't1')];
    expect(computeRung(reasons), 'max over all, floor over hard').toEqual({ rung: 'D', floor: 'D' });
    expect(computeRung(reasons.slice(0, 2)), 'without the hard reason').toEqual({ rung: 'C', floor: 'A' });
  });

  it('keeps a demotion against the reasons it weighed and raises again for later reasons', () => {
    const before = [reason('config.git', 'E', true, 't1'), reason('size.large', 'C', false, 't1')];
    const demotion = { toRung: 'B' as const, floor: 'B' as const, at: 't2' };
    expect(computeRung(before, demotion), 'the demoted rung and floor hold').toEqual({ rung: 'B', floor: 'B' });
    expect(computeRung([...before, reason('reviewer.findings', 'C', false, 't3')], demotion), 'a later reason raises the rung').toEqual({ rung: 'C', floor: 'B' });
    expect(computeRung([...before, reason('secret.added', 'E', true, 't3')], demotion), 'a later hard reason raises the floor').toEqual({ rung: 'E', floor: 'E' });
  });

  it('compares rungs and tiers in their order', () => {
    expect(maxRung('B', 'D', 'C'), 'max').toBe('D');
    expect(rungAbove('D'), 'above D').toBe('E');
    expect(rungAbove('E'), 'E stays E').toBe('E');
    expect(reviewerTier('strong', 'small'), 'the policy tier when the worker is lower').toBe('strong');
    expect(reviewerTier('mid', 'strong'), 'never below the worker').toBe('strong');
  });

  it('binds the summary hash to content, rung, reasons and the report, not to the reason order', () => {
    const content = 'a'.repeat(64);
    expect(summaryHash(content, 'C', ['b', 'a'], 'r1'), 'reason order').toBe(summaryHash(content, 'C', ['a', 'b'], 'r1'));
    expect(summaryHash(content, 'C', ['a'], 'r1'), 'the rung').not.toBe(summaryHash(content, 'D', ['a'], 'r1'));
    expect(summaryHash(content, 'C', ['a'], 'r1'), 'the report').not.toBe(summaryHash(content, 'C', ['a'], 'r2'));
  });
});

describe('reason catalogue and policy schema', () => {
  it('marks the hard reasons of 0040 section 7.4 and no other', () => {
    const hard = REASON_IDS.filter((id) => REASON_CATALOGUE[id].hard).sort();
    expect(hard, 'hard reasons').toEqual(
      ['config.agent', 'config.git', 'path.migration', 'path.protected', 'policy.changed', 'repo.armed', 'repo.ref_moved', 'reviewer.user_config_changed', 'secret.added'].sort(),
    );
  });

  it('parses the example of 0040 and the minimal policy with the nested defaults', () => {
    const example = reviewPolicySchema.parse({
      version: 1,
      notes: 'Review policy for the shop service.',
      check: { setup: ['pnpm', 'install', '--frozen-lockfile', '--offline'], command: ['pnpm', 'test'], timeoutSeconds: 900 },
      retryLimit: 2,
      paths: { sensitive: ['src/auth/**', 'infra/**'], migrations: ['db/migration/**', '**/*.avsc'] },
      rungs: { 'deps.changed': 'D', 'tests.missing': 'C' },
      outward: { 'slack.send': 'draft', 'github.approve': 'approve' },
      deployCommands: ['./scripts/deploy.sh'],
    });
    expect(example.check?.network, 'check network default').toBe('none');
    expect(example.thresholds.accumulate, 'threshold default').toBe(3);
    expect(DEFAULT_REVIEW_POLICY.reviewer, 'reviewer defaults').toMatchObject({ tier: 'strong', effortB: 'high', effortHuman: 'xhigh', usdPerRun: 2 });
    expect(DEFAULT_REVIEW_POLICY.check, 'no check command by default').toBeUndefined();
  });

  it('binds the summary hash to the content, the rung, the reasons and the latest report', () => {
    const base = summaryHash('content', 'C', ['a', 'b'], 'rep_1');
    expect(summaryHash('content', 'C', ['b', 'a'], 'rep_1'), 'the order of the reason ids does not matter').toBe(base);
    expect(summaryHash('other', 'C', ['a', 'b'], 'rep_1'), 'other content').not.toBe(base);
    expect(summaryHash('content', 'D', ['a', 'b'], 'rep_1'), 'another rung').not.toBe(base);
    expect(summaryHash('content', 'C', ['a'], 'rep_1'), 'fewer reasons').not.toBe(base);
    expect(summaryHash('content', 'C', ['a', 'b', 'c'], 'rep_1'), 'one more reason').not.toBe(base);
    expect(summaryHash('content', 'C', ['a', 'b'], 'rep_2'), 'another report').not.toBe(base);
    expect(summaryHash('content', 'C', ['a', 'b'], undefined), 'no report').not.toBe(base);
  });

  it('refuses unknown keys, a shell string as command and an unknown outward class', () => {
    expect(reviewPolicySchema.safeParse({ version: 1, extra: true }).success, 'an unknown key').toBe(false);
    expect(reviewPolicySchema.safeParse({ version: 1, check: { command: 'pnpm test' } }).success, 'a string command').toBe(false);
    expect(reviewPolicySchema.safeParse({ version: 1, outward: { 'nobody.knows': 'allow' } }).success, 'an unknown class').toBe(false);
    expect(userPolicySchema.parse({}), 'the overlay has no defaults').toEqual({});
  });
});
