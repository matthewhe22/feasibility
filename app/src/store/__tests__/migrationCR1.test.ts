/**
 * CR1 — v5 migration regression test.
 *
 * PR-D (PR #31) added `admin.repaymentSequence` as a configurable field with
 * default ['senior', 'mezz', 'equity'] but no migration step. v4 users hit
 * the engine with `undefined`, and the funding solver branches on this value
 * (see funding.ts solveFunding — `repaymentSequence` parameter).
 *
 * v5 migration: default to ['senior', 'mezz', 'equity'] when missing/undefined.
 * Idempotent on v5 data.
 *
 * Run: cd app && npx tsx src/store/__tests__/migrationCR1.test.ts
 */
import { migratePersistedState } from '../useStore';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// Helper — synthetic v4-shaped state (looks like what the persist middleware
// would write before this PR). Only the bits relevant to the migration.
function v4Persisted() {
  return {
    activeTab: 'inputs',
    admin: {
      projectName: 'Legacy v4 fixture',
      modelStartDate: 44927,
      tolerance: 10,
      // No `repaymentSequence` field — that's the bug under test.
      // No `dscrTarget` (already migrated v3→v4).
    },
    inputs: { /* opaque to this test */ },
    currentProjectId: null,
  };
}

// ============================================================================
// CR1.1 — v4 → v5 sets default repaymentSequence
// ============================================================================
{
  const p = v4Persisted();
  const out = migratePersistedState(p, 4) as { admin: { repaymentSequence?: string[] } };
  assert(Array.isArray(out.admin.repaymentSequence),
    `CR1.1a — repaymentSequence is now an array (got ${JSON.stringify(out.admin.repaymentSequence)})`);
  assert(out.admin.repaymentSequence?.length === 3,
    `CR1.1b — repaymentSequence has 3 entries`);
  assert(out.admin.repaymentSequence?.[0] === 'senior'
      && out.admin.repaymentSequence?.[1] === 'mezz'
      && out.admin.repaymentSequence?.[2] === 'equity',
    `CR1.1c — repaymentSequence is exactly ['senior', 'mezz', 'equity']`);
}

// ============================================================================
// CR1.2 — Migration is IDEMPOTENT on v5 data (already-migrated state)
// User-customised sequence (e.g. mezz-first) must NOT be overwritten.
// ============================================================================
{
  const p = {
    admin: {
      projectName: 'Already v5',
      // user has explicitly customised the sequence
      repaymentSequence: ['mezz', 'senior', 'equity'],
    },
    inputs: {},
  };
  // Simulate running migrate from v5 (no-op path — version >= 5 short-circuits the block)
  const out = migratePersistedState(p, 5) as { admin: { repaymentSequence?: string[] } };
  assert(out.admin.repaymentSequence?.[0] === 'mezz'
      && out.admin.repaymentSequence?.[1] === 'senior'
      && out.admin.repaymentSequence?.[2] === 'equity',
    `CR1.2a — user's mezz-first custom sequence preserved on v5 (got ${JSON.stringify(out.admin.repaymentSequence)})`);
}

// ============================================================================
// CR1.3 — Empty array (legacy edge case) is treated as missing and replaced
// ============================================================================
{
  const p = { admin: { projectName: 'Empty array', repaymentSequence: [] }, inputs: {} };
  const out = migratePersistedState(p, 4) as { admin: { repaymentSequence?: string[] } };
  assert(out.admin.repaymentSequence?.length === 3,
    `CR1.3a — empty repaymentSequence array replaced with default`);
}

// ============================================================================
// CR1.4 — Null persisted state passes through unchanged (defensive guard)
// ============================================================================
{
  assert(migratePersistedState(null, 4) === null,
    `CR1.4a — null state returns null`);
  assert(migratePersistedState(undefined, 4) === undefined,
    `CR1.4b — undefined state returns undefined`);
}

// ============================================================================
// CR1.5 — Missing admin object — migrate must not crash
// ============================================================================
{
  const p = { activeTab: 'inputs', inputs: {} } as Record<string, unknown>;
  const out = migratePersistedState(p, 4);
  assert(out === p, `CR1.5a — state with no admin returns the same object`);
}

// ============================================================================
// CR1.6 — Combined v3→v5 migration runs all intermediate steps
// ============================================================================
{
  const p = {
    admin: {
      projectName: 'Legacy v3',
      dscrTarget: 1.25,  // v3 field — should be removed by v4 migration
      // No repaymentSequence — should be added by v5
    },
    inputs: {
      pmFees: [{ units: 0.025, totalCosts: 0 }],  // legacy PM-fee rate (will be migrated to feeRatePercent in v3)
    },
  };
  const out = migratePersistedState(p, 2) as {
    admin: { dscrTarget?: number; repaymentSequence?: string[] };
    inputs: { pmFees?: Array<{ feeRatePercent?: number; units?: number }> };
  };
  assert(out.admin.dscrTarget === undefined,
    `CR1.6a — dscrTarget removed by v4 migration step`);
  assert(out.admin.repaymentSequence?.[0] === 'senior',
    `CR1.6b — repaymentSequence added by v5 migration step`);
  assert(out.inputs.pmFees?.[0]?.feeRatePercent === 0.025,
    `CR1.6c — legacy units→feeRatePercent v3 migration also ran (combined upgrade)`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`CR1 MIGRATION TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
