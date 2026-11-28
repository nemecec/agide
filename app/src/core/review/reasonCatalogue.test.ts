import { describe, expect, it } from 'vitest';
import { HARD_REASON_IDS, REASON_CATALOGUE, isReasonId } from './reasonCatalogue';

describe('the reasons of the check follow-up', () => {
  it.each([
    ['check.failed', 'check', 'C'],
    ['check.base_red', 'check', 'C'],
    ['check.no_tests', 'check', 'C'],
    ['check.base_no_tests', 'check', 'B'],
    ['check.report_missing', 'check', 'C'],
    ['check.known_failures', 'check', 'B'],
    ['check.flaky_pass', 'check', 'B'],
    ['check.base_fix', 'policy', 'C'],
  ] as const)('has %s from the source %s at rung %s, soft and without a variable rung', (id, source, rung) => {
    expect(isReasonId(id), 'the id is in the catalogue').toBe(true);
    expect(REASON_CATALOGUE[id], 'source, rung and softness').toEqual({ source, rung, hard: false });
    expect(HARD_REASON_IDS.includes(id), 'not a hard reason').toBe(false);
  });
});
