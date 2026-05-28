/**
 * Regression tests for span/tail-drop "wedge" fixes — cases where an amount
 * counted in feasibility totals (summed from inputs) was only partially placed
 * into the per-period cashflow because a spreader divided by a nominal span
 * wider than the slots it actually wrote, or the timeline horizon was too short
 * to hold a configured stream.
 *
 *   M3 — spreadLandPayments tail-clip
 *   M2 — generateTimeline includes rental/other income + acquisition/financing
 *   H2 — PRSV uplift honours prsvSpan (and the horizon already reserves it)
 *   M1 — front-end commission fully spread within the timeline
 */
import { spreadLandPayments } from '../costSpreading';
import { generateTimeline } from '../timeline';
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs, Period } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}
function close(a: number, b: number, tol: number): boolean { return Math.abs(a - b) <= tol; }

// Build a trivial period array of length n (only `.length` and indexing matter
// to spreadLandPayments).
function periodsOfLength(n: number): Period[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i, periodNumber: i + 1,
    startDate: new Date(0), endDate: new Date(0), daysInPeriod: 30,
    isActual: false, isForecast: true, label: `M${i + 1}`,
  }));
}

// ── M3: a stage starting late with span past the end spreads its FULL amount ──
{
  const periods = periodsOfLength(12);
  // Stage starts month 10 (idx 9), span 6 → only 3 slots (10,11,12) remain.
  const out = spreadLandPayments([{ amount: 3_000_000, monthStart: 10, monthSpan: 6 }], periods);
  const total = out.reduce((s, v) => s + v, 0);
  assert(close(total, 3_000_000, 1e-6),
    `M3 — full land payment spread despite span past timeline (got $${total.toFixed(2)})`);
  // It should be divided across the 3 in-window slots, not the nominal 6.
  assert(close(out[9]!, 1_000_000, 1e-6) && close(out[11]!, 1_000_000, 1e-6),
    `M3 — perMonth divided by effective (3) not nominal span (6); got ${out[9]}`);
}

// ── M3 edge: a stage starting entirely past the timeline drops cleanly ────────
{
  const periods = periodsOfLength(5);
  const out = spreadLandPayments([{ amount: 1_000_000, monthStart: 10, monthSpan: 3 }], periods);
  assert(out.reduce((s, v) => s + v, 0) === 0,
    'M3 — stage beyond timeline contributes nothing (no NaN/negative index)');
}

// ── M2 / H2: timeline horizon covers rental income + PRSV span ────────────────
{
  const admin = { lastActualsPeriod: 44927, modelStartDate: 44927 } as unknown as AdminConfig;
  // projectSpanMonths short (6), but rental income runs months 20-31 and a PRSV
  // uplift spans months 3-5. Horizon must stretch to the latest configured event.
  const inputs = {
    preliminary: { projectSpanMonths: 6, dateOfFirstPeriod: 45017 },
    landPurchase: { prsvMonth: 3, prsvSpan: 3, paymentStages: [], acquisitionCosts: [] },
    grvItems: [],
    rentalIncome: [{ monthStart: 20, monthSpan: 12 }],
    otherIncome: [],
    constructionCosts: [], developmentCosts: [], marketingCosts: [],
    otherStandardCosts: [], pmFees: [], otherFinancingCosts: [],
  } as unknown as MainInputs;
  const periods = generateTimeline(admin, inputs);
  assert(periods.length >= 31,
    `M2 — horizon extends to cover rental income ending month 31 (got ${periods.length})`);
}

// ── M1: front-end commission fully spread even when presale window > timeline ──
// One GRV item, $100M sale, 4% commission, 50% front-end ⇒ $2.0M front-end.
// Presale exchange month 8 with a 10-month span (→ window ends month 17) while
// projectSpanMonths is 12 and settlement is month 11; pre-fix the commission
// tail past month 12 was dropped from the cashflow.
{
  const admin: AdminConfig = {
    projectName: 'M1', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
    tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
    sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []], buildSCurves: {},
    contingencyGSTMode: 'none',
  };
  const inputs = {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly', projectLots: 1,
      projectGFA: 1000, siteArea: 500, projectStartMonth: 1, projectSpanMonths: 12,
      projectEndMonth: 12, equityDistStartMonth: 11, equityDistSpanMonths: 1 },
    landPurchase: { landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0, gstRate: 0.1,
      gstApplicableLand: false, addGSTOnLandPrice: false, stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [] },
    developmentCosts: [], constructionCosts: [], constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0, sCurve: 'Evenly Split',
      monthStart: 1, monthSpan: 12, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0.04, preCommissionPercent: 0.5,
      depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: 100_000_000, gstIncluded: true,
      preSaleExchangeMonth: 8, preSaleSpan: 10, settlementMonth: 11, settlementSpan: 1 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: 5_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 5_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'',facilityLimit:0,startMonth:1,maturityMonth:12,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:false,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S',facilityLimit:200_000_000,startMonth:1,maturityMonth:12,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.99,lvrTarget:0.99,drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:12,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:12,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:12,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  } as unknown as MainInputs;

  const r = runCalculations(admin, inputs);
  const expectedFrontEnd = 100_000_000 * 0.04 * 0.5; // $2.0M
  const spreadFrontEnd = r.cashflows.reduce((s, c) => s + (c.sellingCostsFrontEnd ?? 0), 0);
  assert(close(spreadFrontEnd, expectedFrontEnd, 1),
    `M1 — full front-end commission ($${expectedFrontEnd}) appears in cashflow despite presale window past timeline (got $${spreadFrontEnd.toFixed(2)})`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`SPAN-WEDGE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
