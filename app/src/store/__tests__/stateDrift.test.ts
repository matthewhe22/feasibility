/**
 * Regression test for the v2-UAT P0: "Inputs ↔ calc-engine state drift".
 *
 * The bug: ProjectManager.handleLoad used setAdmin/setInputs (partial merge)
 * and hydrated cached dashboardData from the saved record. App.calculate then
 * read admin/inputs from a stale React-closure destructure of useStore. Result:
 * Inputs tab showed the new project; Dashboard/Cashflow/Checks showed the
 * previous project (or an inconsistent merge of the two).
 *
 * This test models that load sequence at the store level and asserts:
 *  1. replaceInputs / replaceAdmin do NOT merge — fields absent from the
 *     loaded record do not bleed through.
 *  2. setDashboardData(null) clears the cached snapshot so the UI cannot
 *     flash stale figures while the recalc runs.
 *  3. useStore.getState() always returns the freshest values, regardless
 *     of whether an outer React closure was created earlier.
 *
 * Run:
 *   cd app && npx tsx src/store/__tests__/stateDrift.test.ts
 */
/// <reference types="node" />
// useStore uses zustand's `persist` middleware against localStorage. Node has
// no localStorage, so install a no-op shim before importing the store. The
// debounced flush timer fires ~250 ms after the last setState; we also clear
// the timer at the end of the test by exiting explicitly with process.exit(0).
const memStore = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
  setItem: (k: string, v: string) => { memStore.set(k, v); },
  removeItem: (k: string) => { memStore.delete(k); },
  clear: () => memStore.clear(),
  key: (i: number) => Array.from(memStore.keys())[i] ?? null,
  get length() { return memStore.size; },
} as Storage;

import { useStore } from '../useStore';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++; failures.push(msg);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function buildAdmin(name: string): AdminConfig {
  return {
    projectName: name,
    modelStartDate: 44927,
    monthsPerPeriod: 1,
    lastActualsPeriod: 45900,
    tolerance: 10,
    daysPerYear: 365,
    monthsPerYear: 12,
    currency: '$',
    sCurveOptions: ['Evenly Split'],
    manualSCurves: [[], [], []],
    buildSCurves: {},
  };
}

function buildInputs(landPrice: number, state: string): MainInputs {
  // Minimal MainInputs — only the fields this test cares about. The rest
  // are filled with sensible empty defaults so TS is happy at compile time.
  return {
    preliminary: {
      dateOfFirstPeriod: 45017,
      cashFlowPeriod: 'Monthly',
      projectLots: 100, projectGFA: 10_000, siteArea: 1000,
      projectStartMonth: 1, projectSpanMonths: 36, projectEndMonth: 36,
      equityDistStartMonth: 36, equityDistSpanMonths: 1,
    },
    landPurchase: {
      landPurchasePrice: landPrice,
      prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: state, stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [], acquisitionCosts: [],
    },
    developmentCosts: [], constructionCosts: [], constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [], pmFees: [],
    sellingCosts: [], frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [], rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityJV: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'Land', facilityLimit: 0, startMonth: 1, maturityMonth: 36, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'Mezz', facilityLimit: 0, startMonth: 1, maturityMonth: 36, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: { name: 'Senior', facilityLimit: 0, startMonth: 1, maturityMonth: 36, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name: 'Senior 2', facilityLimit: 0, startMonth: 1, maturityMonth: 36, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'RSF', facilityLimit: 0, startMonth: 1, maturityMonth: 36, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

// ── 1. replaceInputs is wholesale, not partial ──────────────────────────────
{
  const projA = buildInputs(20_000_000, 'QLD');
  const projB = buildInputs(25_000_000, 'NSW');
  // Add a discriminator to project A that is absent on project B
  // (we use the existing optional key versionName on admin instead since
  // MainInputs has no obvious optional-only field).
  const adminA: AdminConfig = { ...buildAdmin('Project A'), versionName: 'A only' };
  const adminB = buildAdmin('Project B');

  // Load A
  useStore.getState().replaceAdmin(adminA);
  useStore.getState().replaceInputs(projA);
  assert(useStore.getState().inputs.landPurchase.landPurchasePrice === 20_000_000,
    'A: land price loaded');
  assert(useStore.getState().inputs.landPurchase.stampDutyState === 'QLD',
    'A: state loaded');
  assert(useStore.getState().admin.versionName === 'A only',
    'A: versionName loaded');

  // Load B — wholesale, must not retain A's versionName
  useStore.getState().replaceAdmin(adminB);
  useStore.getState().replaceInputs(projB);
  assert(useStore.getState().inputs.landPurchase.landPurchasePrice === 25_000_000,
    'B: land price replaced');
  assert(useStore.getState().inputs.landPurchase.stampDutyState === 'NSW',
    'B: state replaced');
  assert(useStore.getState().admin.versionName === undefined,
    'B: A.versionName did NOT bleed through (wholesale replace works)');
}

// ── 2. setInputs (partial merge) STILL works for normal field edits ─────────
{
  const proj = buildInputs(10_000_000, 'VIC');
  useStore.getState().replaceInputs(proj);
  // Single-field edit via setInputs partial merge — should not nuke other fields
  useStore.getState().setInputs({ constructionContingencyPercent: 0.05 });
  assert(useStore.getState().inputs.constructionContingencyPercent === 0.05,
    'setInputs partial merge updates the targeted field');
  assert(useStore.getState().inputs.landPurchase.landPurchasePrice === 10_000_000,
    'setInputs partial merge preserves untouched fields');
}

// ── 3. setDashboardData(null) clears the cached snapshot ────────────────────
{
  // Plant a fake "stale" dashboardData
  useStore.setState({ dashboardData: { headline: { totalProfit: -82_624_290 } } as never });
  assert(useStore.getState().dashboardData !== null, 'precondition: snapshot present');

  // Project-load path now does setDashboardData(null) before kicking off recalc
  useStore.getState().setDashboardData(null);
  assert(useStore.getState().dashboardData === null,
    'setDashboardData(null) clears the cached snapshot — UI cannot flash stale figures');
}

// ── 4. getState() returns fresh values regardless of stale closure ──────────
{
  // Simulate the original bug: capture admin in a closure variable, then
  // mutate the store, then assert that getState() — what calculate() now uses —
  // sees the new value.
  const adminBefore = useStore.getState().admin;
  useStore.getState().replaceAdmin({ ...adminBefore, projectName: 'Renamed' });

  // The closure-captured `adminBefore` is stale (this is the old bug shape).
  assert(adminBefore.projectName !== 'Renamed',
    'closure-captured admin is stale (this is what calculate() used to read)');

  // getState() reads the live store — what calculate() now reads.
  assert(useStore.getState().admin.projectName === 'Renamed',
    'useStore.getState() returns the freshest admin (state-drift fix)');
}

// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(72)}`);
console.log(`STATE-DRIFT TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
// Exit explicitly so the persist middleware's debounced flush timer doesn't
// keep the process alive (it's a setTimeout, not a setInterval, but the
// debounce can re-arm if the test makes more setState calls than we expect).
process.exit(0);
