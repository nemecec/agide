import type { Migration } from '../../store/Store';

export const REVIEW_MODULE = 'review';

/**
 * Migration 1 is the schema of 0040 section 3.3 with the decision actions of 0041 (`start_check`,
 * `review_failed`, `undeliverable`), the policy warnings, the swarm's policy on its repository snapshot and the
 * prompt version on a reviewer run. The module is migrated after `swarm`, whose
 * `swarms` table the capture jobs and repository snapshots refer to.
 */
export const reviewMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE review_policies (
  hash TEXT PRIMARY KEY,                       -- of effective_json
  source TEXT NOT NULL CHECK (source IN ('base', 'default', 'invalid')),
  repo_path TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  project_json TEXT,                           -- the file as read; NULL when missing
  user_json TEXT,                              -- the user-level overlay as applied
  effective_json TEXT NOT NULL,
  errors TEXT,                                 -- the zod issues when invalid
  warnings TEXT NOT NULL DEFAULT '[]',         -- JSON: unknown reason ids in rungs
  created_at TEXT NOT NULL
);

CREATE TABLE review_repo_snapshots (           -- section 17, attacks on the host repository
  swarm_id TEXT PRIMARY KEY REFERENCES swarms(id) ON DELETE CASCADE,
  common_dir TEXT NOT NULL,
  config_hash TEXT NOT NULL,                   -- local and worktree config files
  hooks_hash TEXT NOT NULL,                    -- the hooks directory listing and contents
  info_attributes_hash TEXT NOT NULL,
  refs TEXT NOT NULL,                          -- JSON: refs/heads/* and refs/tags/* tips, the agents' own branches left out
  user_config_hash TEXT NOT NULL,              -- the profile's user-level Claude files the reviewer loads
  policy_hash TEXT NOT NULL REFERENCES review_policies(hash),   -- the policy read at swarm start (8.3)
  base_differs INTEGER NOT NULL DEFAULT 0 CHECK (base_differs IN (0, 1)),   -- policy.base_differs for every changeset
  created_at TEXT NOT NULL
);

CREATE TABLE review_capture_jobs (
  id TEXT PRIMARY KEY,
  swarm_id TEXT NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  session_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('quiet-result', 'agent-ended', 'removal')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'no-change', 'failed')),
  changeset_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE review_changesets (
  id TEXT PRIMARY KEY,                         -- 'cs_' and 16 hex characters
  swarm_id TEXT NOT NULL,                      -- no foreign key: the rows outlive the swarm row until retention (3.1)
  agent TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),   -- send-backs before this capture
  trigger TEXT NOT NULL CHECK (trigger IN ('quiet-result', 'agent-ended', 'removal')),
  repo_path TEXT NOT NULL,
  common_dir TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  head_commit TEXT NOT NULL,                   -- the agent's HEAD at capture
  checkpoint_commit TEXT NOT NULL,
  checkpoint_tree TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL REFERENCES review_policies(hash),
  patch_path TEXT NOT NULL,                    -- relative to the profile data directory
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  added INTEGER NOT NULL CHECK (added >= 0),
  removed INTEGER NOT NULL CHECK (removed >= 0),
  worker_tier TEXT NOT NULL CHECK (worker_tier IN ('strong', 'mid', 'small')),
  claim TEXT,                                  -- JSON, agent text: report_outcome or the result text
  telemetry TEXT NOT NULL,                     -- JSON: end state, turns, retries, denials, tool errors, spend
  state TEXT NOT NULL CHECK (state IN ('captured', 'checking', 'assessed', 'in_review', 'queued_for_budget',
                                       'awaiting_human', 'accepted', 'rejected', 'sent_back', 'superseded')),
  rung TEXT NOT NULL CHECK (rung IN ('A', 'B', 'C', 'D', 'E')),
  floor TEXT NOT NULL CHECK (floor IN ('A', 'B', 'C', 'D', 'E')),   -- highest min_rung of a hard reason, or lower after a confirmed demotion (7.4)
  supersedes TEXT REFERENCES review_changesets(id),
  merged_commit TEXT,                          -- set by swarm_merge
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (swarm_id, agent, seq),
  CHECK (rung >= floor),
  CHECK (merged_commit IS NULL OR state = 'accepted')
);
CREATE INDEX review_changesets_open ON review_changesets (state, updated_at);

CREATE TABLE review_files (
  changeset_id TEXT NOT NULL REFERENCES review_changesets(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('A', 'M', 'D', 'R', 'T')),
  old_path TEXT,
  new_path TEXT,
  old_mode TEXT,
  new_mode TEXT,
  old_blob TEXT,
  new_blob TEXT,
  similarity INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'binary', 'symlink', 'submodule', 'large')),
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  odd_name INTEGER NOT NULL DEFAULT 0 CHECK (odd_name IN (0, 1)),
  file_hash TEXT NOT NULL,
  PRIMARY KEY (changeset_id, idx),
  CHECK (old_path IS NOT NULL OR new_path IS NOT NULL)
);

CREATE TABLE review_hunks (
  changeset_id TEXT NOT NULL,
  file_idx INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  old_start INTEGER NOT NULL, old_lines INTEGER NOT NULL,
  new_start INTEGER NOT NULL, new_lines INTEGER NOT NULL,
  section TEXT,                                -- the text after the second @@, agent text
  body TEXT NOT NULL,
  hunk_hash TEXT NOT NULL,
  PRIMARY KEY (changeset_id, file_idx, idx),
  FOREIGN KEY (changeset_id, file_idx) REFERENCES review_files(changeset_id, idx) ON DELETE CASCADE
);

CREATE TABLE review_reasons (
  changeset_id TEXT NOT NULL REFERENCES review_changesets(id) ON DELETE CASCADE,
  reason_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',            -- a path, a finding id or '' for the whole changeset
  source TEXT NOT NULL CHECK (source IN ('rule', 'check', 'telemetry', 'policy', 'claim', 'reviewer', 'agent', 'user', 'repo')),
  evidence TEXT NOT NULL,                      -- JSON, section 7
  min_rung TEXT NOT NULL CHECK (min_rung IN ('A', 'B', 'C', 'D', 'E')),
  hard INTEGER NOT NULL CHECK (hard IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (changeset_id, reason_id, subject)
);

CREATE TABLE review_checks (
  id TEXT PRIMARY KEY,
  changeset_id TEXT REFERENCES review_changesets(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('checkpoint', 'base')),
  commit_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  command TEXT NOT NULL,                       -- JSON argv, app text from the policy
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'passed', 'failed', 'timed_out', 'not_run')),
  not_run_reason TEXT,
  exit_code INTEGER,
  signal TEXT,
  duration_ms INTEGER,
  output_path TEXT,
  output_tail TEXT CHECK (output_tail IS NULL OR length(output_tail) <= 8000),   -- untrusted
  truncated INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK ((outcome = 'running') = (ended_at IS NULL))
);
CREATE INDEX review_checks_base ON review_checks (target, commit_id, policy_hash);

CREATE TABLE review_runs (
  id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL REFERENCES review_changesets(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 2),
  session_id TEXT UNIQUE,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  prompt_version TEXT,                         -- the prompt template's version id (10.3)
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'reported', 'failed', 'cancelled')),
  failure TEXT CHECK (failure IN ('no-report', 'timeout', 'spawn', 'error-result', 'budget', 'superseded', 'user', 'app-exit')),
  pid INTEGER,                                 -- for ending a process that outlived a crash
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  reported_usd REAL NOT NULL DEFAULT 0 CHECK (reported_usd >= 0),
  rejected_calls INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  UNIQUE (changeset_id, attempt)
);

CREATE TABLE review_reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES review_runs(id) ON DELETE CASCADE,
  changeset_id TEXT NOT NULL REFERENCES review_changesets(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('accept', 'revise', 'escalate')),
  escalate_to TEXT CHECK (escalate_to IN ('C', 'D', 'E')),
  claim_check TEXT NOT NULL CHECK (claim_check IN ('confirmed', 'partly', 'contradicted', 'not_checkable')),
  summary TEXT NOT NULL CHECK (length(summary) <= 2000),   -- agent text
  dropped_findings INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  CHECK ((verdict = 'escalate') = (escalate_to IS NOT NULL))
);

CREATE TABLE review_findings (
  report_id TEXT NOT NULL REFERENCES review_reports(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  file_idx INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('new', 'old')),
  line INTEGER NOT NULL CHECK (line >= 1),
  hunk_hash TEXT NOT NULL,
  on_changed_line INTEGER NOT NULL CHECK (on_changed_line IN (0, 1)),
  severity TEXT NOT NULL CHECK (severity IN ('blocker', 'major', 'minor', 'nit')),
  title TEXT NOT NULL,                         -- agent text
  body TEXT NOT NULL,                          -- agent text
  PRIMARY KEY (report_id, idx)
);

CREATE TABLE review_decisions (                -- append-only record of every state or rung change
  id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL REFERENCES review_changesets(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (actor IN ('app', 'reviewer', 'agent', 'user')),
  actor_session_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('start_check', 'assess', 'auto_accept', 'auto_send_back', 'start_review', 'queue_budget',
                                         'report', 'review_failed', 'accept', 'reject', 'send_back', 'reopen', 'escalate',
                                         'request_escalation', 'demote', 'supersede', 'undeliverable', 'no_new_capture', 'merge')),
  from_state TEXT NOT NULL, to_state TEXT NOT NULL,
  from_rung TEXT NOT NULL, to_rung TEXT NOT NULL,
  content_hash TEXT NOT NULL,                  -- what the decision was made on
  reason TEXT,                                 -- user or agent text; required for demote
  created_at TEXT NOT NULL
);
CREATE INDEX review_decisions_by_changeset ON review_decisions (changeset_id, created_at);

CREATE TABLE review_comments (
  id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL REFERENCES review_changesets(id) ON DELETE CASCADE,
  file_idx INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('new', 'old')),
  line INTEGER NOT NULL CHECK (line >= 1),
  hunk_hash TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),   -- user text
  state TEXT NOT NULL CHECK (state IN ('draft', 'sent')),
  sent_in TEXT,                                -- the decision id of the send-back
  created_at TEXT NOT NULL,
  CHECK ((state = 'sent') = (sent_in IS NOT NULL))
);

CREATE TABLE review_seen (
  scope TEXT NOT NULL,                         -- '<swarm id>/<agent>': marks carry across that agent's changesets
  level TEXT NOT NULL CHECK (level IN ('summary', 'file', 'hunk')),
  subject_hash TEXT NOT NULL,
  changeset_id TEXT NOT NULL,                  -- where the mark was made
  how TEXT NOT NULL CHECK (how IN ('dwell', 'marked')),
  seen_at TEXT NOT NULL,
  PRIMARY KEY (scope, level, subject_hash)
);

CREATE TABLE review_spend (
  day TEXT PRIMARY KEY,                        -- local date of the profile, YYYY-MM-DD
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  reported_usd REAL NOT NULL DEFAULT 0 CHECK (reported_usd >= 0)
);
`,
  },
];
