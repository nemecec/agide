/**
 * Budget types of 0037 section 6. The ledger that keeps them is w-manager's (`manager/BudgetLedger.ts`).
 *
 * Every figure is in US dollars at list price. Under a subscription, which is how swarms run (0012), the label
 * is "list-price equivalent, not billed".
 */

/** Which pot a reservation comes from: the review allowance (`usdTotal × reviewShare`) or the rest. */
export type BudgetPot = 'review' | 'work';

/** How a dollar figure was obtained (0027 section 12). */
export type SpendBasis = 'reported' | 'estimated';

/** What one agent has spent and holds. */
export interface AgentSpend {
  /** Sum over the agent's process segments of each segment's last `result.total_cost_usd`. */
  readonly reportedUsd: number;
  /** `assistant` usage since the latest `result`, last copy per message id, times the price table. */
  readonly estimatedUsd: number;
  /** The amount reserved for the current or next launch; passed as `--max-budget-usd`. */
  readonly reservedUsd: number;
  /** False when a model of the agent has no price, so `estimatedUsd` leaves out its tokens. */
  readonly priced: boolean;
}

/** The swarm's ledger in one view, for `swarm_status` and the budget meter. */
export interface SwarmBudget {
  readonly usdTotal: number;
  readonly reviewUsd: number;
  readonly reportedUsd: number;
  readonly estimatedUsd: number;
  readonly reservedUsd: number;
  /** `usdTotal − spend − reservations`, never below zero. */
  readonly remainingUsd: number;
  readonly wallClockMs: number;
  readonly wallClockLimitMs: number;
}

/** The answer of a reservation request before a launch or resume. */
export type ReservationResult =
  | { readonly ok: true; readonly usd: number; readonly pot: BudgetPot }
  /** `swarm-short`: the agent waits queued with "waiting for budget"; `agent-spent`: it ends `failed` with `agent-budget`. */
  | { readonly ok: false; readonly reason: 'swarm-short' | 'agent-spent' };

/** A reservation below this stays unlaunched (0037 section 6.2). */
export const MIN_RESERVATION_USD = 0.05;

/** The share of `usdTotal` at which the 80 percent alert fires (0037 section 6.3). */
export const BUDGET_ALERT_SHARE = 0.8;

/** Per-agent budget when the definition names none: `min(usdTotal, 1.00)`. */
export function defaultAgentBudget(usdTotal: number, usdPerAgent: number | undefined): number {
  return usdPerAgent ?? Math.min(usdTotal, 1);
}
