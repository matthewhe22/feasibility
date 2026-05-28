/**
 * normalizeProject.ts
 *
 * Single, shared pipeline for turning a raw persisted/DB project record into
 * fully-migrated, defaults-backfilled `{ admin, inputs }` ready for the store
 * and engine. Both the ProjectManager "Load" path and the App startup
 * Demo-load path MUST route through here — divergent normalization between the
 * two was the root of the v2-UAT state-drift class of bugs.
 *
 * Order matters (see ProjectManager.handleLoad history):
 *   1. migratePersistedState on the RAW record (so e.g. v7 sees legacy
 *      `fixedAmount` before defaults can mask it), starting from the record's
 *      stamped schema version.
 *   2. deepMerge with defaults to back-fill any newly-added fields so legacy
 *      iterators don't crash on `undefined`.
 *
 * Schema-version stamping: DB records carry their schema version in the admin
 * blob under `__schemaVersion` (admin is jsonb, so this needs no DB column).
 * Records saved before stamping existed have no marker → treated as version 0,
 * which runs the full (idempotent) ladder exactly as before. Records saved by
 * the current app are stamped CURRENT_SCHEMA_VERSION, so the ladder is skipped
 * and the non-idempotent heuristic steps can't re-fire on already-healed data.
 */
import { migratePersistedState, CURRENT_SCHEMA_VERSION, defaultAdmin, defaultInputs } from './useStore';
import { deepMerge } from '../utils/deepMerge';
import type { AdminConfig, MainInputs } from '../types';

const SCHEMA_VERSION_KEY = '__schemaVersion';

/** Read the schema version stamped on an admin blob (0 if absent/invalid). */
export function readSchemaVersion(admin: unknown): number {
  if (admin && typeof admin === 'object') {
    const v = (admin as Record<string, unknown>)[SCHEMA_VERSION_KEY];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

/** Stamp the current schema version onto an admin blob (returns a copy). */
export function stampSchemaVersion<T extends AdminConfig>(admin: T): T {
  return { ...admin, [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION };
}

/**
 * Migrate + normalize a raw project record. `version` defaults to the value
 * stamped on the admin blob, falling back to 0 for legacy records.
 */
export function normalizeLoadedProject(
  rawAdmin: unknown,
  rawInputs: unknown,
  version: number = readSchemaVersion(rawAdmin),
): { admin: AdminConfig; inputs: MainInputs } {
  const migrated = migratePersistedState(
    { admin: rawAdmin, inputs: rawInputs },
    version,
  ) as { admin: unknown; inputs: unknown };
  return {
    admin: deepMerge(defaultAdmin, (migrated.admin ?? {}) as Partial<AdminConfig>),
    inputs: deepMerge(defaultInputs, (migrated.inputs ?? {}) as Partial<MainInputs>),
  };
}
