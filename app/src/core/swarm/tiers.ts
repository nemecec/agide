import { TIERS, type AgentRole, type Effort, type Tier } from './definition';

/** One row of the tier table: the `--model` alias and the `--effort` value (0037 section 5). */
export interface TierEntry {
  readonly model: string;
  readonly effort: Effort;
}

export type TierTable = Readonly<Record<Tier, TierEntry>>;

/** The table of 0003, 0011 and 0037. The profile setting `swarm.tiers` replaces rows of it. */
export const DEFAULT_TIERS: TierTable = { strong: { model: 'fable', effort: 'high' }, mid: { model: 'sonnet', effort: 'medium' }, small: { model: 'haiku', effort: 'low' } };

export const ROLE_TIERS: Readonly<Record<AgentRole, Tier>> = { reviewer: 'strong', worker: 'mid', mechanical: 'small' };

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh'];

/** True when `tier` is stronger than `than`. */
export function isStrongerTier(tier: Tier, than: Tier): boolean {
  return TIERS.indexOf(tier) < TIERS.indexOf(than);
}

/** The model and effort an agent runs with, and whether `maxTier` lowered what it asked for. */
export interface ResolvedTier {
  readonly tier: Tier;
  readonly model: string;
  readonly effort: Effort;
  readonly capped: boolean;
}

/**
 * The tier of an agent under the swarm's `maxTier`: an agent that asks for a stronger tier runs on `maxTier`,
 * and its own `effort` never goes above the effort of the `maxTier` row.
 */
export function resolveTier(
  table: TierTable,
  maxTier: Tier,
  agent: { readonly role: AgentRole; readonly tier?: Tier | undefined; readonly effort?: Effort | undefined },
): ResolvedTier {
  const asked = agent.tier ?? ROLE_TIERS[agent.role];
  const tier = isStrongerTier(asked, maxTier) ? maxTier : asked;
  const ceiling = table[maxTier].effort;
  const wanted = agent.effort ?? table[tier].effort;
  const effort = EFFORTS.indexOf(wanted) > EFFORTS.indexOf(ceiling) ? ceiling : wanted;
  return { tier, model: table[tier].model, effort, capped: tier !== asked || effort !== wanted };
}
