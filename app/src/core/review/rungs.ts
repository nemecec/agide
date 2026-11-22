import { createHash } from 'node:crypto';
import type { Tier } from '../swarm/definition';
import { RUNGS, type Rung, type StoredReason } from './schemas';

export const rungIndex = (rung: Rung): number => RUNGS.indexOf(rung);

/** The highest of the rungs, at least A. */
export function maxRung(...rungs: readonly Rung[]): Rung {
  return rungs.reduce<Rung>((top, rung) => (rungIndex(rung) > rungIndex(top) ? rung : top), 'A');
}

/** One rung up, at most E. */
export const rungAbove = (rung: Rung): Rung => RUNGS[Math.min(RUNGS.length - 1, rungIndex(rung) + 1)]!;

/** A confirmed demotion by the user (0040 section 7.3): it holds against reasons the user already weighed. */
export interface RungDemotion {
  readonly toRung: Rung;
  /** The floor after the demotion: unchanged, or lowered by the second confirmation. */
  readonly floor: Rung;
  /** Reasons created after this time raise the rung and the floor again. */
  readonly at: string;
}

/**
 * The rung and floor of a unit (0040 sections 7.3 and 7.4): the highest `minRung` of every reason and the highest
 * of the hard reasons. After a demotion only the reasons added later count on top of the demoted values.
 * Accumulation is a reason of its own that the rules add at assessment, so it is not computed here.
 */
export function computeRung(reasons: readonly StoredReason[], demotion?: RungDemotion): { readonly rung: Rung; readonly floor: Rung } {
  const counted = demotion === undefined ? reasons : reasons.filter((reason) => reason.createdAt > demotion.at);
  const floor = maxRung(demotion?.floor ?? 'A', ...counted.filter((reason) => reason.hard).map((reason) => reason.minRung));
  const rung = maxRung(demotion?.toRung ?? 'A', floor, ...counted.map((reason) => reason.minRung));
  return { rung, floor };
}

const TIER_ORDER: readonly Tier[] = ['small', 'mid', 'strong'];

/** The reviewer's tier: never below the working agent's (0040 section 10.1). */
export const reviewerTier = (policyTier: Tier, workerTier: Tier): Tier => (TIER_ORDER.indexOf(workerTier) > TIER_ORDER.indexOf(policyTier) ? workerTier : policyTier);

/** SHA-256 in hex over the fields joined by NUL (0040 section 3.2). */
export const fieldsHash = (...fields: readonly string[]): string => createHash('sha256').update(fields.join('\0')).digest('hex');

/** The hash a `summary` seen mark binds to: content, rung, sorted reason ids and the latest report. */
export const summaryHash = (contentHash: string, rung: Rung, reasonIds: readonly string[], latestReportId: string | undefined): string =>
  fieldsHash(contentHash, rung, [...reasonIds].sort().join(','), latestReportId ?? '');
