/**
 * Reproducer for the Manual S-curve span asymmetry — Kew Demo Extra R2 wedge.
 *
 * `getSCurveWeights()` in costSpreading.ts ignored the `span` argument in the
 * Manual-S-curve branch, returning the full curve normalised to its own
 * length. The consumer in `spreadCost()` then silently dropped weights past
 * the project window without redistributing. Cost items using a manual curve
 * longer than their `monthSpan` therefore leaked the truncated tail out of
 * the cashflow, while feasibility.totalCost continued to include the full
 * nominal `totalCosts`.
 *
 * Kew Demo Extra carried a $3,470,400 R2 wedge under this asymmetry
 * (Architects $2,070,000 + 6 other dev items $1,400,400). Repro here uses a
 * single dev item with a 75-element manual curve over a 28-period model.
 *
 * Run: cd app && npx tsx src/engine/__tests__/manualSCurveSpan.test.ts
 */
import { runCalculations } from '../index';
import { spreadCost } from '../costSpreading';
import type { AdminConfig, MainInputs, Period } from '../../types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++; failures.push(msg);
}
function close(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) <= tol,
    `${msg} — expected ${expected} ±${tol}, got ${actual}`);
}

// Build a 75-element manual curve where most of the weight lies in the first
// ~50 elements (matching the Kew payload pattern). Sum = 100. Indices >= 50
// are zero — but indices 25..49 carry weight, so over a 28-period span the
// tail past index 27 leaks dollars unless the engine truncates.
function kewLikeCurve(): number[] {
  const c = new Array(75).fill(0);
  // Heavy front-loaded weighting indices 1..50 — this is what trips the bug
  // when the cost item only spans 28 months.
  for (let i = 1; i <= 50; i++) c[i] = 2;
  return c;
}

const baseAdmin: AdminConfig = {
  projectName: 'Manual S-curve Span Test',
  modelStartDate: 44927,
  monthsPerPeriod: 1,
  lastActualsPeriod: 44927,
  tolerance: 10,
  daysPerYear: 365,
  monthsPerYear: 12,
  currency: '$',
  sCurveOptions: ['Evenly Split', 'Manual S-curve 1'],
  manualSCurves: [kewLikeCurve(), [], []],
  buildSCurves: {},
  contingencyGSTMode: 'none',
};

function inputsWithManualCurveDevCost(): MainInputs {
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 28, projectEndMonth: 28,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: {
      landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [], acquisitionCosts: [],
    },
    developmentCosts: [{
      code: 'D1', description: 'Architects', costType: 'Development Cost',
      units: 1, baseRate: 4_500_000, totalCosts: 4_500_000,
      sCurve: 'Manual S-curve 1', monthStart: 1, monthSpan: 27,
      addGST: false, ctd: 0, ctc: 4_500_000,
    }],
    constructionCosts: [{
      code: 'C1', description: 'Build', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 28,
      addGST: false, ctd: 0, ctc: 10_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 28,
      addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [{ code: 'S1', description: 'Apt', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{
      code: 'G1', description: 'Apartment', revenueType: 'Apartments',
      units: 1, totalArea: 100, currentSalePrice: 25_000_000, gstIncluded: false,
      preSaleExchangeMonth: 28, preSaleSpan: 1,
      settlementMonth: 28, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Dev', equityCap: 20_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 20_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: 'JV', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: { name: 'S', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

// ── 1. Direct spreadCost test: dev item nominal must equal sum of its spread ──
{
  const inputs = inputsWithManualCurveDevCost();
  // Build a minimal periods array matching projectSpanMonths + 1
  const n = inputs.preliminary.projectSpanMonths + 1;
  const periods: Period[] = Array.from({ length: n }, (_, i) => ({
    periodNumber: i, label: `M${i}`, isActual: false, startDate: 0, endDate: 0,
  } as unknown as Period));
  const item = inputs.developmentCosts[0]!;
  const spread = spreadCost(item, periods, baseAdmin.manualSCurves, baseAdmin.buildSCurves);
  const spreadSum = spread.reduce((s, v) => s + v, 0);
  close(spreadSum, item.totalCosts, 1,
    `spreadCost: dev item with manual curve longer than monthSpan must spread the full nominal — got ${spreadSum.toFixed(2)} vs nominal ${item.totalCosts}`);
}

// ── 2. Engine-level: dev costs sum on cashflow == feasibility totalCost contribution ──
{
  const result = runCalculations(baseAdmin, inputsWithManualCurveDevCost());
  const cf = result.cashflows;
  const sumDevCash = cf.reduce((s, c) => s + (c.developmentCosts ?? 0), 0);
  const feasDev = result.feasibility.developmentCosts;
  close(sumDevCash, feasDev, 1,
    `Σ cashflow.developmentCosts ≈ feasibility.developmentCosts — dollars must not leak`);
}

// ── 3. R2 reconciliation: feasibility.totalProfit ≈ Σ profitDistribution + unreturnedEquity ──
{
  const result = runCalculations(baseAdmin, inputsWithManualCurveDevCost());
  const cf = result.cashflows;
  const wf = cf.reduce((s, c) => s + (c.profitDistribution ?? 0), 0);
  const eqIn = cf.reduce((s, c) => s + (c.equityInjection ?? 0), 0);
  const eqOut = cf.reduce((s, c) => s + (c.equityRepatriation ?? 0), 0);
  const last = cf[cf.length - 1];
  const debt = last
    ? (last.landLoanBalance ?? 0) + (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0)
    : 0;
  const reconciled = wf - Math.max(0, eqIn - eqOut) - debt;
  close(reconciled, result.feasibility.totalProfit, 10,
    `R2: feasibility ≈ waterfall − unrepatriated equity − unpaid debt (within $10)`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`MANUAL-SCURVE-SPAN TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
