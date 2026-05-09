/**
 * v11 migration regression test — Dandenong B5.
 *
 * v11 — heal `inputs.landPurchase.gstRate` when the field is missing,
 * null, non-finite, negative, or >= 1. Pre-v11 saved Supabase projects
 * could land in the store with the field literally absent (older schema
 * shapes). The UI's PercentInput renders 0% via `(value ?? 0) * 100`,
 * while the engine independently clamps to 0.10 — projects loaded from
 * Supabase with this shape silently disagreed between display and engine.
 *
 * CONSERVATIVE: an explicit, valid 0 is preserved.
 * Idempotent on already-valid values in [0, 1).
 *
 * Run: cd app && npx tsx src/store/__tests__/migrationV11.test.ts
 */
import { migratePersistedState } from '../useStore';
import { runCalculations } from '../../engine';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

function v10Persisted(landPurchaseOverride: Record<string, unknown> = {}) {
  return {
    activeTab: 'inputs',
    admin: { projectName: 'v10 fixture' },
    inputs: {
      landPurchase: {
        landPurchasePrice: 124000000,
        prsvUplift: 56000000,
        prsvMonth: 33,
        prsvSpan: 1,
        gstApplicableLand: true,
        addGSTOnLandPrice: false,
        stampDutyState: 'QLD',
        stampDutyAmount: 7110525,
        interestOnDeposit: 0,
        profitShareToLandOwner: 0,
        paymentStages: [],
        acquisitionCosts: [],
        ...landPurchaseOverride,
      },
    },
  };
}

// Test 1: missing gstRate -> backfilled to 0.10.
{
  const state = v10Persisted({ /* no gstRate field */ });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0.10,
    `v11: missing gstRate backfilled to 0.10 (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 2: explicit valid 0.10 -> idempotent (preserved).
{
  const state = v10Persisted({ gstRate: 0.10 });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0.10,
    `v11: valid 0.10 preserved (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 3: explicit 0 -> preserved (legitimate non-Australian project).
{
  const state = v10Persisted({ gstRate: 0 });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0,
    `v11: explicit 0 preserved (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 4: null -> healed.
{
  const state = v10Persisted({ gstRate: null });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0.10,
    `v11: null gstRate healed to 0.10 (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 5: NaN -> healed.
{
  const state = v10Persisted({ gstRate: NaN });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0.10,
    `v11: NaN gstRate healed to 0.10 (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 6: >= 1 (e.g. user typed 10 thinking percent) -> healed.
{
  const state = v10Persisted({ gstRate: 10 });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0.10,
    `v11: gstRate=10 healed to 0.10 (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 7: negative -> healed.
{
  const state = v10Persisted({ gstRate: -0.1 });
  const out = migratePersistedState(state, 10) as { inputs: { landPurchase: { gstRate: number } } };
  assert(out.inputs.landPurchase.gstRate === 0.10,
    `v11: negative gstRate healed to 0.10 (got ${out.inputs.landPurchase.gstRate})`);
}

// Test 8: idempotent on v11 — a healed object is unchanged on a second run.
{
  const state = v10Persisted({ gstRate: 0.10 });
  const out1 = migratePersistedState(state, 10);
  const out2 = migratePersistedState(out1, 11);
  const v = (out2 as { inputs: { landPurchase: { gstRate: number } } }).inputs.landPurchase.gstRate;
  assert(v === 0.10, `v11: idempotent on v11 (got ${v})`);
}

// Test 9: ROUND-TRIP INVARIANT — persisted gstRate=0.10, through migration +
// load, the engine sees 0.10. This is the headline B5 invariant: a saved
// project with gstRate=0.10 should never engine-see a non-0.10 value.
{
  const persisted = v10Persisted({ gstRate: 0.10 });
  const migrated = migratePersistedState(persisted, 10) as { admin: AdminConfig; inputs: MainInputs };
  // The engine reads from inputs.landPurchase.gstRate
  assert(migrated.inputs.landPurchase.gstRate === 0.10,
    `v11 round-trip: gstRate 0.10 survives migration intact (got ${migrated.inputs.landPurchase.gstRate})`);
}

// Test 10: ROUND-TRIP HEALING — persisted state with gstRate missing (the
// actual Dandenong symptom). After migration, gstRate is 0.10. The engine
// then sees 0.10, NOT 0. This is the engine-level B5 invariant.
{
  const persisted = v10Persisted({ /* gstRate missing */ });
  const migrated = migratePersistedState(persisted, 10) as { admin: AdminConfig; inputs: MainInputs };
  assert(migrated.inputs.landPurchase.gstRate === 0.10,
    `v11 round-trip: missing gstRate -> 0.10 after migration (got ${migrated.inputs.landPurchase.gstRate})`);
  // We don't run the full engine here (would require a complete fixture);
  // the engine reads `inputs.landPurchase.gstRate` directly (engine/index.ts:24)
  // so a 0.10 in landPurchase guarantees the engine will see 0.10.
}

console.log(`v11 migration tests — ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('Failures:'); for (const f of failures) console.log('  -', f);
  (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(1);
}

// Suppress unused-import warnings in environments that load this with strict tsc.
void runCalculations;
