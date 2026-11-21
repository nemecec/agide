import type { TokenUsage } from '../../agents/types';
import { costOf } from '../../usage/prices';
import { BUDGET_ALERT_SHARE, MIN_RESERVATION_USD, type AgentSpend, type BudgetPot, type ReservationResult, type SwarmBudget } from '../budget';

const MIN_CALIBRATION = 0.05;
const MAX_CALIBRATION = 4;

export interface LedgerAgent {
  readonly name: string;
  /** The agent's own budget in USD. */
  readonly budgetUsd: number;
  readonly reviewer: boolean;
}

export interface LedgerOptions {
  readonly usdTotal: number;
  readonly reviewShare: number;
  readonly agents: readonly LedgerAgent[];
}

interface Account {
  readonly agent: LedgerAgent;
  /** The last `total_cost_usd` of each finished process segment, summed. */
  reported: number;
  /** The running process's latest `total_cost_usd` (cumulative per process). */
  segment: number;
  /** Cost of the `assistant` messages since the latest `result`, per message id. */
  readonly estimates: Map<string, number>;
  reserved: number;
  priced: boolean;
  /** Reported cost divided by estimated cost of the account's latest turn: the price table is a list price, the CLI reports what the model costs. */
  calibration: number;
}

/**
 * The budget of one swarm (0037 section 6). Spend is the reported cost of finished segments, the running
 * process's reported cost and an estimate from `assistant` usage since the last `result`. A launch reserves
 * the smaller of the agent's remaining budget and the remainder of its pot, after the agent's own spend; the reservation goes to the CLI as
 * `--max-budget-usd`, so a resumed process, which counts from zero, never gets the full budget again.
 */
export class BudgetLedger {
  private readonly accounts = new Map<string, Account>();
  private readonly reviewUsd: number;

  constructor(private readonly options: LedgerOptions) {
    this.reviewUsd = options.usdTotal * options.reviewShare;
    for (const agent of options.agents) this.accounts.set(agent.name, { agent, reported: 0, segment: 0, estimates: new Map(), reserved: 0, priced: true, calibration: 1 });
  }

  get usdTotal(): number {
    return this.options.usdTotal;
  }

  /** Restores the reported spend of an agent after a restart. */
  restore(name: string, reportedUsd: number): void {
    this.account(name).reported = reportedUsd;
  }

  canReserve(name: string): ReservationResult {
    return this.quote(this.account(name));
  }

  reserve(name: string): ReservationResult {
    const account = this.account(name);
    const quote = this.quote(account);
    if (quote.ok) account.reserved = quote.usd;
    return quote;
  }

  reservationOf(name: string): number {
    return this.account(name).reserved;
  }

  /** An agent's process ended: its reservation is replaced by its spend and the next process starts a new segment. */
  release(name: string): void {
    const account = this.account(name);
    account.reported += account.segment + this.estimateOf(account);
    account.segment = 0;
    account.estimates.clear();
    account.reserved = 0;
  }

  onAssistant(name: string, messageId: string, model: string | undefined, usage: TokenUsage | undefined): void {
    if (usage === undefined) return;
    const account = this.account(name);
    const cost = costOf(model, usage);
    if (cost === undefined) account.priced = false;
    else account.estimates.set(messageId, cost);
  }

  onResult(name: string, totalCostUsd: number): void {
    const account = this.account(name);
    const turnUsd = totalCostUsd - account.segment;
    const estimatedUsd = this.rawEstimate(account);
    if (estimatedUsd > 0 && turnUsd > 0) account.calibration = Math.min(MAX_CALIBRATION, Math.max(MIN_CALIBRATION, turnUsd / estimatedUsd));
    account.segment = totalCostUsd;
    account.estimates.clear();
  }

  /** What the running process has spent; compared with the reservation. */
  processSpend(name: string): number {
    const account = this.account(name);
    return account.segment + this.estimateOf(account);
  }

  spendOf(name: string): AgentSpend {
    const account = this.account(name);
    return { reportedUsd: account.reported + account.segment, estimatedUsd: this.estimateOf(account), reservedUsd: account.reserved, priced: account.priced };
  }

  swarmSpend(): number {
    let total = 0;
    for (const account of this.accounts.values()) total += this.spend(account);
    return total;
  }

  /** True once the swarm's spend crossed the share at which the 80 percent alert fires. */
  atAlertShare(): boolean {
    return this.swarmSpend() >= this.options.usdTotal * BUDGET_ALERT_SHARE;
  }

  atCap(): boolean {
    return this.swarmSpend() >= this.options.usdTotal;
  }

  view(wallClockMs: number, wallClockLimitMs: number): SwarmBudget {
    let reported = 0;
    let estimated = 0;
    let reserved = 0;
    for (const account of this.accounts.values()) {
      reported += account.reported + account.segment;
      estimated += this.estimateOf(account);
      reserved += account.reserved;
    }
    return {
      usdTotal: this.options.usdTotal,
      reviewUsd: this.reviewUsd,
      reportedUsd: reported,
      estimatedUsd: estimated,
      reservedUsd: reserved,
      remainingUsd: Math.max(0, this.options.usdTotal - reported - estimated - reserved),
      wallClockMs,
      wallClockLimitMs,
    };
  }

  private potOf(account: Account): BudgetPot {
    return account.agent.reviewer && this.reviewUsd > 0 ? 'review' : 'work';
  }

  private potCap(pot: BudgetPot): number {
    return pot === 'review' ? this.reviewUsd : this.options.usdTotal - this.reviewUsd;
  }

  private quote(account: Account): ReservationResult {
    const remaining = account.agent.budgetUsd - this.spend(account);
    if (remaining < MIN_RESERVATION_USD) return { ok: false, reason: 'agent-spent' };
    const pot = this.potOf(account);
    let held = 0;
    for (const other of this.accounts.values())
      if (other !== account && this.potOf(other) === pot) held += other.reported + Math.max(other.reserved, other.segment + this.estimateOf(other));
    const usd = Math.min(remaining, this.potCap(pot) - held - this.spend(account));
    return usd < MIN_RESERVATION_USD ? { ok: false, reason: 'swarm-short' } : { ok: true, usd, pot };
  }

  private spend(account: Account): number {
    return account.reported + account.segment + this.estimateOf(account);
  }

  private estimateOf(account: Account): number {
    return this.rawEstimate(account) * account.calibration;
  }

  private rawEstimate(account: Account): number {
    let sum = 0;
    for (const cost of account.estimates.values()) sum += cost;
    return sum;
  }

  private account(name: string): Account {
    const account = this.accounts.get(name);
    if (account === undefined) throw new Error(`no agent ${name} in the ledger`);
    return account;
  }
}
