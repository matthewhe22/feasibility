/**
 * Issue 4 (review batch) — equityCap migration order in handleLoad.
 *
 * Background: PR #55 introduced a TWO-LAYER load path in
 * `ProjectManager.handleLoad`:
 *   Layer A: deepMerge(default, rec.inputs)   — back-fill missing fields
 *   Layer B: migratePersistedState(rec, ver)  — version-specific schema fixes
 *
 * Bug: the v6→v7 migration copies `equityDeveloper.fixedAmount` into
 * `equityCap` only when `equityCap` is undefined. With deepMerge running
 * FIRST, `equityCap` is back-filled from `defaultEquityDeveloper.equityCap`
 * (currently $130.4M) before migration looks at it, so the v7 migration
 * skips the copy. The user's legacy `fixedAmount: $16.5M` is silently lost.
 *
 * Fix: swap the order. Migrate the raw record first (so the v7 migration
 * sees `fixedAmount` with no `equityCap` shadow), then deepMerge with the
 * default template to back-fill any other missing fields.
 *
 * Invariant: a v6 record with `fixedAmount: 16500000` and no `equityCap`
 * must end with `equityCap === 16500000` after the load pipeline runs
 * (NOT the default $130.4M).
 *
 * Run: cd app && npx tsx src/store/__tests__/equityCapMigrationOrder.test.ts
 */
import { migratePersistedState, defaultAdmin, defaultInputs } from '../useStore';
import { deepMerge } from '../../utils/deepMerge';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// Reproduce the EXACT (post-fix) sequence ProjectManager.handleLoad runs.
// Migration FIRST on the raw record, deepMerge SECOND with defaults.
function loadLikeProjectManagerPostFix(legacyAdmin: unknown, legacyInputs: unknown, version = 0) {
  const migrated = migratePersistedState(
    { admin: legacyAdmin, inputs: legacyInputs },
    version,
  ) as { admin: AdminConfig; inputs: MainInputs };
  const normalisedAdmin = deepMerge(
    defaultAdmin as unknown as Record<string, unknown>,
    migrated.admin as unknown as Record<string, unknown>,
  ) as unknown as AdminConfig;
  const normalisedInputs = deepMerge(
    defaultInputs as unknown as Record<string, unknown>,
    migrated.inputs as unknown as Record<string, unknown>,
  ) as unknown as MainInputs;
  return { admin: normalisedAdmin, inputs: normalisedInputs };
}

// Reproduce the OLD (pre-fix) order to demonstrate the regression existed.
function loadLikeProjectManagerPreFix(legacyAdmin: unknown, legacyInputs: unknown, version = 0) {
  const normalisedAdmin = deepMerge(
    defaultAdmin as unknown as Record<string, unknown>,
    legacyAdmin as Record<string, unknown> | undefined,
  ) as unknown as AdminConfig;
  const normalisedInputs = deepMerge(
    defaultInputs as unknown as Record<string, unknown>,
    legacyInputs as Record<string, unknown> | undefined,
  ) as unknown as MainInputs;
  const migrated = migratePersistedState(
    { admin: normalisedAdmin, inputs: normalisedInputs },
    version,
  ) as { admin: AdminConfig; inputs: MainInputs };
  return migrated;
}

// Build a minimal v6-shaped persisted record. The key invariant: legacy
// `fixedAmount` field set, no `equityCap` field present.
function v6Record(fixedAmount: number) {
  return {
    admin: { projectName: 'v6 fixture' },
    inputs: {
      equityDeveloper: {
        name: 'Developer', percentage: 0.1,
        fixedAmount,                                   // legacy field
        // equityCap intentionally NOT set
        interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
        equityContribution: 1, profitShare: 1, drawdownPriority: 1,
      },
      equityJV: {
        name: 'JV', percentage: 0.1, fixedAmount: 0,
        interestRate: 0, interestCompound: 1, repayEquityBeforeDebt: 0,
        equityContribution: 0, profitShare: 0, drawdownPriority: 1,
      },
      equityPreferred: {
        name: '', percentage: 0.1, fixedAmount: 0,
        interestRate: 0.13, interestCompound: 1, repayEquityBeforeDebt: 0,
        equityContribution: 0, profitShare: 0, drawdownPriority: 1,
      },
      equityAdditional: {
        name: '', percentage: 0.1, fixedAmount: 0,
        interestRate: 0.13, interestCompound: 1, repayEquityBeforeDebt: 0,
        equityContribution: 0, profitShare: 0, drawdownPriority: 1,
      },
    },
  };
}

const LEGACY_CAP = 16_500_000;

// I4.1 — Post-fix order: legacy fixedAmount survives the load pipeline.
{
  const rec = v6Record(LEGACY_CAP);
  const out = loadLikeProjectManagerPostFix(rec.admin, rec.inputs, 6);
  assert(out.inputs.equityDeveloper.equityCap === LEGACY_CAP,
    'I4.1a — equityCap preserved (got ' + out.inputs.equityDeveloper.equityCap + ', expected ' + LEGACY_CAP + ')');
  assert(out.inputs.equityDeveloper.equityCap !== 130_419_982,
    'I4.1b — equityCap NOT replaced by default (got ' + out.inputs.equityDeveloper.equityCap + ')');
  // Bonus: any field added since the v6 record was saved must still be
  // back-filled from defaults. Layer A / Layer B both run.
  assert(Array.isArray(out.inputs.otherFinancingCosts),
    'I4.1c — defaults still back-fill missing arrays after migrate-first');
}

// I4.2 — Pre-fix order regression check (for completeness — confirms the
// bug existed). Default equityCap shadow caused legacy fixedAmount to be
// dropped silently.
{
  const rec = v6Record(LEGACY_CAP);
  const out = loadLikeProjectManagerPreFix(rec.admin, rec.inputs, 6);
  assert(out.inputs.equityDeveloper.equityCap === 130_419_982,
    'I4.2 — pre-fix order yields default equityCap (regression baseline; got ' + out.inputs.equityDeveloper.equityCap + ')');
}

// I4.3 — Post-fix order is idempotent on a v7+ record (already migrated).
{
  const rec = {
    admin: { projectName: 'v7 fixture' },
    inputs: {
      equityDeveloper: {
        name: 'Developer', percentage: 0.1, equityCap: 25_000_000,
        interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
        equityContribution: 1, profitShare: 1, drawdownPriority: 1,
      },
      equityJV: { name:'JV',percentage:0.1,equityCap:0,interestRate:0,interestCompound:1,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
      equityPreferred: { name:'',percentage:0.1,equityCap:0,interestRate:0.13,interestCompound:1,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
      equityAdditional: { name:'',percentage:0.1,equityCap:0,interestRate:0.13,interestCompound:1,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    },
  };
  const out = loadLikeProjectManagerPostFix(rec.admin, rec.inputs, 7);
  assert(out.inputs.equityDeveloper.equityCap === 25_000_000,
    'I4.3 — v7 record passes through unchanged (got ' + out.inputs.equityDeveloper.equityCap + ')');
}

// I4.4 — Post-fix preserves a NON-default legacy cap of 0 (a valid setting
// meaning "use percentage-based cap"). This guards against a regression
// where deepMerge would treat 0 as "missing" and replace with default.
{
  const rec = v6Record(0);
  const out = loadLikeProjectManagerPostFix(rec.admin, rec.inputs, 6);
  assert(out.inputs.equityDeveloper.equityCap === 0,
    'I4.4 — legacy fixedAmount=0 preserved as equityCap=0 (got ' + out.inputs.equityDeveloper.equityCap + ')');
}

console.log('\nIssue 4 — equityCap Migration Order — ' + passed + ' passed, ' + failed + ' failed');
if (failed) { failures.forEach(f => console.log('  x ' + f)); process.exit(1); }
