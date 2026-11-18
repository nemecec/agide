import type { PlanWindow } from '../agents/types';
import type { Database } from '../store/Store';
import type { PlanStorage } from './UsageEngine';
import type { SessionTotals } from './types';

interface PlanRow {
  window: PlanWindow['window'];
  used_percentage: number;
  resets_at: string;
  observed_at: string;
  source: PlanWindow['source'];
}

/** The `plan_usage` and `usage_totals` tables of migration 1 (0027 section 4); the agents store creates them. */
export class SqliteUsageStore implements PlanStorage {
  constructor(private readonly db: Database) {}

  save(window: PlanWindow): void {
    this.db
      .prepare(
        `INSERT INTO plan_usage (window, used_percentage, resets_at, observed_at, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(window) DO UPDATE SET used_percentage = excluded.used_percentage, resets_at = excluded.resets_at, observed_at = excluded.observed_at, source = excluded.source`,
      )
      .run(window.window, window.usedPercentage, window.resetsAt, window.observedAt, window.source);
  }

  loadPlan(): PlanWindow[] {
    const rows = this.db.prepare('SELECT * FROM plan_usage').all() as unknown as PlanRow[];
    return rows.map((row) => ({ window: row.window, usedPercentage: row.used_percentage, resetsAt: row.resets_at, observedAt: row.observed_at, source: row.source }));
  }

  saveTotals(sessionId: string, totals: SessionTotals, at: string): void {
    const basis = totals.basis ?? null;
    this.db
      .prepare(
        `INSERT INTO usage_totals (session_id, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, cost_basis, final, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, cache_write_tokens = excluded.cache_write_tokens,
           cache_read_tokens = excluded.cache_read_tokens, cost_usd = excluded.cost_usd, cost_basis = excluded.cost_basis, final = excluded.final, updated_at = excluded.updated_at`,
      )
      .run(sessionId, totals.tokens.input, totals.tokens.output, totals.tokens.cacheWrite5m + totals.tokens.cacheWrite1h, totals.tokens.cacheRead, totals.costUsd ?? null, basis, totals.final ? 1 : 0, at);
  }

  loadTotals(sessionId: string): { costUsd?: number; basis?: string; final: boolean } | undefined {
    const row = this.db.prepare('SELECT cost_usd, cost_basis, final FROM usage_totals WHERE session_id = ?').get(sessionId) as { cost_usd: number | null; cost_basis: string | null; final: number } | undefined;
    if (!row) return undefined;
    return { ...(row.cost_usd === null ? {} : { costUsd: row.cost_usd }), ...(row.cost_basis === null ? {} : { basis: row.cost_basis }), final: row.final === 1 };
  }
}
