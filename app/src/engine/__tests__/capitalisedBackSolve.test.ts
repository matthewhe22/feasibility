/**
 * CAP-INT BACK-SOLVE — covenant cap on PEAK OUTSTANDING BALANCE for
 * capitalised facilities.
 *
 * Lenders treat `facilityLimit` as the maximum outstanding balance permitted
 * at any point in the loan term. For a capitalised facility, accruing
 * interest itself adds to the balance, so the principal that can safely be
 * drawn is strictly less than the headline facility limit. The engine
 * back-solves the principal cap using the closed-form
 *
 *     principal_cap = facilityLimit / prod_{t=start..end} (1 + r_t)
 *     r_t           = (margin + bbsy) * days[t] / daysPerYear
 *
 * so worst-case (full draw at start, full compounding to maturity, no
 * repayments) cannot push balance past the user-set facilityLimit.
 *
 * Cash-pay facilities are unchanged — interest never adds to balance.
 *
 * Run: cd app && npx tsx src/engine/__tests__/capitalisedBackSolve.test.ts
 */
import { runCalculations } from '../index';
import {
  backSolveCapitalisedPrincipalCap,
  capInterestCompoundFactor,
} from '../funding';
import type {
  AdminConfig, MainInputs, DebtFacility, Period,
} from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}
function assertClose(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) <= tol,
    `${msg} — expected ${expected.toFixed(2)} ±${tol}, got ${actual.toFixed(2)}`);
}

const baseAdmin: AdminConfig = {
  projectName: 'CapIntBackSolve', modelStartDate: 44927, monthsPerPeriod: 1,
  lastActualsPeriod: 44927, tolerance: 50,
  daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function makePeriods(n: number): Period[] {
  // 30-day uniform months — keeps the closed-form arithmetic clean for
  // formula-equality tests below.
  return Array.from({ length: n }, (_, i) => ({
    index: i, periodNumber: i + 1,
    startDate: new Date(2024, i, 1),
    endDate: new Date(2024, i + 1, 0),
    daysInPeriod: 30,
    isActual: false, isForecast: true,
    label: `M${i + 1}`,
  }));
}

function makeFacility(over: Partial<DebtFacility> = {}): DebtFacility {
  return {
    name: 'F', facilityLimit: 100_000_000, startMonth: 1, maturityMonth: 24,
    interestRate: 0, bbsy: 0.04, margin: 0.04,
    establishmentFeePercent: 0, lineFeePercent: 0,
    interestPaymentFrequency: 1, isCapitalised: true,
    ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — closed-form back-solve formula (helper-level, no engine run).
// principal_cap = facilityLimit / (1 + r×days/daysPerYear)^N, where the
// per-period rate uses the engine's daily-rate convention.
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(24);
  const annualRate = 0.08;
  const daysPerYear = 365;
  const factorExpected = (1 + annualRate * 30 / daysPerYear) ** 24;
  const factorActual = capInterestCompoundFactor(periods, daysPerYear, 0, 23, annualRate);
  assertClose(factorActual, factorExpected, 1e-9,
    'compound factor matches (1 + r×30/365)^24 for 30-day uniform periods');

  const fac = makeFacility({ bbsy: 0.04, margin: 0.04, isCapitalised: true });
  const cap = backSolveCapitalisedPrincipalCap(
    fac, 100_000_000, periods, daysPerYear, 0, 23, fac.bbsy + fac.margin);
  assertClose(cap, 100_000_000 / factorExpected, 1,
    'back-solve formula: principal_cap = facilityLimit / (1+r)^N');

  // Worst case: principal_cap × F = facilityLimit (covenant exact).
  assertClose(cap * factorExpected, 100_000_000, 1,
    'back-solved principal compounded to maturity = facilityLimit');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — cash-pay (isCapitalised=false): formula reverts; principal_cap = facilityLimit.
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(24);
  const fac = makeFacility({ isCapitalised: false });
  const cap = backSolveCapitalisedPrincipalCap(
    fac, 100_000_000, periods, 365, 0, 23, fac.bbsy + fac.margin);
  assertClose(cap, 100_000_000, 0,
    'cash-pay regression: principal_cap = facilityLimit when isCapitalised=false');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — degenerate inputs: zero rate / no term / zero limit.
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(24);
  const fac = makeFacility({ bbsy: 0, margin: 0 });
  // Zero rate ⇒ factor = 1 ⇒ cap = facilityLimit.
  const cap = backSolveCapitalisedPrincipalCap(fac, 100_000_000, periods, 365, 0, 23, 0);
  assertClose(cap, 100_000_000, 0,
    'zero annual rate: factor = 1, cap = facilityLimit');

  // facilityLimit = 0 ⇒ cap stays 0.
  const cap0 = backSolveCapitalisedPrincipalCap(fac, 0, periods, 365, 0, 23, 0.08);
  assertClose(cap0, 0, 0, 'zero facilityLimit ⇒ zero cap');
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — INVARIANT: capitalised senior peak balance ≤ facilityLimit at
// every period (not just maturity) when facilityLimit binds.
//
// Fixture: senior $50M, LTC 1.0 (covenants slack so facilityLimit binds),
// fully capitalised. Pre-fix the engine drew up to $50M of principal then
// let cap-int compound past $50M — peak ~ $50M × (1+r)^N. Post-fix,
// principal is back-solved so worst-case peak ≤ $50M.
// ═══════════════════════════════════════════════════════════════════════════
function fixtureCapitalisedSenior(facilityLimit: number, isCapitalised: boolean): MainInputs {
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
      units: 1, baseRate: 30_000_000, totalCosts: 30_000_000,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18, addGST: false, ctd: 0, ctc: 30_000_000 }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: 80_000_000, gstIncluded: false,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: 5_000_000, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 5_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised, ltcTarget: 1.0, lvrTarget: 1.0, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:1 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

{
  // Capitalised: peak ≤ facilityLimit at EVERY period (not just maturity).
  const r = runCalculations(baseAdmin, fixtureCapitalisedSenior(50_000_000, true));
  let everyPeriodOk = true;
  let worstBalance = 0;
  let worstPeriod = -1;
  for (let idx = 0; idx < r.cashflows.length; idx++) {
    const cf = r.cashflows[idx]!;
    const bal = cf.seniorBalance ?? 0;
    if (bal > worstBalance) { worstBalance = bal; worstPeriod = idx + 1; }
    if (bal > 50_000_000 + 1) { everyPeriodOk = false; }
  }
  assert(everyPeriodOk,
    `T4 (capitalised): every-period invariant — senior balance never > facilityLimit; ` +
    `worst $${worstBalance.toFixed(0)} @ period ${worstPeriod}`);
}

{
  // Cash-pay regression: principal cap = facilityLimit; peak comparable to
  // the facility limit (modulo equity/sweep, no compounding overlay).
  const r = runCalculations(baseAdmin, fixtureCapitalisedSenior(50_000_000, false));
  const peakSnr = Math.max(...r.cashflows.map(cf => cf.seniorBalance ?? 0));
  assert(peakSnr <= 50_000_000 + 1,
    `T2b (cash-pay): senior peak respects facilityLimit when not capitalised — got $${peakSnr.toFixed(0)}`);
  assert(peakSnr > 1_000_000,
    `T2b (cash-pay): senior actually drew principal (peak > $1M) — got $${peakSnr.toFixed(0)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 — per-facility back-solve formula equality (senior, senior2, mezz,
// landLoan): each capitalised facility's principal cap = facilityLimit / (1+r)^N.
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(24);
  const facs: Array<[string, DebtFacility, number]> = [
    ['senior',   makeFacility({ bbsy: 0.04, margin: 0.025, isCapitalised: true,  facilityLimit: 80_000_000 }), 0.04 + 0.025],
    ['senior2',  makeFacility({ bbsy: 0.04, margin: 0.05,  isCapitalised: true,  facilityLimit: 25_000_000 }), 0.04 + 0.05],
    ['mezz',     makeFacility({ bbsy: 0,    margin: 0.15,  isCapitalised: true,  facilityLimit: 15_000_000 }), 0.15],
    ['landLoan', makeFacility({ interestRate: 0.11, bbsy: 0, margin: 0, isCapitalised: true, facilityLimit: 30_000_000 }), 0.11],
  ];
  for (const [label, f, annualRate] of facs) {
    const expected = f.facilityLimit / (1 + annualRate * 30 / 365) ** 24;
    const actual = backSolveCapitalisedPrincipalCap(f, f.facilityLimit, periods, 365, 0, 23, annualRate);
    assertClose(actual, expected, 0.5,
      `T5 — ${label}: back-solve formula matches facilityLimit / (1+r)^N`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test 6 — toggling a senior facility from cash-pay → capitalised reduces
// the realised peak balance (back-solve takes effect) without breaking the
// underlying solve (no covenant warnings emitted).
// ═══════════════════════════════════════════════════════════════════════════
{
  const cashRun = runCalculations(baseAdmin, fixtureCapitalisedSenior(50_000_000, false));
  const capRun  = runCalculations(baseAdmin, fixtureCapitalisedSenior(50_000_000, true));
  const peakCash = Math.max(...cashRun.cashflows.map(cf => cf.seniorBalance ?? 0));
  const peakCap  = Math.max(...capRun.cashflows.map(cf => cf.seniorBalance ?? 0));
  assert(peakCash <= 50_000_000 + 1, `T6 — cash-pay peak ≤ facilityLimit (${peakCash.toFixed(0)})`);
  assert(peakCap  <= 50_000_000 + 1, `T6 — capitalised peak ≤ facilityLimit (${peakCap.toFixed(0)})`);
}

console.log();
console.log('═'.repeat(72));
console.log(`CAPITALISED BACK-SOLVE: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
