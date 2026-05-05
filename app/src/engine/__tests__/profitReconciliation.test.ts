/**
 * Regression tests for the v2-UAT profit-vs-waterfall reconciliation
 * (UAT v2 issues #5 + #19):
 *
 *   - Old check compared accounting feasibilityProfit against
 *     Σ profitDistributions (which is floored at 0). On a loss-making
 *     project the variance always equalled (unrepatriated equity + unpaid
 *     debt) — about $82.6M in the UAT — and was dismissed as "rounding".
 *
 *   - Old equityReturns.total used feasibilityProfit, while jvPartner /
 *     developer used waterfall sums — so Total ≠ JV + Dev (Table 3 column
 *     sums broken).
 *
 * This test covers:
 *   1. equityReturns.total.totalProfitShare === jvPartner + developer (always).
 *   2. On a profitable project, feasibilityProfit ≈ Σ waterfall distributions
 *      (existing behaviour preserved — sanity check the fix didn't regress
 *      the happy path).
 *
 * Run: cd app && npx tsx src/engine/__tests__/profitReconciliation.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

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

const baseAdmin: AdminConfig = {
  projectName: 'Reconciliation Test',
  modelStartDate: 44927,
  monthsPerPeriod: 1,
  lastActualsPeriod: 44927,
  tolerance: 10,
  daysPerYear: 365,
  monthsPerYear: 12,
  currency: '$',
  sCurveOptions: ['Evenly Split'],
  manualSCurves: [[], [], []],
  buildSCurves: {},
  contingencyGSTMode: 'none',
};

// Profitable scenario — $20M GRV, $10M build cost, no GST → ~$10M profit.
function profitableInputs(): MainInputs {
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 12, projectEndMonth: 12,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: {
      landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [], acquisitionCosts: [],
    },
    developmentCosts: [],
    constructionCosts: [{
      code: 'C1', description: 'Build', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
      addGST: false, ctd: 0, ctc: 10_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0,
      feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
      addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [{ code: 'S1', description: 'Apt', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{
      code: 'G1', description: 'Apartment', revenueType: 'Apartments',
      units: 1, totalArea: 100,
      currentSalePrice: 20_000_000,
      gstIncluded: false,
      preSaleExchangeMonth: 12, preSaleSpan: 1,
      settlementMonth: 12, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Dev', fixedAmount: 15_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 15_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: 'JV', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: { name: 'S', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

// ── 1. Total row equals JV + Developer rows (Table 3 column-sum invariant) ──
{
  const result = runCalculations(baseAdmin, profitableInputs());
  const t = result.equityReturns.total;
  const jv = result.equityReturns.jvPartner;
  const dev = result.equityReturns.developer;
  // After fix: total uses waterfall sums, same as JV + Dev. Strict equality.
  close(t.totalProfitShare, jv.totalProfitShare + dev.totalProfitShare, 1,
    'equityReturns.total.totalProfitShare === JV + Dev (Table 3 invariant)');
  close(t.profitShareBalance, jv.profitShareBalance + dev.profitShareBalance, 1,
    'profitShareBalance Total === JV + Dev');
  close(t.totalEquityRepatriation, jv.totalEquityRepatriation + dev.totalEquityRepatriation, 1,
    'totalEquityRepatriation Total === JV + Dev');
}

// ── 2. Profitable project still has feasibilityProfit ≈ waterfall sum ──
{
  const result = runCalculations(baseAdmin, profitableInputs());
  const cf = result.cashflows;
  const waterfallProfit = cf.reduce((s, c) => s + c.profitDistribution, 0);
  const feasProfit = result.feasibility.totalProfit;
  // On a fully-distributable profitable project the two must be ≈ equal.
  // Allow $1K tolerance for solver rounding.
  close(waterfallProfit, feasProfit, 1000,
    'profitable project: Σ profitDistribution ≈ feasibilityProfit (no regression of happy path)');
  // Sanity: it's actually positive
  assert(feasProfit > 0, 'profitable scenario actually produces positive feasibilityProfit');
}

// ── 3. Reconciliation identity holds: feasibility = waterfall − unreturnedEquity − unpaidDebt ──
{
  const result = runCalculations(baseAdmin, profitableInputs());
  const cf = result.cashflows;
  const waterfall = cf.reduce((s, c) => s + c.profitDistribution, 0);
  const equityIn = cf.reduce((s, c) => s + c.equityInjection, 0);
  const equityOut = cf.reduce((s, c) => s + c.equityRepatriation, 0);
  const unrepatriated = Math.max(0, equityIn - equityOut);
  const last = cf[cf.length - 1];
  const unpaidDebt = last
    ? (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0) + (last.landLoanBalance ?? 0)
    : 0;
  const reconciled = waterfall - unrepatriated - unpaidDebt;
  close(reconciled, result.feasibility.totalProfit, 1000,
    'reconciliation identity: feasibility ≈ waterfall − unrepatriated equity − unpaid debt');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`PROFIT-RECONCILIATION TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
