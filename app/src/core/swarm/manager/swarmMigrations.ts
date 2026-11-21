import type { Migration } from '../../store/Store';

export const SWARM_MODULE = 'swarm';

/** Migration 1 is the schema of 0037 section 12. Migration 2 adds what restart needs: the swarm's warnings and an agent's pending message. */
export const swarmMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE swarms (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  caller_session_id TEXT,
  depth INTEGER NOT NULL CHECK (depth BETWEEN 0 AND 2),
  definition TEXT NOT NULL,
  repo_path TEXT,
  base_commit TEXT,
  state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'done', 'failed', 'stopped')),
  stop_reason TEXT,
  usd_total REAL NOT NULL CHECK (usd_total > 0),
  wall_clock_ms INTEGER NOT NULL DEFAULT 0 CHECK (wall_clock_ms >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK ((state IN ('done', 'failed', 'stopped')) = (ended_at IS NOT NULL))
);
CREATE INDEX swarms_by_state ON swarms (state, created_at);

CREATE TABLE swarm_agents (
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  session_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'waiting', 'interrupted', 'done', 'failed', 'stopped')),
  reason TEXT,
  interrupted_by TEXT CHECK (interrupted_by IN ('user', 'caller', 'pause', 'quit', 'crash')),
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  permission_mode TEXT NOT NULL CHECK (permission_mode IN ('plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions')),
  workspace TEXT NOT NULL CHECK (workspace IN ('worktree', 'readonly', 'scratch')),
  cwd TEXT,
  branch TEXT,
  pid INTEGER,
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  reported_usd REAL NOT NULL DEFAULT 0 CHECK (reported_usd >= 0),
  estimated_usd REAL NOT NULL DEFAULT 0 CHECK (estimated_usd >= 0),
  turns INTEGER NOT NULL DEFAULT 0 CHECK (turns >= 0),
  retries INTEGER NOT NULL DEFAULT 0 CHECK (retries BETWEEN 0 AND 1),
  result_text TEXT CHECK (result_text IS NULL OR length(result_text) <= 8000),
  result_meta TEXT,
  patch_path TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (swarm_id, name),
  CHECK ((state IN ('done', 'failed', 'stopped')) = (ended_at IS NOT NULL)),
  CHECK ((state = 'interrupted') = (interrupted_by IS NOT NULL)),
  CHECK (state IN ('queued', 'failed', 'stopped') OR session_id IS NOT NULL)
);
CREATE INDEX swarm_agents_live ON swarm_agents (state, queued_at);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE swarms ADD COLUMN warnings TEXT NOT NULL DEFAULT '[]';
ALTER TABLE swarm_agents ADD COLUMN resume_message TEXT;
`,
  },
];
