import type { Migration } from '../store/index';

export const INBOX_MODULE = 'inbox';
export const TASKS_MODULE = 'tasks';

/**
 * Tables of 0021 section 2 that the first slice uses. `folder_removed` and its trigger follow 0023: the trigger
 * runs before the foreign key action empties `folder_id`, so the item still knows its folder was removed.
 * Session summaries live in their own table here, so the session module keeps its migrations to itself.
 */
export const inboxMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE inbox_items (
        id TEXT PRIMARY KEY,
        folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
        folder_removed INTEGER NOT NULL DEFAULT 0 CHECK (folder_removed IN (0, 1)),
        kind TEXT NOT NULL CHECK (kind IN ('status', 'input', 'approval', 'review', 'failure', 'reminder', 'alert')),
        state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'seen', 'snoozed', 'done')),
        urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high')),
        source TEXT NOT NULL CHECK (source IN ('hook', 'agent', 'app', 'scheduler')),
        origin TEXT NOT NULL,
        session_id TEXT,
        agent_id TEXT,
        link_node_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
        link_anchor TEXT,
        message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 140),
        details TEXT CHECK (details IS NULL OR length(details) <= 8000),
        text_author TEXT NOT NULL CHECK (text_author IN ('agent', 'app', 'user')),
        payload TEXT,
        dedupe_key TEXT,
        occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        seen_at TEXT,
        snoozed_until TEXT,
        done_at TEXT,
        resolution TEXT CHECK (resolution IN
          ('answered', 'approved', 'denied', 'dismissed', 'viewed', 'superseded', 'expired', 'acted')),
        CHECK ((state = 'snoozed') = (snoozed_until IS NOT NULL)),
        CHECK ((state = 'done') = (done_at IS NOT NULL AND resolution IS NOT NULL))
      );
      CREATE INDEX inbox_items_open ON inbox_items (state, folder_id, updated_at);
      CREATE INDEX inbox_items_by_session ON inbox_items (session_id, state);
      CREATE UNIQUE INDEX inbox_items_open_dedupe ON inbox_items (dedupe_key)
        WHERE dedupe_key IS NOT NULL AND state <> 'done';
      CREATE TRIGGER inbox_items_folder_removed BEFORE DELETE ON tree_nodes
      BEGIN
        UPDATE inbox_items SET folder_removed = 1 WHERE folder_id = OLD.id;
      END;
      CREATE TABLE session_summaries (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL CHECK (length(summary) <= 400),
        generated_at TEXT NOT NULL,
        model TEXT
      );
    `,
  },
];

/** Tasks, schedules and their runs (0021 section 2). Initialized after `inbox`, since runs refer to items. */
export const taskMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
        link_node_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        notes TEXT CHECK (notes IS NULL OR length(notes) <= 8000),
        state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
        owner TEXT NOT NULL CHECK (owner IN ('user', 'agent')),
        owner_session_id TEXT,
        external_url TEXT,
        due_at TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        CHECK ((owner = 'agent') = (owner_session_id IS NOT NULL)),
        CHECK ((state IN ('done', 'cancelled')) = (completed_at IS NOT NULL))
      );
      CREATE INDEX tasks_by_folder ON tasks (folder_id, state, position);
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('reminder', 'agent_run')),
        folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
        link_node_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
        details TEXT CHECK (details IS NULL OR length(details) <= 8000),
        dtstart TEXT NOT NULL,
        tzid TEXT NOT NULL,
        rrule TEXT,
        catch_up TEXT NOT NULL DEFAULT 'latest' CHECK (catch_up IN ('latest', 'each', 'none')),
        prompt TEXT,
        approved_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        next_due_at TEXT,
        last_due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((kind = 'agent_run') = (prompt IS NOT NULL))
      );
      CREATE INDEX schedules_due ON schedules (enabled, next_due_at);
      CREATE TABLE schedule_runs (
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        due_at TEXT NOT NULL,
        fired_at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('fired', 'caught_up', 'folded', 'skipped')),
        item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
        PRIMARY KEY (schedule_id, due_at)
      );
    `,
  },
];
