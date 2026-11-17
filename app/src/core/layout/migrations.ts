import { LAYOUT_SCHEMA_VERSION } from '../blocks/layout';

/** One step of the layout file format: a pure function from version `from` to `from + 1`. */
export interface LayoutMigration {
  readonly from: number;
  migrate(document: Record<string, unknown>): Record<string, unknown>;
}

/** Steps from older schema versions. Version 1 is the first, so there are none yet; a step ships with its fixture test. */
export const LAYOUT_MIGRATIONS: readonly LayoutMigration[] = [];

export type MigrationResult =
  | { readonly status: 'ok'; readonly document: unknown; readonly migratedFrom?: number }
  | { readonly status: 'newer'; readonly schemaVersion: number }
  | { readonly status: 'invalid'; readonly message: string };

/**
 * Brings a parsed layout file to `target`. A file above `target` is reported as `newer`: the app opens it
 * read only. Migration runs in memory; the caller decides when to write the result.
 */
export function migrateLayout(
  raw: unknown,
  migrations: readonly LayoutMigration[] = LAYOUT_MIGRATIONS,
  target: number = LAYOUT_SCHEMA_VERSION,
): MigrationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { status: 'invalid', message: 'a layout file holds one JSON object with schemaVersion, revision, id, title, instances and arrangement' };
  }
  let document = raw as Record<string, unknown>;
  const version = document['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { status: 'invalid', message: `schemaVersion must be an integer; add "schemaVersion": ${target}` };
  }
  if (version > target) return { status: 'newer', schemaVersion: version };
  let current = version;
  while (current < target) {
    const step = migrations.find((migration) => migration.from === current);
    if (!step) return { status: 'invalid', message: `no migration from schemaVersion ${current}; this build reads version ${target}` };
    document = { ...step.migrate(document), schemaVersion: current + 1 };
    current += 1;
  }
  return { status: 'ok', document, ...(version < target ? { migratedFrom: version } : {}) };
}
