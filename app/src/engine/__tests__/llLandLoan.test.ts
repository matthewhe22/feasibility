/**
 * Regression test — LL1 + LL2 land loan mechanics.
 *
 *   LL1: when isCapitalised=true, land loan interest cash = 0 in every holding
 *        period; balance grows by accrued interest. When false (default),
 *        interest is paid in cash each accrual cycle; balance constant.
 *   LL2: senior takes out land loan at construction start — land balance
 *        after sweep = 0; senior balance increased by takeout; covenant cap
 *        respected (or warning emitted).
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
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(landLoanCapitalised: boolean): MainInputs {
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
    equityDeveloper: { name: 'D', fixedAmount: 6_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 6_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    // Land loan: $4M, months 1-5 (5-month bridge), 10% all-in. Capitalised flag varies.
    landLoan: { name:'L', facilityLimit:4_000_000, startMonth:1, maturityMonth:5, interestRate:0.10, bbsy:0.04, margin:0.06, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised: landLoanCapitalised, ltcTarget:0.7, lvrTarget:0.65, drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit:10_000_000, startMonth:6, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.7, lvrTarget:0.65, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// LL1: cash-pay (default false) — interest is non-zero per period until takeout
{
  const r = runCalculations(baseAdmin, fixture(false));
  const cf = r.cashflows;
  // Holding periods: months 1 (drawdown — no interest, opening balance = 0)
  // through month 5 (takeout). Months 2-5 should have interest > 0 with cash-pay.
  // Bank balance gets debited (cash mode).
  const period2to5interest = cf.slice(1, 5).reduce((s, c) => s + c.landLoanInterest, 0);
  assert(period2to5interest > 0,
    `LL1 — cash-pay: land loan interest > 0 across holding periods (got $${period2to5interest.toFixed(2)})`);
  // Land loan balance during holding (months 2-5) should be ~ facilityLimit (no compounding)
  // Allow tiny float drift.
  const balancePeriod3 = cf[2]?.landLoanBalance ?? 0;
  assert(Math.abs(balancePeriod3 - 4_000_000) < 1,
    `LL1 — cash-pay: balance at month 3 stays at facility ($4M); got $${balancePeriod3.toFixed(2)}`);
}

// LL1: capitalised (true) — interest accrued IS recognised but compounds into balance
{
  const r = runCalculations(baseAdmin, fixture(true));
  const cf = r.cashflows;
  // With capitalised mode, llInterest[i] is still recorded for accounting, but
  // bankBalance is NOT decremented; instead llRunningBalance grows. So the
  // cashflow row's `landLoanInterest` shows the accrual (for transparency)
  // but it's offset by an equal landLoanDrawdown (synthetic). Net cash = 0.
  // Verify: balance at month 3 > facility (compounded).
  const balancePeriod3 = cf[2]?.landLoanBalance ?? 0;
  assert(balancePeriod3 > 4_000_000,
    `LL1 — capitalised: balance at month 3 > facility (compounding); got $${balancePeriod3.toFixed(2)}`);
  // The cumulative netCashflow should still balance (synthetic drawdown
  // matches the recorded interest on each capitalised period).
  const netCashSum = cf.reduce((s, c) => s + c.netCashflow, 0);
  assert(Math.abs(netCashSum) < 100,
    `LL1 — capitalised: sum(netCashflow) ≈ 0 (got $${netCashSum.toFixed(2)})`);
}

// LL2: takeout at senior start — land loan balance after sweep = 0, senior absorbed.
{
  const r = runCalculations(baseAdmin, fixture(false));
  const cf = r.cashflows;
  // Senior starts at month 6 (period index 5). Land loan repaid in this period.
  const takeoutPeriod = cf[5];
  assert(takeoutPeriod != null && (takeoutPeriod.landLoanTakeoutBySenior ?? 0) > 0,
    `LL2 — takeout transaction tagged at senior start period (got $${takeoutPeriod?.landLoanTakeoutBySenior ?? 0})`);
  // Land loan balance is 0 after takeout
  assert((takeoutPeriod?.landLoanBalance ?? 0) < 1,
    `LL2 — land loan balance = 0 after takeout (got $${takeoutPeriod?.landLoanBalance ?? 0})`);
  // All subsequent periods land balance is 0
  const remainsZero = cf.slice(6).every(c => (c.landLoanBalance ?? 0) < 1);
  assert(remainsZero, `LL2 — land loan balance stays 0 from takeout onwards`);
  // Senior drawdown at takeout period > 0 (absorbed the land loan balance)
  assert((takeoutPeriod?.seniorDrawdown ?? 0) >= 4_000_000 - 100,
    `LL2 — senior drawdown at takeout absorbs land loan principal (got $${takeoutPeriod?.seniorDrawdown ?? 0})`);
}

// LL2 capitalised: takeout amount equals principal + accrued interest (larger)
{
  const rA = runCalculations(baseAdmin, fixture(false));
  const rB = runCalculations(baseAdmin, fixture(true));
  const takeoutA = rA.cashflows[5]?.landLoanTakeoutBySenior ?? 0;
  const takeoutB = rB.cashflows[5]?.landLoanTakeoutBySenior ?? 0;
  // Capitalised takeout > cash-pay takeout (because interest compounded into balance)
  assert(takeoutB > takeoutA,
    `LL2 — capitalised takeout ($${takeoutB.toFixed(0)}) > cash-pay takeout ($${takeoutA.toFixed(0)})`);
  // Both takeouts should be ≥ principal $4M
  assert(takeoutA >= 4_000_000 - 100,
    `LL2 — cash-pay takeout ≥ principal (got $${takeoutA.toFixed(0)})`);
  assert(takeoutB >= 4_000_000,
    `LL2 — capitalised takeout ≥ principal (got $${takeoutB.toFixed(0)})`);
}

// LL2 covenant respected (no warning on this fixture; senior facility large enough)
{
  const r = runCalculations(baseAdmin, fixture(false));
  const warns = (r.warnings ?? []).join(' | ');
  assert(!/breach LTC/i.test(warns),
    `LL2 — no covenant breach warning on healthy fixture; warnings: ${warns.slice(0, 200)}`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`LL LAND LOAN TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
