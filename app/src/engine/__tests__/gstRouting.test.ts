/**
 * Regression tests for Melbourne UAT GST findings G1–G3.
 *
 *   G1 — Table 1 (per-item) vs Table 13 (margin-scheme aggregate) net GST
 *        must reconcile to within rounding.
 *   G2 — Land cost apportioned to margin-scheme supplies (Division 75 /
 *        GSTR 2006/1). Must work whether or not other items are
 *        gstIncluded:false.
 *   G3 — Items with revenueType "Commercial Office" / "Retail F&B" /
 *        "Hotel" / "Management Rights" must route to standard-rated, not
 *        margin-scheme, even when gstIncluded is true.
 *
 * Run: cd app && npx tsx src/engine/__tests__/gstRouting.test.ts
 */
import { runCalculations } from '../index';
import { resolveSupplyType } from '../revenue';
import type { AdminConfig, MainInputs, RevenueLineItem } from '../../types';

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

// ── G3: resolveSupplyType routes by revenueType ─────────────────────────────
const grv = (revenueType: string, gstIncluded = true): RevenueLineItem => ({
  code: 'G', description: '', revenueType: revenueType as RevenueLineItem['revenueType'],
  units: 1, totalArea: 100, currentSalePrice: 1_000_000,
  gstIncluded,
  preSaleExchangeMonth: 1, preSaleSpan: 1, settlementMonth: 12, settlementSpan: 1,
} as unknown as RevenueLineItem);

assert(resolveSupplyType(grv('Residential')) === 'margin-scheme',
  'Residential gstIncluded → margin-scheme');
assert(resolveSupplyType(grv('Retail F&B')) === 'standard',
  'Retail F&B → standard-rated (G3 fix)');
assert(resolveSupplyType(grv('Commercial Office')) === 'standard',
  'Commercial Office → standard-rated (G3 fix)');
assert(resolveSupplyType(grv('Hotel')) === 'standard',
  'Hotel → standard-rated (G3 fix)');
assert(resolveSupplyType(grv('Management Rights')) === 'standard',
  'Management Rights → standard-rated (G3 fix)');
assert(resolveSupplyType(grv('Residential', false)) === 'input-taxed',
  'Residential gstIncluded:false → input-taxed (rental)');

// ── G1 + G2: Melbourne mixed-use scenario ───────────────────────────────────
const baseAdmin: AdminConfig = {
  projectName: 'GST Test',
  modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 10, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function makeInputs(): MainInputs {
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 91, projectGFA: 12000, siteArea: 2500,
      projectStartMonth: 1, projectSpanMonths: 30, projectEndMonth: 30,
      equityDistStartMonth: 30, equityDistSpanMonths: 1,
    },
    landPurchase: {
      landPurchasePrice: 25_000_000,
      prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.10, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'VIC', stampDutyAmount: 1_575_000,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [
        { id: 's1', description: 'Deposit', percentOfLand: 0.10, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 },
        { id: 's2', description: 'Settlement', percentOfLand: 0.90, amount: 0, lumpSum: 0, monthStart: 4, monthSpan: 1 },
      ],
      acquisitionCosts: [{ id: 'a1', description: 'Stamp', amount: 1_575_000, monthStart: 4, monthSpan: 1, percentOfLand: 0, lumpSum: 0, addGST: false }],
    },
    developmentCosts: [], constructionCosts: [{
      code: 'C1', description: 'Build', costType: 'Total Construction Costs',
      units: 1, baseRate: 42_000_000, totalCosts: 42_000_000,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 21,
      addGST: true, ctd: 0, ctc: 42_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 30,
      addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [
      { code: 'S1', description: 'Apartments', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.10, sCurve: 'Evenly Split', addGST: false },
      { code: 'S2', description: 'Retail',     salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.10, sCurve: 'Evenly Split', addGST: false },
    ],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [
      { code: 'G1', description: 'Apartments', revenueType: 'Residential',
        units: 90, totalArea: 10_500, currentSalePrice: 99_750_000,
        gstIncluded: true, preSaleExchangeMonth: 6, preSaleSpan: 18,
        settlementMonth: 25, settlementSpan: 6 } as unknown as RevenueLineItem,
      { code: 'G2', description: 'Retail', revenueType: 'Retail F&B',
        units: 1, totalArea: 1_500, currentSalePrice: 11_250_000,
        gstIncluded: true, preSaleExchangeMonth: 18, preSaleSpan: 6,
        settlementMonth: 25, settlementSpan: 1 } as unknown as RevenueLineItem,
    ],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Dev', equityCap: 25_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 25_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 20_000_000, startMonth: 4, maturityMonth: 7, interestRate: 0.11, bbsy: 0, margin: 0.11, establishmentFeePercent: 0.015, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1, lenderIsGSTExempt: true },
    mezzanine: { name: 'M', facilityLimit: 5_000_000, startMonth: 4, maturityMonth: 30, interestRate: 0.14, bbsy: 0, margin: 0.14, establishmentFeePercent: 0.02, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.85, lvrTarget: 0.65, drawdownPriority: 3, lenderIsGSTExempt: true },
    seniorFacility: { name: 'S', facilityLimit: 75_000_000, startMonth: 4, maturityMonth: 30, interestRate: 0.0950, bbsy: 0.0410, margin: 0.0540, establishmentFeePercent: 0.015, lineFeePercent: 0.005, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.75, lvrTarget: 0.65, drawdownPriority: 4, lenderIsGSTExempt: true },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 4, maturityMonth: 30, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 5, lenderIsGSTExempt: true },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 30, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0, lvrTarget: 0, drawdownPriority: 1, lenderIsGSTExempt: true },
    otherFinancingCosts: [],
  };
}

const result = runCalculations(baseAdmin, makeInputs());

// G3 effect: retail ($11.25M) is now standard-rated, not margin-scheme.
//  - marginSchemeSupplies = $99.75M (apartments only)
//  - standardRatedSupplies = $11.25M
const gst = result.gstCompliance!;
close(gst.marginSchemeSupplies, 99_750_000, 1,
  'G3: marginSchemeSupplies = apartments only ($99.75M), retail routed to standard');
close(gst.standardRatedSupplies, 11_250_000, 1,
  'G3: standardRatedSupplies = retail ($11.25M)');

// G2 effect: land apportioned to margin-scheme supplies = $25M × $99.75M/$111M ≈ $22.46M
const expectedLandApportionment = 25_000_000 * 99_750_000 / 111_000_000;
close(gst.marginSchemeLandCost, expectedLandApportionment, 1,
  'G2: marginSchemeLandCost = land × marginSchemeGRV / totalGRV (Div 75)');

// Taxable margin = $99.75M - $22.46M = $77.29M
const expectedTaxableMargin = 99_750_000 - expectedLandApportionment;
close(gst.taxableMargin, expectedTaxableMargin, 1,
  'G2: taxableMargin = marginSchemeSupplies − apportioned land');

// GST on margin = $77.29M × 1/11 ≈ $7.03M
const expectedGstOnMargin = expectedTaxableMargin / 11;
close(gst.gstOnMarginSchemeSupplies, expectedGstOnMargin, 1,
  'G2: gstOnMarginSchemeSupplies = taxableMargin / 11');

// GST on standard = $11.25M × 1/11 ≈ $1.02M
const expectedGstOnStandard = 11_250_000 / 11;
close(gst.gstOnStandardSupplies, expectedGstOnStandard, 1,
  'G3: gstOnStandardSupplies = standardRatedSupplies / 11');

// G1: Table 1 (feasibility.gstOnRevenue) and Table 13
//     (gstOnMarginSchemeSupplies + gstOnStandardSupplies) must reconcile.
//     Box Hill UAT bug 6 fix: feasibility.gstOnRevenue now includes BOTH
//     settlement-period AND deposit-period GST (per GSTA s.9-70 attribution),
//     so the two totals agree to within rounding rather than differing by the
//     deposit-period GST as before. applyGSTWithholding is off in this fixture
//     so gstWithholdingTotal = 0 and the supply totals are like-for-like.
const table1Gross = result.feasibility.gstOnRevenue;
const table13Gross = gst.gstOnMarginSchemeSupplies + gst.gstOnStandardSupplies;
close(table1Gross, table13Gross, 1,
  'G1: Table 1 (cashflow GST on revenue) reconciles with Table 13 supply totals');

console.log(`\n${'═'.repeat(72)}`);
console.log(`GST-ROUTING TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
