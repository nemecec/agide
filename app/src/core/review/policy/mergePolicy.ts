import { isReasonId, REASON_CATALOGUE } from '../reasonCatalogue';
import { RUNGS, type Rung } from '../schemas';
import { DEFAULT_TEST_GLOBS } from './defaults';
import { reviewPolicySchema, type ReviewPolicy, type UserPolicy } from './schema';

/**
 * The user-level overlay only tightens the project policy (0040 section 8.4): the smaller value for thresholds and
 * budgets, the higher rung per reason id, the union of globs, the stronger tier and effort, the stricter outward mode.
 */

const OUTWARD_ORDER = ['allow', 'notify', 'draft', 'approve', 'deny'] as const;
const TIER_ORDER = ['mid', 'strong'] as const;
const EFFORT_ORDER = ['medium', 'high', 'xhigh'] as const;

const smaller = (a: number, b: number | undefined): number => (b === undefined ? a : Math.min(a, b));
const strongest = <T extends string>(order: readonly T[], a: T, b: T | undefined): T => (b !== undefined && order.indexOf(b) > order.indexOf(a) ? b : a);
const union = (a: readonly string[], b: readonly string[] | undefined): string[] => [...new Set([...a, ...(b ?? [])])];
const higherRung = (a: Rung, b: Rung): Rung => (RUNGS.indexOf(b) > RUNGS.indexOf(a) ? b : a);

export function mergeOverlay(project: ReviewPolicy, overlay: UserPolicy | undefined): ReviewPolicy {
  if (overlay === undefined) return project;
  const sizeOf = (own: { lines: number; files: number }, other: { lines: number; files: number } | undefined) => ({ lines: smaller(own.lines, other?.lines), files: smaller(own.files, other?.files) });
  const thresholds = project.thresholds;
  const userThresholds = overlay.thresholds;
  const reviewer = project.reviewer;
  const userReviewer = overlay.reviewer;
  const dailyBudget = project.reviewer.dailyBudgetUsd === undefined ? userReviewer?.dailyBudgetUsd : smaller(project.reviewer.dailyBudgetUsd, userReviewer?.dailyBudgetUsd);

  const rungs: Record<string, Rung> = { ...project.rungs };
  for (const [id, rung] of Object.entries(overlay.rungs ?? {})) {
    const current = rungs[id] ?? (isReasonId(id) ? REASON_CATALOGUE[id].rung : undefined);
    rungs[id] = current === undefined ? rung : higherRung(current, rung);
  }

  const outward: ReviewPolicy['outward'] = { ...project.outward };
  for (const [id, mode] of Object.entries(overlay.outward ?? {}) as [keyof ReviewPolicy['outward'], (typeof OUTWARD_ORDER)[number]][]) {
    const own = outward[id];
    outward[id] = own === undefined ? mode : strongest(OUTWARD_ORDER, own, mode);
  }

  const tests = overlay.paths?.tests === undefined ? project.paths.tests : union(project.paths.tests ?? DEFAULT_TEST_GLOBS, overlay.paths.tests);

  const merged = {
    version: 1 as const,
    ...(project.notes === undefined ? {} : { notes: project.notes }),
    ...mergeCheck(project.check, overlay.check),
    retryLimit: smaller(project.retryLimit, overlay.retryLimit),
    paths: {
      ...(project.paths.notes === undefined ? {} : { notes: project.paths.notes }),
      sensitive: union(project.paths.sensitive, overlay.paths?.sensitive),
      migrations: union(project.paths.migrations, overlay.paths?.migrations),
      ...(tests === undefined ? {} : { tests }),
      testConfig: union(project.paths.testConfig, overlay.paths?.testConfig),
      build: union(project.paths.build, overlay.paths?.build),
      generated: union(project.paths.generated, overlay.paths?.generated),
    },
    thresholds: {
      ...(thresholds.notes === undefined ? {} : { notes: thresholds.notes }),
      small: sizeOf(thresholds.small, userThresholds?.small),
      large: sizeOf(thresholds.large, userThresholds?.large),
      run: sizeOf(thresholds.run, userThresholds?.run),
      swarm: sizeOf(thresholds.swarm, userThresholds?.swarm),
      dirs: smaller(thresholds.dirs, userThresholds?.dirs),
      denials: smaller(thresholds.denials, userThresholds?.denials),
      toolErrors: smaller(thresholds.toolErrors, userThresholds?.toolErrors),
      accumulate: smaller(thresholds.accumulate, userThresholds?.accumulate),
    },
    rungs,
    reviewer: {
      ...(reviewer.notes === undefined ? {} : { notes: reviewer.notes }),
      tier: strongest(TIER_ORDER, reviewer.tier, userReviewer?.tier),
      effortB: strongest(EFFORT_ORDER, reviewer.effortB, userReviewer?.effortB),
      effortHuman: strongest(['high', 'xhigh'] as const, reviewer.effortHuman, userReviewer?.effortHuman),
      timeoutMinutes: smaller(reviewer.timeoutMinutes, userReviewer?.timeoutMinutes),
      maxTurns: smaller(reviewer.maxTurns, userReviewer?.maxTurns),
      usdPerRun: smaller(reviewer.usdPerRun, userReviewer?.usdPerRun),
      ...(dailyBudget === undefined ? {} : { dailyBudgetUsd: dailyBudget }),
    },
    outward,
    deployCommands: union(project.deployCommands, overlay.deployCommands),
  };
  return reviewPolicySchema.parse(merged);
}

type Check = NonNullable<ReviewPolicy['check']>;

/**
 * The project's check wins; the user's applies only when the project has none. `network: none` wins either way.
 * The report fields merge per field and only add information or tighten (0045 section 4.2): the union of the
 * report globs and `libtest` on when either side has it, the larger `minTests` (the default 1 counts as the
 * project's value), `never` over `new_failures`, and `baselineLowers` only when both sides allow it, so the
 * overlay never turns it on.
 */
function mergeCheck(project: ReviewPolicy['check'], overlay: UserPolicy['check']): { check?: Check } {
  if (project !== undefined) {
    const network = project.network === 'none' || overlay?.network === 'none' ? 'none' : 'development';
    return { check: { ...project, network, ...mergeReportFields(project, overlay) } };
  }
  if (overlay?.command === undefined) return {};
  const { reports: _reports, minTests: _minTests, ...rest } = overlay;
  const own = mergeReportFields({ redBaseSendBack: 'new_failures', baselineLowers: false }, overlay);
  return { check: { ...rest, command: overlay.command, timeoutSeconds: overlay.timeoutSeconds ?? 600, network: overlay.network ?? 'none', env: overlay.env ?? [], ...own } };
}

type ReportFields = Pick<Check, 'reports' | 'minTests' | 'redBaseSendBack' | 'baselineLowers'>;

function mergeReportFields(project: Pick<Check, 'redBaseSendBack' | 'baselineLowers'> & Partial<Pick<Check, 'reports' | 'minTests'>>, overlay: UserPolicy['check']): ReportFields {
  const junit = union(project.reports?.junit ?? [], overlay?.reports?.junit);
  const libtest = project.reports?.libtest === true || overlay?.reports?.libtest === true;
  // A source that only the overlay names adds a report entry; an overlay entry without a source adds nothing.
  const reports = project.reports !== undefined ? { ...project.reports, junit, libtest } : junit.length > 0 || libtest ? { junit, libtest } : undefined;
  const minTests = overlay?.minTests === undefined ? undefined : Math.max(project.minTests ?? 1, overlay.minTests);
  return {
    ...(reports === undefined ? {} : { reports }),
    ...(minTests === undefined ? {} : { minTests }),
    redBaseSendBack: project.redBaseSendBack === 'never' || overlay?.redBaseSendBack === 'never' ? 'never' : 'new_failures',
    baselineLowers: project.baselineLowers && overlay?.baselineLowers !== false,
  };
}
