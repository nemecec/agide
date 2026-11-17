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
];
