import { migrate, type Database } from '../../store/Store';
import { SWARM_MODULE, swarmMigrations } from './swarmMigrations';

export interface SwarmRow {
  id: string;
  folder_id: string | null;
  caller_session_id: string | null;
  depth: number;
  definition: string;
  repo_path: string | null;
  base_commit: string | null;
  state: string;
  stop_reason: string | null;
  usd_total: number;
  wall_clock_ms: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  warnings: string;
}

export interface AgentRow {
  swarm_id: string;
  name: string;
  position: number;
  session_id: string | null;
  state: string;
  reason: string | null;
  interrupted_by: string | null;
  model: string;
  effort: string;
  permission_mode: string;
  workspace: string;
  cwd: string | null;
  branch: string | null;
  pid: number | null;
  reserved_usd: number;
  reported_usd: number;
  estimated_usd: number;
  turns: number;
  retries: number;
  result_text: string | null;
  result_meta: string | null;
  patch_path: string | null;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  resume_message: string | null;
}

const columns = <T extends object>(row: T): string[] => Object.keys(row);

/** The `swarms` and `swarm_agents` tables (0037 section 12). Rows are written at every state change. */
export class SwarmStore {
  constructor(private readonly db: Database) {
    migrate(db, SWARM_MODULE, swarmMigrations);
  }

  saveSwarm(row: SwarmRow): void {
    this.upsert('swarms', row, ['id']);
  }

  saveAgent(row: AgentRow): void {
    this.upsert('swarm_agents', row, ['swarm_id', 'name']);
  }

  swarms(): SwarmRow[] {
    return this.db.prepare('SELECT * FROM swarms ORDER BY created_at, rowid').all() as unknown as SwarmRow[];
  }

  agents(swarmId: string): AgentRow[] {
    return this.db.prepare('SELECT * FROM swarm_agents WHERE swarm_id = ? ORDER BY position').all(swarmId) as unknown as AgentRow[];
  }

  deleteSwarm(id: string): void {
    this.db.prepare('DELETE FROM swarms WHERE id = ?').run(id);
  }

  /** Repositories swarms of this profile used, newest first. */
  repositories(): string[] {
    const rows = this.db.prepare('SELECT repo_path FROM swarms WHERE repo_path IS NOT NULL GROUP BY repo_path ORDER BY MAX(created_at) DESC, repo_path').all() as {
      repo_path: string;
    }[];
    return rows.map((row) => row.repo_path);
  }

  private upsert(table: string, row: object, keys: readonly string[]): void {
    const names = columns(row);
    const updates = names.filter((name) => !keys.includes(name)).map((name) => `${name} = excluded.${name}`);
    const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')}) ON CONFLICT(${keys.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
    this.db.prepare(sql).run(...(Object.values(row) as (string | number | null)[]));
  }
}
