import type { Database } from '../../store/Store';
import { MIN_RESERVATION_USD } from '../../swarm/budget';
import type { SwarmId } from '../../swarm/types';
import type { ReviewBudget, ReviewQuote } from '../types';

export interface SqliteReviewBudgetOptions {
  readonly db: Database;
  /** The review pot of the swarm in USD: its total budget times its `reviewShare`. */
  readonly potUsd: (swarmId: SwarmId) => number;
  /** The daily limit that applies to the swarm: the profile's, lowered by the swarm's policy. */
  readonly dailyUsd: (swarmId: SwarmId) => number;
  /** The profile's local date as `YYYY-MM-DD`. */
  readonly dayOf: (at: Date) => string;
  readonly now?: () => Date;
}

interface DayRow {
  reserved_usd: number;
  reported_usd: number;
}

/**
 * The review budget (0040 section 16): the swarm's review pot and the day's allowance. The pot is read from the
 * reviewer runs the store holds, so it survives a restart: a running or queued run counts its reservation, an ended
 * one its reported cost, and a run that ended with the app keeps its reservation. The day's totals are in
 * `review_spend`, with the reservation of every run that has not settled.
 */
export class SqliteReviewBudget implements ReviewBudget {
  private readonly open = new Map<string, { readonly day: string; readonly usd: number }>();
  private readonly now: () => Date;

  constructor(private readonly options: SqliteReviewBudgetOptions) {
    this.now = options.now ?? (() => new Date());
  }

  reserve(swarmId: SwarmId, runId: string, usdPerRun: number): ReviewQuote {
    const usd = Math.min(usdPerRun, this.options.potUsd(swarmId) - this.potSpent(swarmId));
    if (usd < MIN_RESERVATION_USD) return { ok: false, why: 'pot' };
    const day = this.options.dayOf(this.now());
    const row = this.day(day);
    if (row.reserved_usd + row.reported_usd + usd > this.options.dailyUsd(swarmId) + 1e-9) return { ok: false, why: 'daily' };
    this.addToDay(day, usd, 0);
    this.open.set(runId, { day, usd });
    return { ok: true, usd };
  }

  settle(runId: string, reportedUsd: number): void {
    const held = this.open.get(runId) ?? this.fromRun(runId);
    this.open.delete(runId);
    if (held === undefined) return;
    this.addToDay(held.day, -held.usd, reportedUsd);
  }

  /** What the swarm's runs hold of its pot. */
  potSpent(swarmId: SwarmId): number {
    const row = this.options.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN r.state IN ('queued', 'running') OR (r.failure = 'app-exit' AND r.reported_usd = 0) THEN r.reserved_usd ELSE r.reported_usd END), 0) AS spent
         FROM review_runs r JOIN review_changesets c ON c.id = r.changeset_id WHERE c.swarm_id = ?`,
      )
      .get(swarmId) as { spent: number };
    return Number(row.spent);
  }

  /** The day's reserved and reported amounts. */
  spentOn(day: string): { readonly reservedUsd: number; readonly reportedUsd: number } {
    const row = this.day(day);
    return { reservedUsd: row.reserved_usd, reportedUsd: row.reported_usd };
  }

  /** A reservation made before a restart: the run row has its amount and the day it was queued. */
  private fromRun(runId: string): { readonly day: string; readonly usd: number } | undefined {
    const row = this.options.db.prepare("SELECT reserved_usd, queued_at FROM review_runs WHERE id = ?").get(runId) as { reserved_usd: number; queued_at: string } | undefined;
    return row === undefined ? undefined : { day: this.options.dayOf(new Date(row.queued_at)), usd: Number(row.reserved_usd) };
  }

  private day(day: string): DayRow {
    const row = this.options.db.prepare('SELECT reserved_usd, reported_usd FROM review_spend WHERE day = ?').get(day) as DayRow | undefined;
    return row === undefined ? { reserved_usd: 0, reported_usd: 0 } : { reserved_usd: Number(row.reserved_usd), reported_usd: Number(row.reported_usd) };
  }

  private addToDay(day: string, reservedDelta: number, reportedDelta: number): void {
    const current = this.day(day);
    this.options.db
      .prepare(
        `INSERT INTO review_spend (day, reserved_usd, reported_usd) VALUES (?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET reserved_usd = excluded.reserved_usd, reported_usd = excluded.reported_usd`,
      )
      .run(day, Math.max(0, current.reserved_usd + reservedDelta), Math.max(0, current.reported_usd + reportedDelta));
  }
}
