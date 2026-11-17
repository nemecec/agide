import type { Migration } from '../store/index';

export const TREE_MODULE = 'tree';

export const treeMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE tree_nodes (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('folder', 'leaf')),
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        surface_type TEXT,
        surface_id TEXT,
        CHECK ((kind = 'leaf') = (surface_type IS NOT NULL AND surface_id IS NOT NULL))
      );
      CREATE INDEX tree_nodes_by_parent ON tree_nodes (parent_id, position);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE tree_nodes ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 2000);
      ALTER TABLE tree_nodes ADD COLUMN description_updated_at TEXT;
      ALTER TABLE tree_nodes ADD COLUMN is_project INTEGER NOT NULL DEFAULT 0 CHECK (is_project IN (0, 1));
    `,
  },
];
