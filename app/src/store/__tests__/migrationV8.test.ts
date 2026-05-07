/**
 * v8 migration regression test.
 *
 * v8 — added `inputs.minEquityRequirement` term-sheet equity-floor
 * cross-check. Additive only: missing field is backfilled with the
 * disabled default `{ mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }`.
 *
 * Idempotent on v8: a fully-shaped object is preserved; partially-shaped
 * objects have missing/invalid keys filled in.
 *
 * Run: cd app && npx tsx src/store/__tests__/migrationV8.test.ts
 */
import { migratePersistedState } from '../useStore';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

function v7Persisted(extra: Record<string, unknown> = {}) {
  return {
    activeTab: 'inputs',
    admin: { projectName: 'v7 fixture', modelStartDate: 44927, tolerance: 10 },
    inputs: {
      equityDeveloper: { name: 'Developer', equityCap: 130_419_982, percentage: 0.1 },
      ...extra,
    },
  };
}

// Test 1: missing minEquityRequirement -> backfilled with disabled default.
{
  const state = v7Persisted();
  const out = migratePersistedState(state, 7) as { inputs: Record<string, unknown> };
  const m = out.inputs.minEquityRequirement as { mode: string; value: number; basis: string };
  assert(typeof m === 'object' && m !== null, 'v8: minEquityRequirement object created');
  assert(m.mode === 'percent', `v8: default mode=percent (got ${m?.mode})`);
  assert(m.value === 0, `v8: default value=0 (got ${m?.value})`);
  assert(m.basis === 'tdc-incl-finance-costs', `v8: default basis=tdc-incl-finance-costs (got ${m?.basis})`);
}

// Test 2: well-formed v8 object preserved (idempotent on v8).
{
  const state = v7Persisted({ minEquityRequirement: { mode: 'amount', value: 50_000_000, basis: 'tdc' } });
  const out = migratePersistedState(state, 8) as { inputs: Record<string, unknown> };
  const m = out.inputs.minEquityRequirement as { mode: string; value: number; basis: string };
  assert(m.mode === 'amount', `v8 idempotent: mode preserved (got ${m.mode})`);
  assert(m.value === 50_000_000, `v8 idempotent: value preserved (got ${m.value})`);
  assert(m.basis === 'tdc', `v8 idempotent: basis preserved (got ${m.basis})`);
}

// Test 3: partial object — missing keys filled, valid keys preserved.
{
  const state = v7Persisted({ minEquityRequirement: { value: 0.1 } });
  const out = migratePersistedState(state, 7) as { inputs: Record<string, unknown> };
  const m = out.inputs.minEquityRequirement as { mode: string; value: number; basis: string };
  assert(m.value === 0.1, `v8 partial: existing value preserved (got ${m.value})`);
  assert(m.mode === 'percent', `v8 partial: missing mode filled with percent (got ${m.mode})`);
  assert(m.basis === 'tdc-incl-finance-costs', `v8 partial: missing basis filled (got ${m.basis})`);
}

// Test 4: invalid mode/basis values normalised to defaults.
{
  const state = v7Persisted({ minEquityRequirement: { mode: 'bogus', value: 'NaN-string', basis: 'wrong' } });
  const out = migratePersistedState(state, 7) as { inputs: Record<string, unknown> };
  const m = out.inputs.minEquityRequirement as { mode: string; value: number; basis: string };
  assert(m.mode === 'percent', `v8 invalid: mode normalised to percent (got ${m.mode})`);
  assert(m.value === 0, `v8 invalid: non-numeric value normalised to 0 (got ${m.value})`);
  assert(m.basis === 'tdc-incl-finance-costs', `v8 invalid: basis normalised (got ${m.basis})`);
}

// Test 5: array passed in for minEquityRequirement (should be replaced with default).
{
  const state = v7Persisted({ minEquityRequirement: ['not', 'an', 'object'] });
  const out = migratePersistedState(state, 7) as { inputs: Record<string, unknown> };
  const m = out.inputs.minEquityRequirement as { mode: string; value: number; basis: string };
  assert(m.mode === 'percent' && m.value === 0 && m.basis === 'tdc-incl-finance-costs',
    'v8: array replaced with disabled default');
}

// Test 6: v8 migration is no-op on already-migrated state with disabled default.
{
  const state = v7Persisted({ minEquityRequirement: { mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' } });
  const before = JSON.stringify(state);
  migratePersistedState(state, 8);
  const after = JSON.stringify(state);
  assert(before === after, 'v8 idempotent: well-formed default state unchanged');
}

console.log(`\nv8 migration: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}
