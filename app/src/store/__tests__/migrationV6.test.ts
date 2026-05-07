/**
 * v6 migration regression test.
 *
 * v6 — extend `admin.equityDrawdownMode` union with `'senior-first'`. Additive:
 * existing projects keep their persisted mode; missing/invalid values default
 * to `'equity-first'` (current behaviour).
 *
 * Idempotent on v6 data: running v6 migration on already-v6 state with valid
 * mode produces no change; missing/null/garbage values normalise to
 * `'equity-first'`.
 *
 * Run: cd app && npx tsx src/store/__tests__/migrationV6.test.ts
 */
import { migratePersistedState } from '../useStore';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

function v5Persisted(extra: Partial<Record<string, unknown>> = {}) {
  return {
    activeTab: 'inputs',
    admin: {
      projectName: 'v5 fixture',
      modelStartDate: 44927,
      tolerance: 10,
      repaymentSequence: ['senior', 'mezz', 'equity'],
      // equityDrawdownMode field deliberately under control of `extra`.
      ...extra,
    },
    inputs: {},
    currentProjectId: null,
  };
}

// =============================================================================
// V6.1 — v5 with no equityDrawdownMode → defaults to 'equity-first'
// =============================================================================
{
  const p = v5Persisted();
  const out = migratePersistedState(p, 5) as { admin: { equityDrawdownMode?: string } };
  assert(out.admin.equityDrawdownMode === 'equity-first',
    `V6.1 — missing equityDrawdownMode defaults to 'equity-first' (got '${out.admin.equityDrawdownMode}')`);
}

// =============================================================================
// V6.2 — v5 with explicit 'pro-rata' is preserved
// =============================================================================
{
  const p = v5Persisted({ equityDrawdownMode: 'pro-rata' });
  const out = migratePersistedState(p, 5) as { admin: { equityDrawdownMode?: string } };
  assert(out.admin.equityDrawdownMode === 'pro-rata',
    `V6.2 — explicit 'pro-rata' preserved (got '${out.admin.equityDrawdownMode}')`);
}

// =============================================================================
// V6.3 — v6 data with explicit 'senior-first' is preserved (idempotent)
// =============================================================================
{
  const p = v5Persisted({ equityDrawdownMode: 'senior-first' });
  const out = migratePersistedState(p, 6) as { admin: { equityDrawdownMode?: string } };
  assert(out.admin.equityDrawdownMode === 'senior-first',
    `V6.3 — 'senior-first' preserved on v6→v6 idempotent (got '${out.admin.equityDrawdownMode}')`);
}

// =============================================================================
// V6.4 — v5 with garbage value normalises to 'equity-first'
// =============================================================================
{
  const p = v5Persisted({ equityDrawdownMode: 'random-garbage' });
  const out = migratePersistedState(p, 5) as { admin: { equityDrawdownMode?: string } };
  assert(out.admin.equityDrawdownMode === 'equity-first',
    `V6.4 — invalid value normalises to 'equity-first' (got '${out.admin.equityDrawdownMode}')`);
}

// =============================================================================
// V6.5 — null mode normalises
// =============================================================================
{
  const p = v5Persisted({ equityDrawdownMode: null });
  const out = migratePersistedState(p, 5) as { admin: { equityDrawdownMode?: string } };
  assert(out.admin.equityDrawdownMode === 'equity-first',
    `V6.5 — null normalises to 'equity-first' (got '${out.admin.equityDrawdownMode}')`);
}

// =============================================================================
// V6.6 — running on already-v6 with valid mode is no-op
// =============================================================================
{
  const p = v5Persisted({ equityDrawdownMode: 'equity-first' });
  const before = JSON.stringify(p);
  const out = migratePersistedState(p, 6);
  const after = JSON.stringify(out);
  assert(before === after,
    `V6.6 — v6 with valid mode is no-op (before vs after differ: ${before} vs ${after})`);
}

console.log(`V6 migration: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
