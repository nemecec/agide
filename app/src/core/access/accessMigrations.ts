import type { Migration } from '../store/index';

export const ACCESS_MODULE = 'access';

/**
 * The access request table of 0043 section 4.10. It follows the `inbox` module's tables: a request is the
 * inbox item that announces it and goes with it. The state and the decision columns hold the invariants the
 * broker keeps: a pending request has no decision time, an allowed one has a scope, a reason and a message
 * belong to a denial.
 */
export const accessMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE access_requests (
        item_id TEXT PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('note.read', 'note.change', 'note.remove', 'mount.read', 'mount.write')),
        target_kind TEXT NOT NULL CHECK (target_kind IN ('note', 'mount')),
        target_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        input TEXT NOT NULL CHECK (json_valid(input)),
        offered TEXT NOT NULL CHECK (json_valid(offered)),
        call_state TEXT NOT NULL CHECK (call_state IN ('waiting', 'returned', 'closed')),
        state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'allowed', 'denied', 'expired', 'withdrawn')),
        scope TEXT CHECK (scope IS NULL OR scope IN ('once', 'session', 'always')),
        reason TEXT CHECK (reason IS NULL OR reason IN ('user', 'stale', 'conflict', 'scope', 'failed')),
        message TEXT CHECK (message IS NULL OR length(message) <= 500),
        performed INTEGER NOT NULL DEFAULT 0 CHECK (performed IN (0, 1)),
        delivery TEXT NOT NULL DEFAULT 'none' CHECK (delivery IN ('none', 'in_call', 'notice', 'stdin', 'context', 'read', 'failed')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        CHECK ((state = 'pending') = (decided_at IS NULL)),
        CHECK ((state = 'allowed') = (scope IS NOT NULL)),
        CHECK (state = 'denied' OR reason IS NULL),
        CHECK (state = 'denied' OR message IS NULL)
      );
      CREATE INDEX access_requests_open ON access_requests (session_id, action, target_id, state);
    `,
  },
];
