/**
 * Regression tests — engine reconciliation invariants (PR-B).
 *
 *   R1 — sum(monthly netCashflow) ≈ 0 across the project life.
 *        Pre-fix variance equalled sum(gstOnDeposits) because deposit GST was
 *        deducted in netCashflow without a matching deposit-cash inflow path.
 *
 *   R2 — feasibilityProfit ≈ Σ profitDistribution + unrepatriatedEquity + unpaidDebt.
 *        Equivalently, the Returns-tab reconciliation identity holds without
 *        a residual. Pre-fix variance equalled the withholding amount because
 *        gstWithholding was being deducted from cash twice (once via reduced
 *        receipts in monthlyRevenue, once via cf.gstWithholding in netCashflow).
 *
 * Run: cd app && npx tsx src/engine/__tests__/engineRecon.test.ts
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
  projectName: 'Engine recon',
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

function fixture(opts: { withholding?: boolean; sale?: number; equity?: number }): MainInputs {
  const sale = opts.sale ?? 20_000_000;
  const equity = opts.equity ?? 12_000_000;
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: {
      landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [],
    },
    developmentCosts: [],
    constructionCosts: [{
      code: 'C', description: 'B', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18,
      addGST: true, ctd: 0, ctc: 10_000_000,
    }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24,
      addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{
      code: 'G', description: 'A', revenueType: 'Residential',
      units: 1, totalArea: 100, currentSalePrice: sale, gstIncluded: true,
      preSaleExchangeMonth: 6, preSaleSpan: 1, settlementMonth: 24, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', fixedAmount: equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: { name: 'S', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

function runWith(withholding: boolean, opts: { sale?: number; equity?: number } = {}): ReturnType<typeof runCalculations> {
  return runCalculations({ ...baseAdmin, applyGSTWithholding: withholding }, fixture({ ...opts, withholding }));
}

// ── R1: sum(monthly netCashflow) ≈ 0 with and without withholding ──────────
{
  // With withholding (margin-scheme residential): pre-fix variance = sum(gstOnDeposits)
  const withW = runWith(true);
  const sumW = withW.cashflows.reduce((s, c) => s + c.netCashflow, 0);
  close(sumW, 0, 1, 'R1 — sum(monthly netCashflow) ≈ 0 (withholding ON)');

  // Without withholding (e.g. commercial): same invariant
  const noW = runWith(false);
  const sumN = noW.cashflows.reduce((s, c) => s + c.netCashflow, 0);
  close(sumN, 0, 1, 'R1 — sum(monthly netCashflow) ≈ 0 (withholding OFF)');

  // Loss-making project — invariant still holds
  const loss = runWith(true, { sale: 8_000_000, equity: 10_000_000 });
  const sumL = loss.cashflows.reduce((s, c) => s + c.netCashflow, 0);
  // Loss-making leaves unrepatriated equity in the bank (cumulative residual).
  // The invariant is: |sum(netCashflow)| should not exceed the unrepatriated equity.
  const eqIn = loss.cashflows.reduce((s, c) => s + c.equityInjection, 0);
  const eqOut = loss.cashflows.reduce((s, c) => s + c.equityRepatriation, 0);
  const unrep = Math.max(0, eqIn - eqOut);
  assert(Math.abs(sumL) <= unrep + 1,
    `R1 — sum(netCashflow) on loss bounded by unrepatriated equity; got ${sumL.toFixed(2)} vs unrep ${unrep.toFixed(2)}`);
}

// ── R2: feasibilityProfit ≈ waterfallProfit − unrepatriatedEquity − unpaidDebt ──
{
  const r = runWith(true);
  const cf = r.cashflows;
  const waterfall = cf.reduce((s, c) => s + c.profitDistribution, 0);
  const eqIn = cf.reduce((s, c) => s + c.equityInjection, 0);
  const eqOut = cf.reduce((s, c) => s + c.equityRepatriation, 0);
  const unrep = Math.max(0, eqIn - eqOut);
  const last = cf[cf.length - 1];
  const debt = last
    ? (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0) + (last.landLoanBalance ?? 0)
    : 0;
  const reconciled = waterfall - unrep - debt;
  close(reconciled, r.feasibility.totalProfit, 1,
    'R2 — Σ profitDist − unrep equity − unpaid debt ≈ feasibility totalProfit (margin-scheme)');

  // Same on a profitable project without withholding
  const noW = runWith(false);
  const cf2 = noW.cashflows;
  const w2 = cf2.reduce((s, c) => s + c.profitDistribution, 0);
  const i2 = cf2.reduce((s, c) => s + c.equityInjection, 0);
  const o2 = cf2.reduce((s, c) => s + c.equityRepatriation, 0);
  const u2 = Math.max(0, i2 - o2);
  const last2 = cf2[cf2.length - 1];
  const d2 = last2
    ? (last2.seniorBalance ?? 0) + (last2.senior2Balance ?? 0) + (last2.mezzBalance ?? 0) + (last2.landLoanBalance ?? 0)
    : 0;
  close(w2 - u2 - d2, noW.feasibility.totalProfit, 1,
    'R2 — Σ profitDist − unrep − unpaid debt ≈ totalProfit (withholding OFF)');
}

// ── Sanity: gstOnRevenue still represents the full liability (settle + deposits) ──
{
  const r = runWith(true);
  const sumCfGST = r.cashflows.reduce((s, c) => s + c.gstOnRevenue, 0);
  close(sumCfGST, r.feasibility.gstOnRevenue, 1,
    'sanity — sum(cashflow.gstOnRevenue) === feasibility.gstOnRevenue (Bug 6 unchanged)');
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`ENGINE-RECON TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
