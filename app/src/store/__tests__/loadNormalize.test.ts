/**
 * Load-time schema normalisation regression test — P1 fix on PR #54.
 *
 * Two layers are exercised together because that's the actual sequence run
 * by ProjectManager.handleLoad on every load:
 *   Layer A: deepMerge(default, rec)  — fills in missing fields from defaults
 *   Layer B: migratePersistedState(rec, version) — version-specific migrations
 *
 * Failure modes targeted:
 *   1. Legacy records missing array fields (otherFinancingCosts, rentalIncome,
 *      backEndSellingCosts, frontEndSellingCosts, lettingFees, etc.) cause
 *      engine iterators to hit `undefined` and hard-crash.
 *   2. Legacy records storing the PM-fee rate on `pmFees[i].units` without
 *      `feeRatePercent` silently drift — the engine's per-call default of
 *      0.02 (2%) shadows the user's actual rate.
 *
 * Run: cd app && npx tsx src/store/__tests__/loadNormalize.test.ts
 */
import { migratePersistedState, defaultAdmin, defaultInputs } from '../useStore';
import { deepMerge } from '../../utils/deepMerge';
import { runCalculations } from '../../engine';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

// Reproduce the exact sequence ProjectManager.handleLoad now runs.
function loadLikeProjectManager(legacyAdmin: unknown, legacyInputs: unknown, version = 0) {
  const normalisedAdmin = deepMerge(defaultAdmin as unknown as Record<string, unknown>, legacyAdmin as Record<string, unknown> | undefined);
  const normalisedInputs = deepMerge(defaultInputs as unknown as Record<string, unknown>, legacyInputs as Record<string, unknown> | undefined);
  const migrated = migratePersistedState(
    { admin: normalisedAdmin, inputs: normalisedInputs },
    version,
  ) as { admin: AdminConfig; inputs: MainInputs };
  return migrated;
}

// ===========================================================================
// Layer A — schema normalisation
// ===========================================================================

// LN.1 — Legacy record missing `backEndSellingCosts` array — should be
// back-filled with the empty-array default and the engine should not crash.
{
  const legacyAdmin = { projectName: 'Legacy missing array' };
  // Build a minimal "legacy" inputs object missing backEndSellingCosts (and
  // frontEndSellingCosts and lettingFees — fields added after this record was
  // saved). Everything else passes through from defaults via deepMerge.
  const legacyInputs = {} as Record<string, unknown>;
  const out = loadLikeProjectManager(legacyAdmin, legacyInputs);
  assert(Array.isArray(out.inputs.backEndSellingCosts),
    `LN.1a — backEndSellingCosts is an array after normalisation (got ${typeof out.inputs.backEndSellingCosts})`);
  assert(out.inputs.backEndSellingCosts.length === 0,
    `LN.1b — backEndSellingCosts back-filled with empty array default`);
  assert(Array.isArray(out.inputs.frontEndSellingCosts),
    `LN.1c — frontEndSellingCosts also back-filled`);
  assert(Array.isArray(out.inputs.lettingFees),
    `LN.1d — lettingFees also back-filled`);
  // Engine doesn't crash when iterating these arrays.
  let crashed = false;
  try {
    runCalculations(out.admin, out.inputs);
  } catch (e) {
    crashed = true;
    failures.push(`LN.1e — runCalculations crashed: ${(e as Error).message}`);
  }
  assert(!crashed, `LN.1e — runCalculations completes without crashing on a normalised legacy record`);
}

// LN.2 — Legacy record missing whole nested `seniorFacility` sub-fields:
// deepMerge fills them in field-by-field. Confirm that an override field
// inside seniorFacility is preserved while a new field added after the record
// was saved is back-filled from defaults.
{
  const legacyInputs = {
    seniorFacility: {
      // Pretend the user customised the rate but everything else (including
      // newer fields like lineFeeBasis, interestPaymentFrequency) is missing.
      margin: 0.0345,
    },
  };
  const out = loadLikeProjectManager({}, legacyInputs);
  assert(out.inputs.seniorFacility.margin === 0.0345,
    `LN.2a — user-set margin preserved through normalisation`);
  // Pick a field that's actually present on defaultSeniorFacility — facilityType
  // is a good marker because legacy records definitely missed it before
  // facility-typing was introduced.
  assert(out.inputs.seniorFacility.facilityType === 'development',
    `LN.2b — newer seniorFacility.facilityType back-filled (got ${out.inputs.seniorFacility.facilityType})`);
  assert(out.inputs.seniorFacility.lenderIsGSTExempt === true,
    `LN.2c — seniorFacility.lenderIsGSTExempt back-filled from default`);
}

// ===========================================================================
// Layer B — units→feeRatePercent migration on every pmFees entry
// ===========================================================================

// LN.3 — Legacy record with pmFees[0].units = 0.015 and NO feeRatePercent —
// migration copies units → feeRatePercent. Engine then reads 1.5%, not 2%.
{
  const legacyInputs = {
    pmFees: [
      // pmFees[0] — actual fee row with the rate in `units`.
      {
        code: '6001', description: 'PM Fees',
        costType: 'Development & Project Management Fees',
        units: 0.015, baseRate: 0, totalCosts: 0,
        sCurve: 'Evenly Split', monthStart: 22, monthSpan: 52,
        addGST: true, ctd: 0, ctc: 0,
      },
      // pmFees[1] — placeholder/coupon row, units=1 quantity (not a rate).
      {
        code: '6002', description: 'Coupon CTD',
        costType: 'Development & Project Management Fees',
        units: 1, baseRate: 0, totalCosts: 0,
        sCurve: 'Evenly Split', monthStart: 15, monthSpan: 60,
        addGST: true, ctd: 0, ctc: 0,
      },
    ],
  };
  const out = loadLikeProjectManager({}, legacyInputs, 2 /* persisted at v2 */);
  const pm0 = (out.inputs.pmFees[0] as unknown) as { feeRatePercent?: number; units: number };
  const pm1 = (out.inputs.pmFees[1] as unknown) as { feeRatePercent?: number; units: number };
  assert(pm0.feeRatePercent === 0.015,
    `LN.3a — pmFees[0].units (0.015) copied to feeRatePercent (got ${pm0.feeRatePercent})`);
  assert(pm0.units === 0.015,
    `LN.3b — pmFees[0].units NOT clobbered by migration`);
  assert(pm1.feeRatePercent === undefined || pm1.feeRatePercent === null,
    `LN.3c — pmFees[1] units=1 not treated as a rate (units=1 is out of (0,1) range)`);

  // End-to-end: confirm the engine ACTUALLY consumes the migrated 1.5% rate.
  // Compare two runs on the same inputs — one with the migrated 1.5% rate,
  // one with the engine's fallback 2% — and verify the migrated run produces
  // ~75% of the fallback run's PM fee (1.5/2 = 0.75). This is robust to the
  // PM-fee base composition (construction + dev + finance + GST etc.).
  const inputsAt1pt5 = JSON.parse(JSON.stringify(out.inputs)) as MainInputs;
  const inputsAt2pct = JSON.parse(JSON.stringify(out.inputs)) as MainInputs;
  // Force the comparison case to the engine's default 2% by removing
  // feeRatePercent — engine then falls back to 0.02.
  delete (inputsAt2pct.pmFees[0] as { feeRatePercent?: number }).feeRatePercent;
  let dashboard1pt5, dashboard2pct;
  try {
    dashboard1pt5 = runCalculations(out.admin, inputsAt1pt5);
    dashboard2pct = runCalculations(out.admin, inputsAt2pct);
  } catch (e) {
    failures.push(`LN.3d — runCalculations threw on the migrated record: ${(e as Error).message}`);
  }
  if (dashboard1pt5 && dashboard2pct) {
    const pm1pt5 = dashboard1pt5.feasibility?.pmFee ?? 0;
    const pm2pct = dashboard2pct.feasibility?.pmFee ?? 0;
    const ratio = pm2pct === 0 ? 0 : pm1pt5 / pm2pct;
    // Expect ratio ≈ 0.015/0.02 = 0.75. Allow ±5% tolerance for second-order
    // (compounded) effects from finance-cost feedback.
    const inBand = ratio > 0.71 && ratio < 0.79;
    assert(inBand,
      `LN.3d — engine PM fee at migrated 1.5% ($${pm1pt5.toFixed(0)}) ÷ ` +
      `at default 2% ($${pm2pct.toFixed(0)}) = ${ratio.toFixed(3)} — should be ~0.75 ±5%`);
  }
}

// LN.4 — Idempotent on already-migrated data. Running v3 migration on a record
// that already has feeRatePercent set should NOT overwrite it.
{
  const alreadyMigrated = {
    pmFees: [
      { code: '6001', units: 0.025, feeRatePercent: 0.018, totalCosts: 0,
        baseRate: 0, sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
        addGST: true, ctd: 0, ctc: 0,
        costType: 'Development & Project Management Fees', description: 'PM' },
    ],
  };
  const out = migratePersistedState(
    { admin: {}, inputs: alreadyMigrated },
    0,
  ) as { inputs: { pmFees: Array<{ feeRatePercent?: number; units?: number }> } };
  const pm0_4 = out.inputs.pmFees[0]!;
  assert(pm0_4.feeRatePercent === 0.018,
    `LN.4a — feeRatePercent NOT overwritten (idempotent — got ${pm0_4.feeRatePercent})`);
}

// LN.5 — Legacy record where pmFees[0].units is out-of-range (not a sensible
// rate, e.g. units=2 because the user typed a quantity). The migration falls
// back to 0.02 on pmFees[0] (preserves historical v3 semantics for the
// engine-read entry).
{
  const out = migratePersistedState(
    {
      admin: {},
      inputs: {
        pmFees: [
          { code: '6001', units: 2, baseRate: 500_000, totalCosts: 1_000_000,
            sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12, addGST: true,
            ctd: 0, ctc: 0,
            costType: 'Development & Project Management Fees', description: 'PM' },
        ],
      },
    },
    0,
  ) as { inputs: { pmFees: Array<{ feeRatePercent?: number; units: number }> } };
  const pm0_5 = out.inputs.pmFees[0]!;
  assert(pm0_5.feeRatePercent === 0.02,
    `LN.5a — out-of-range units (2) on pmFees[0] falls back to 0.02 (got ${pm0_5.feeRatePercent})`);
  assert(pm0_5.units === 2,
    `LN.5b — units value preserved`);
}

// ===========================================================================
// Modern record round-trip — no drift introduced by normalisation
// ===========================================================================

// LN.6 — A record built from current defaults, run through Layer A + Layer B,
// produces inputs/admin that match the original (no spurious changes).
{
  const modernAdmin = JSON.parse(JSON.stringify(defaultAdmin)) as Record<string, unknown>;
  const modernInputs = JSON.parse(JSON.stringify(defaultInputs)) as Record<string, unknown>;
  const out = loadLikeProjectManager(modernAdmin, modernInputs, 11);
  // Compare deep-equality on a few key fields that previously had migration risk.
  const a = out.inputs as MainInputs;
  const b = defaultInputs as MainInputs;
  assert(a.pmFees[0]?.feeRatePercent === b.pmFees[0]?.feeRatePercent,
    `LN.6a — modern pmFees[0].feeRatePercent unchanged through normalise+migrate`);
  assert(JSON.stringify(a.frontEndSellingCosts) === JSON.stringify(b.frontEndSellingCosts),
    `LN.6b — modern frontEndSellingCosts unchanged`);
  assert(JSON.stringify(a.minEquityRequirement) === JSON.stringify(b.minEquityRequirement),
    `LN.6c — modern minEquityRequirement unchanged`);
  assert(a.landPurchase.gstRate === b.landPurchase.gstRate,
    `LN.6d — modern gstRate unchanged`);
  // Calculate dashboards and confirm they match (no behaviour drift).
  const before = runCalculations(defaultAdmin, defaultInputs);
  const after = runCalculations(out.admin, out.inputs);
  assert(before.feasibility?.totalProfit === after.feasibility?.totalProfit,
    `LN.6e — modern record total profit unchanged after round-trip ` +
    `(before $${before.feasibility?.totalProfit?.toFixed(0)} ` +
    `vs after $${after.feasibility?.totalProfit?.toFixed(0)})`);
}

// ===========================================================================
// Cross-version load — every persisted version (0..11) loads without crashing
// ===========================================================================

// LN.7 — A minimal "legacy" record claimed at every plausible version is
// normalised, migrated, and runs through the engine without throwing.
{
  for (let v = 0; v <= 11; v++) {
    const legacyAdmin = { projectName: `v${v} fixture` };
    // Use defaults as the carrier, but strip a couple of fields so Layer A
    // has work to do at every version.
    const stripped = JSON.parse(JSON.stringify(defaultInputs)) as Record<string, unknown>;
    delete stripped.backEndSellingCosts;
    delete stripped.frontEndSellingCosts;
    delete stripped.lettingFees;
    let crashed = false;
    let crashMsg = '';
    try {
      const out = loadLikeProjectManager(legacyAdmin, stripped, v);
      runCalculations(out.admin, out.inputs);
    } catch (e) {
      crashed = true;
      crashMsg = (e as Error).message;
    }
    assert(!crashed, `LN.7.v${v} — load + normalise + migrate + runCalculations completes (${crashMsg})`);
  }
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`LOAD-NORMALISE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
