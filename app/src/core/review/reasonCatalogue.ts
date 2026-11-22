import type { ReasonSource, Rung } from './schemas';

export interface ReasonDefinition {
  readonly source: ReasonSource;
  /** The default `minRung`; the project policy can change it by id (`rungs`), within the hard-floor rule. */
  readonly rung: Rung;
  /** A hard reason sets the floor; no policy lowers it below `rung`, only the user's confirmed demotion does. */
  readonly hard: boolean;
  /** The rung comes from the reason itself (a requested or escalated rung, accumulation, a threshold). `rung` is its lowest value. */
  readonly variable?: true;
}

/** The reason catalogue of 0040 section 7.2. Rules, the manager and the views read ids and defaults from here. */
export const REASON_CATALOGUE = {
  'check.none': { source: 'policy', rung: 'B', hard: false },
  'check.failed': { source: 'check', rung: 'C', hard: false },
  'check.failed_on_base': { source: 'check', rung: 'B', hard: false },
  'check.timed_out': { source: 'check', rung: 'C', hard: false },
  'check.not_run': { source: 'check', rung: 'C', hard: false },
  'size.medium': { source: 'rule', rung: 'B', hard: false },
  'size.large': { source: 'rule', rung: 'C', hard: false },
  'size.run': { source: 'rule', rung: 'C', hard: false },
  'size.swarm': { source: 'rule', rung: 'C', hard: false },
  'size.too_many_files': { source: 'rule', rung: 'D', hard: false },
  'diffusion.dirs': { source: 'rule', rung: 'B', hard: false },
  'file.large_unreviewed': { source: 'rule', rung: 'D', hard: false },
  'file.binary': { source: 'rule', rung: 'B', hard: false },
  'file.exec_bit': { source: 'rule', rung: 'B', hard: false },
  'file.symlink': { source: 'rule', rung: 'C', hard: false },
  'file.submodule': { source: 'rule', rung: 'C', hard: false },
  'file.odd_name': { source: 'rule', rung: 'B', hard: false },
  'path.sensitive': { source: 'policy', rung: 'D', hard: false },
  'path.migration': { source: 'policy', rung: 'D', hard: true },
  'path.protected': { source: 'rule', rung: 'E', hard: true },
  'path.outside_owns': { source: 'rule', rung: 'C', hard: false },
  'path.overlap': { source: 'rule', rung: 'C', hard: false },
  'config.agent': { source: 'rule', rung: 'E', hard: true },
  'config.git': { source: 'rule', rung: 'E', hard: true },
  'config.ci': { source: 'rule', rung: 'C', hard: false },
  'config.test_lint': { source: 'rule', rung: 'C', hard: false },
  'deps.changed': { source: 'rule', rung: 'C', hard: false },
  'build.changed': { source: 'rule', rung: 'C', hard: false },
  'policy.changed': { source: 'rule', rung: 'E', hard: true },
  'tests.deleted': { source: 'rule', rung: 'C', hard: false },
  'tests.skipped': { source: 'rule', rung: 'C', hard: false },
  'tests.weakened': { source: 'rule', rung: 'C', hard: false },
  'tests.missing': { source: 'rule', rung: 'B', hard: false },
  'secret.added': { source: 'rule', rung: 'E', hard: true },
  'run.incomplete': { source: 'telemetry', rung: 'C', hard: false },
  'run.background_stopped': { source: 'telemetry', rung: 'B', hard: false },
  'run.retries': { source: 'telemetry', rung: 'B', hard: false },
  'run.denials': { source: 'telemetry', rung: 'B', hard: false, variable: true },
  'run.tool_errors': { source: 'telemetry', rung: 'B', hard: false },
  'retry.limit': { source: 'rule', rung: 'C', hard: false },
  'claim.missing': { source: 'claim', rung: 'B', hard: false },
  'claim.unverified': { source: 'claim', rung: 'B', hard: false },
  'claim.low_confidence': { source: 'claim', rung: 'C', hard: false },
  'agent.requested': { source: 'agent', rung: 'B', hard: false, variable: true },
  'user.escalated': { source: 'user', rung: 'B', hard: false, variable: true },
  'reviewer.revise': { source: 'reviewer', rung: 'B', hard: false },
  'reviewer.findings': { source: 'reviewer', rung: 'C', hard: false },
  'reviewer.escalated': { source: 'reviewer', rung: 'C', hard: false, variable: true },
  'reviewer.claim_contradicted': { source: 'reviewer', rung: 'C', hard: false },
  'reviewer.no_report': { source: 'reviewer', rung: 'C', hard: false },
  'reviewer.skipped_budget': { source: 'policy', rung: 'C', hard: false },
  'policy.invalid': { source: 'policy', rung: 'C', hard: false },
  'policy.base_differs': { source: 'policy', rung: 'C', hard: false },
  'repo.armed': { source: 'repo', rung: 'E', hard: true },
  'repo.ref_moved': { source: 'repo', rung: 'E', hard: true },
  'reviewer.user_config_changed': { source: 'repo', rung: 'C', hard: true },
  accumulate: { source: 'rule', rung: 'B', hard: false, variable: true },
} as const satisfies Record<string, ReasonDefinition>;

export type ReasonId = keyof typeof REASON_CATALOGUE;
export const REASON_IDS = Object.keys(REASON_CATALOGUE) as ReasonId[];
export const HARD_REASON_IDS = REASON_IDS.filter((id) => REASON_CATALOGUE[id].hard);

export const isReasonId = (id: string): id is ReasonId => Object.hasOwn(REASON_CATALOGUE, id);
