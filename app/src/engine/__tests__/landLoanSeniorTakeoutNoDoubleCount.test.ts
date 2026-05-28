/**
 * Regression test — senior takeout of the land loan must NOT be double-counted.
 *
 * Bug (pre-fix): two code paths in funding.ts both applied the land-loan
 * takeout in the senior-start period:
 *   - step 4 (LL2 balance-sheet swap): the canonical takeout.
 *   - step 7 (legacy PR #31 refi block): re-applied `llRepayments[i]`, adding a
 *     SECOND senior drawdown of the same amount AND a phantom `bankBalance`
 *     credit with no offsetting source.
 * Effect: senior drawdown / running balance inflated by the full takeout, and
 * the phantom cash leaked into the waterfall — overstating senior interest,
 * reported facility size, and ultimately distributions/profit.
 *
 * The legacy step-7 block has been removed (step 4 is the sole takeout path).
 * This test pins the exact, single-count behaviour so the bug can't return.
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'LL', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []], buildSCurves: {},
  contingencyGSTMode: 'none',
};

// $4M land loan (months 1-5), senior takes it out at construction start (month 6
// = period index 5). Equity ($6M) covers land + early construction, so the only
// senior drawdown at the takeout period IS the takeout itself — making the
// expected value exact.
function fixture(): MainInputs {
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24,
      equityDistStartMonth: 22, equityDistSpanMonths: 3 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [] },
    developmentCosts: [],
    constructionCosts: [{ code: 'C', description: 'B', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 6, monthSpan: 16, addGST: true, ctd: 0, ctc: 10_000_000 }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: 18_000_000, gstIncluded: true,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: 6_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 6_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 4_000_000, startMonth: 1, maturityMonth: 5, interestRate: 0.10, bbsy: 0.04, margin: 0.06, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: false, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility: { name: 'S', facilityLimit: 10_000_000, startMonth: 6, maturityMonth: 24, interestRate: 0, bbsy: 0.04, margin: 0.04, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility2: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.85, lvrTarget: 0.80, drawdownPriority: 3 },
    residualStockFacility: { name: '', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

{
  const r = runCalculations(baseAdmin, fixture());
  const cf = r.cashflows;
  const takeoutIdx = 5; // senior start month 6 → period index 5
  const takeout = cf[takeoutIdx]?.landLoanTakeoutBySenior ?? 0;
  const snrDraw = cf[takeoutIdx]?.seniorDrawdown ?? 0;

  // The takeout is recorded once.
  assert(Math.abs(takeout - 4_000_000) < 1,
    `takeout amount = $4M (got $${takeout.toFixed(2)})`);

  // CRITICAL: senior drawdown at the takeout period equals the takeout EXACTLY
  // (equity funds early construction, so no other senior draw this period).
  // Pre-fix this was ~$8M (4M takeout double-applied). Tolerance is tight on
  // purpose — a 2× regression must fail here.
  assert(Math.abs(snrDraw - takeout) < 1,
    `senior drawdown at takeout = takeout amount, NOT 2× (got draw=$${snrDraw.toFixed(2)} vs takeout=$${takeout.toFixed(2)})`);

  // No phantom cash: the removed block credited bankBalance by the takeout with
  // no source, leaking ~$4M into the waterfall. Net cashflow must conserve.
  const netSum = cf.reduce((s, c) => s + c.netCashflow, 0);
  assert(Math.abs(netSum) < 100,
    `Σ(netCashflow) ≈ 0 — no phantom takeout cash (got $${netSum.toFixed(2)})`);

  // Peak senior balance must not carry the doubled takeout.
  const peakSnr = Math.max(...cf.map(c => c.seniorBalance ?? 0));
  assert(peakSnr < 12_000_000,
    `peak senior balance is not inflated by a doubled takeout (got $${peakSnr.toFixed(2)})`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`LAND-LOAN TAKEOUT DOUBLE-COUNT TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
