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

/** The project's check wins; the user's applies only when the project has none. `network: none` wins either way. */
function mergeCheck(project: ReviewPolicy['check'], overlay: UserPolicy['check']): { check?: NonNullable<ReviewPolicy['check']> } {
  if (project !== undefined) {
    const network = project.network === 'none' || overlay?.network === 'none' ? 'none' : 'development';
    return { check: { ...project, network } };
  }
  if (overlay?.command === undefined) return {};
  return { check: { ...overlay, command: overlay.command, timeoutSeconds: overlay.timeoutSeconds ?? 600, network: overlay.network ?? 'none', env: overlay.env ?? [] } };
}
