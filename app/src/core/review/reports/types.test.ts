import { describe, expect, it } from 'vitest';
import { parsedRun } from '../fakes/fakeBase';
import { sha1Of, sha256Of } from '../fakes/fixtures';
import { checkRecordSchema } from '../schemas';
import { REPORT_LIMITS, failureSetsSchema, failuresOf, summaryOf, testRunSummarySchema, type ParsedRun, type TestCase } from './types';

const summary = { source: 'junit', status: 'parsed', refusal: null, files: 1, bytes: 10, executed: 3, passed: 2, failed: 1, skipped: 0 };

describe('the test run summary', () => {
  it('accepts counts where executed is passed plus failed', () => {
    expect(testRunSummarySchema.safeParse(summary).success, 'consistent counts').toBe(true);
    expect(testRunSummarySchema.safeParse({ ...summary, source: null, status: 'not_configured', executed: 0, passed: 0, failed: 0 }).success, 'a run without a source').toBe(true);
  });

  it.each([
    ['executed not equal to passed plus failed', { executed: 4 }],
    ['a negative count', { skipped: -1 }],
    ['a refusal over 300 characters', { refusal: 'x'.repeat(301) }],
    ['a source outside the list', { source: 'tap' }],
    ['a status outside the list', { status: 'unreadable' }],
    ['an unknown key', { cases: [] }],
  ])('refuses %s', (_name, patch) => {
    expect(testRunSummarySchema.safeParse({ ...summary, ...patch }).success, 'the summary is refused').toBe(false);
  });

  it('is an optional part of a check record, together with the id of the run it repeats', () => {
    const check = {
      id: 'chk_1',
      changesetId: null,
      target: 'base',
      commitId: sha1Of('c'),
      policyHash: sha256Of('p'),
      command: ['pnpm', 'test'],
      outcome: 'passed',
      notRunReason: null,
      exitCode: 0,
      signal: null,
      durationMs: 1,
      outputPath: null,
      outputTail: null,
      truncated: false,
      startedAt: 't',
      endedAt: 't',
    };
    expect(checkRecordSchema.safeParse(check).success, 'a record without the new fields').toBe(true);
    expect(checkRecordSchema.safeParse({ ...check, tests: summary, rerunOf: 'chk_0' }).success, 'a record with both').toBe(true);
    expect(checkRecordSchema.safeParse({ ...check, tests: null, rerunOf: null }).success, 'both may be null').toBe(true);
    expect(checkRecordSchema.safeParse({ ...check, tests: { ...summary, executed: 9 } }).success, 'counts that do not add up are refused').toBe(false);
  });
});

describe('the helpers of a parsed run', () => {
  it('takes the counts without the cases', () => {
    const run = parsedRun({ passed: ['a', 'b'], failed: ['c'], skipped: ['d'] });
    const result = summaryOf(run);
    expect(result, 'the counts of the run').toEqual({ source: 'junit', status: 'parsed', refusal: null, files: 1, bytes: 100, executed: 3, passed: 2, failed: 1, skipped: 1 });
    expect('cases' in result, 'no cases on the summary').toBe(false);
    expect(testRunSummarySchema.safeParse(result).success, 'the summary parses').toBe(true);
  });

  it('lists failed and errored cases in report order and leaves passed and skipped out', () => {
    const cases: TestCase[] = [
      { key: sha256Of('1'), suite: 's', name: 'one', status: 'passed', message: null },
      { key: sha256Of('2'), suite: 's', name: 'two', status: 'error', message: 'boom' },
      { key: sha256Of('3'), suite: 's', name: 'three', status: 'skipped', message: null },
      { key: sha256Of('4'), suite: 's', name: 'four', status: 'failed', message: null },
    ];
    const run: ParsedRun = { ...parsedRun(), cases };
    expect(failuresOf(run), 'the failed and the errored case').toEqual([
      { key: sha256Of('2'), suite: 's', name: 'two', status: 'error', message: 'boom' },
      { key: sha256Of('4'), suite: 's', name: 'four', status: 'failed', message: null },
    ]);
  });

  it('cuts the failures at the limit of the table', () => {
    const cases: TestCase[] = Array.from({ length: REPORT_LIMITS.storedFailures + 5 }, (_, index) => ({ key: sha256Of(`f${index}`), suite: 's', name: `f${index}`, status: 'failed', message: null }));
    const failures = failuresOf({ ...parsedRun(), cases });
    expect(failures.length, 'cut at the limit').toBe(REPORT_LIMITS.storedFailures);
    expect(failures.at(-1)?.name, 'the first ones are kept').toBe(`f${REPORT_LIMITS.storedFailures - 1}`);
  });

  it('keeps the limits of 0045 section 4.3', () => {
    expect(REPORT_LIMITS, 'the limits').toEqual({
      fileBytes: 16 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024,
      files: 256,
      walkEntries: 20_000,
      walkDepth: 24,
      xmlDepth: 32,
      attributesPerElement: 64,
      attributeChars: 64 * 1024,
      cases: 200_000,
      nameChars: 1_024,
      messageChars: 2_000,
      storedFailures: 2_000,
      milliseconds: 20_000,
    });
  });
});

describe('the failure sets of a run', () => {
  const ref = { key: sha256Of('t'), suite: 's', name: 'n', message: null };
  const sets = { against: 'baseline', baselineState: 'red', new: [ref], known: [], flaky: [], fixed: [], missing: 1, truncated: false };

  it('accepts sets within the limits of the tables', () => {
    expect(failureSetsSchema.safeParse(sets).success, 'a set of each kind').toBe(true);
    expect(failureSetsSchema.safeParse({ ...sets, against: 'none', baselineState: null, new: Array.from({ length: REPORT_LIMITS.storedFailures }, () => ref) }).success, 'a list at the limit and no baseline').toBe(true);
  });

  it.each([
    ['a key that is not 64 characters', { new: [{ ...ref, key: 'short' }] }],
    ['a suite over the name limit', { known: [{ ...ref, suite: 's'.repeat(REPORT_LIMITS.nameChars + 1) }] }],
    ['a name over the name limit', { flaky: [{ ...ref, name: 'n'.repeat(REPORT_LIMITS.nameChars + 1) }] }],
    ['a message over the message limit', { fixed: [{ ...ref, message: 'm'.repeat(REPORT_LIMITS.messageChars + 1) }] }],
    ['a list over the stored failures limit', { new: Array.from({ length: REPORT_LIMITS.storedFailures + 1 }, () => ref) }],
    ['a negative missing count', { missing: -1 }],
    ['a baseline state outside the list', { baselineState: 'unknown' }],
    ['an unknown key', { extra: 1 }],
  ])('refuses %s', (_name, patch) => {
    expect(failureSetsSchema.safeParse({ ...sets, ...patch }).success, 'the sets are refused').toBe(false);
  });
});
