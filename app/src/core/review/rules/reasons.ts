import { REASON_CATALOGUE, isReasonId, type ReasonId } from '../reasonCatalogue';
import { maxRung } from '../rungs';
import type { Reason, Rung } from '../schemas';

/** Agent text inside evidence is marked so views and the reviewer prompt treat it as data (0040 section 7.1). */
export const untrusted = (text: string, limit = 500): { readonly untrusted: true; readonly text: string } => ({ untrusted: true, text: text.length > limit ? `${text.slice(0, limit)}...` : text });

/**
 * The rung a reason gets (0040 sections 7.2 and 7.4): the default, or the project policy's entry for the id. A hard
 * reason is never below its default; the policy can only raise it. An id the catalogue does not know is ignored.
 */
export function rungOf(id: ReasonId, overrides: Readonly<Record<string, Rung>>, base: Rung = REASON_CATALOGUE[id].rung): Rung {
  const override = Object.hasOwn(overrides, id) && isReasonId(id) ? overrides[id] : undefined;
  if (override === undefined) return base;
  return REASON_CATALOGUE[id].hard ? maxRung(base, override) : override;
}

export interface ReasonOptions {
  readonly subject?: string;
  readonly evidence?: Record<string, unknown>;
  /** The rung when it depends on the facts (a threshold); the policy entry still applies, and for hard reasons only raises. */
  readonly base?: Rung;
}

/** Makes reasons from the catalogue with the policy's rungs applied. */
export function reasonMaker(overrides: Readonly<Record<string, Rung>>): (id: ReasonId, options?: ReasonOptions) => Reason {
  return (id, options = {}) => {
    const definition = REASON_CATALOGUE[id];
    return {
      id,
      subject: options.subject ?? '',
      source: definition.source,
      evidence: options.evidence ?? {},
      minRung: rungOf(id, overrides, options.base),
      hard: definition.hard,
    };
  };
}
