import { z } from 'zod';
import type { ReviewPolicy } from '../policy/schema';

/**
 * Test reports of a check run (0045 sections 3.6, 3.7 and 4.3). Suite, name and message of a case are untrusted:
 * the code under test wrote them. The reader, the baseline and the comparison are built by w-reports against
 * these types.
 */

export const TEST_STATUSES = ['passed', 'failed', 'error', 'skipped'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const REPORT_SOURCES = ['junit', 'libtest'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const REPORT_STATUSES = ['parsed', 'partial', 'refused', 'missing', 'not_configured'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The counts of one run; the record of `review_test_runs`. */
export const testRunSummarySchema = z
  .object({
    source: z.enum(REPORT_SOURCES).nullable(),
    status: z.enum(REPORT_STATUSES),
    /** App text naming the rule that refused a file or the limit that cut the read; never report text. */
    refusal: z.string().max(300).nullable(),
    files: z.number().int().min(0),
    bytes: z.number().int().min(0),
    executed: z.number().int().min(0),
    passed: z.number().int().min(0),
    /** Failed plus error. */
    failed: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .strict()
  .refine((summary) => summary.executed === summary.passed + summary.failed, 'executed is passed plus failed');
export type TestRunSummary = z.output<typeof testRunSummarySchema>;

/** One test of one run. */
export interface TestCase {
  /** SHA-256 hex of tool, suite and name (section 3.6). */
  readonly key: string;
  /** `cleanLine`, at most 1,024 characters. */
  readonly suite: string;
  /** `cleanLine`, at most 1,024 characters. */
  readonly name: string;
  readonly status: TestStatus;
  /** Control characters removed, at most 2,000 characters. */
  readonly message: string | null;
}

/** A parsed run. The cases stay in memory; the failures go to the store and the full list to a file. */
export interface ParsedRun extends TestRunSummary {
  readonly cases: readonly TestCase[];
}

/** A failed or errored case as the store keeps it; untrusted text. */
export interface TestFailure {
  readonly key: string;
  readonly suite: string;
  readonly name: string;
  readonly status: 'failed' | 'error';
  readonly message: string | null;
}

export interface TestRef {
  readonly key: string;
  readonly suite: string;
  readonly name: string;
  readonly message: string | null;
}

export const REPORT_LIMITS = {
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
} as const;

export const BASELINE_STATES = ['clean', 'flaky', 'red', 'no_tests', 'unparsed'] as const;
export type BaselineState = (typeof BASELINE_STATES)[number];

/** What the runs of one base job say about the tests of the base (section 3.7). */
export interface Baseline {
  readonly commitId: string;
  readonly policyHash: string;
  readonly jobId: string;
  readonly state: BaselineState;
  /** Test keys that failed in every run of the job, at most `storedFailures`. */
  readonly known: readonly string[];
  /** Test keys that failed in some runs and passed in others. */
  readonly flaky: readonly string[];
  /** Tests that ran in the first run. */
  readonly executed: number;
}

export interface FailureSets {
  readonly against: 'baseline' | 'none';
  readonly baselineState: BaselineState | null;
  readonly new: readonly TestRef[];
  readonly known: readonly TestRef[];
  readonly flaky: readonly TestRef[];
  readonly fixed: readonly TestRef[];
  /** Tests executed on the base and not on the checkpoint. */
  readonly missing: number;
  /** A set was cut at `storedFailures`. */
  readonly truncated: boolean;
}

const testRefSchema = z
  .object({ key: z.string().length(64), suite: z.string().max(REPORT_LIMITS.nameChars), name: z.string().max(REPORT_LIMITS.nameChars), message: z.string().max(REPORT_LIMITS.messageChars).nullable() })
  .strict();
const testRefs = z.array(testRefSchema).max(REPORT_LIMITS.storedFailures);

/** The shape a store accepts for the failure sets of a run: the limits of the tables of 0045 section 4.4. */
export const failureSetsSchema = z
  .object({
    against: z.enum(['baseline', 'none']),
    baselineState: z.enum(BASELINE_STATES).nullable(),
    new: testRefs,
    known: testRefs,
    flaky: testRefs,
    fixed: testRefs,
    missing: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();

/**
 * The counts that the evidence of `check.failed` holds when the run has failure sets: the rules write them and the
 * inbox message of a review item reads `newFailures`. Test names and messages never enter the evidence of a reason.
 */
export interface FailureCountsEvidence {
  readonly newFailures: number;
  readonly knownFailures: number;
  readonly flakyFailures: number;
}

/** The `check.reports` entry of the effective policy. */
export type CheckReports = NonNullable<NonNullable<ReviewPolicy['check']>['reports']>;

export interface ReportReader {
  /** Reads the reports of one run; never throws for a file the run wrote, only for an app failure. */
  read(input: {
    readonly checkout: string;
    readonly tempDirectory: string;
    readonly reports: CheckReports;
    readonly output: Uint8Array;
    readonly outputTruncated: boolean;
    readonly signal: AbortSignal;
  }): Promise<ParsedRun>;
}

/** The comparison of section 3.7; `baseFailures` maps the base's failing keys to their text. */
export type CompareToBaseline = (checkpoint: ParsedRun, baseline: Baseline | undefined, baseFailures: ReadonlyMap<string, TestRef>) => FailureSets;

/** The counts of a parsed run without its cases. */
export function summaryOf(run: ParsedRun): TestRunSummary {
  const { cases: _cases, ...summary } = run;
  return summary;
}

/** The failed and errored cases of a parsed run, in report order, cut at `storedFailures`. */
export function failuresOf(run: ParsedRun): TestFailure[] {
  const failures: TestFailure[] = [];
  for (const test of run.cases) {
    if (test.status !== 'failed' && test.status !== 'error') continue;
    failures.push({ key: test.key, suite: test.suite, name: test.name, status: test.status, message: test.message });
    if (failures.length === REPORT_LIMITS.storedFailures) break;
  }
  return failures;
}
