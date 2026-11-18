import type { Migration } from '../store/Store';

export const AGENTS_MODULE = 'agents';

/** Migration 1 of 0027 section 4: agent rows, session usage totals and plan usage. */
export const agentMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  agent_id TEXT,
  parent_session_id TEXT,
  parent_agent_id TEXT,
  parent_tool_use_id TEXT,
  swarm_id TEXT,
  workflow_task_id TEXT,
  workflow_dir_id TEXT,
  workflow_index INTEGER,
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('session-started', 'app-started')),
  source TEXT NOT NULL CHECK (source IN ('hook', 'stream', 'transcript')),
  agent_type TEXT CHECK (agent_type IS NULL OR length(agent_type) <= 120),
  label TEXT CHECK (label IS NULL OR length(label) <= 120),
  phase TEXT CHECK (phase IS NULL OR length(phase) <= 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 400),
  state TEXT NOT NULL CHECK (state IN ('running', 'waiting', 'failed', 'done')),
  outcome TEXT CHECK (outcome IN ('completed', 'stopped', 'failed', 'denied', 'lost')),
  outcome_basis TEXT CHECK (outcome_basis IN ('reported', 'derived')),
  project_dir TEXT NOT NULL,
  config_dir TEXT,
  transcript_path TEXT,
  transcript_copy TEXT,
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_basis TEXT CHECK (cost_basis IN ('reported', 'price-table')),
  UNIQUE (session_id, agent_key),
  CHECK ((state IN ('failed', 'done')) = (ended_at IS NOT NULL AND outcome IS NOT NULL)),
  CHECK ((origin = 'app-started') = (agent_key = 'session'))
);
CREATE INDEX agents_by_session ON agents (session_id, state);
CREATE INDEX agents_history ON agents (folder_id, ended_at);

CREATE TABLE usage_totals (
  session_id TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_basis TEXT CHECK (cost_basis IN ('status-line', 'result', 'cost-state', 'price-table')),
  final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE plan_usage (
  window TEXT PRIMARY KEY CHECK (window IN ('five_hour', 'seven_day')),
  used_percentage REAL NOT NULL CHECK (used_percentage >= 0),
  resets_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('status-line', 'rate-limit-event'))
);
`,
  },
];
