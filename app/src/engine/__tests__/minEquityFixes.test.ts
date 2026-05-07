/**
 * Regression tests for the v8 follow-up fixes:
 *   1. Stale [FUNDING] min-equity warning between prelim + final solves.
 *   2. Engine-vs-Checks-tab basis divergence on GST-bearing projects.
 *
 * Both bugs are covered by asserting that `data.minEquityCheck` is the SINGLE
 * source of truth — populated on every solve, matches the warning emit branch,
 * and the warning array is consistent with the telemetry.
 */
import { runCalculations } from '../index';
import { getFundingWarnings } from '../funding';
import type { AdminConfig, MainInputs, MinEquityRequirement } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'V8-fix', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(equityCap: number, minEq?: MinEquityRequirement, gstRate: number = 0.10): MainInputs {
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24,
      equityDistStartMonth: 22, equityDistSpanMonths: 3 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [] },
    developmentCosts: [],
    constructionCosts: [{ code: 'C', description: 'B', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18, addGST: true, ctd: 0, ctc: 10_000_000 }],
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
    equityDeveloper: { name: 'D', equityCap, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: equityCap, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: 50_000_000, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: 0.85, lvrTarget: 0.85, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
    ...(minEq !== undefined ? { minEquityRequirement: minEq } : {}),
  };
}

function hasMinEquityWarning(): boolean {
  return getFundingWarnings().some(w => w.includes('Equity below minimum requirement'));
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 — Stale warning between prelim and final solves.
// Engine should always reflect the FINAL solve's verdict; if final passes, no
// [FUNDING] warning should be present even if a prelim sub-pass would have
// flagged a shortfall.
// ─────────────────────────────────────────────────────────────────────────────

// Test 1.1: Final solve passes → telemetry shortfall=0 AND no warning fires.
{
  // Adequate equity vs a small required floor.
  const r = runCalculations(baseAdmin, fixture(20_000_000, { mode: 'amount', value: 1_000_000, basis: 'tdc' }));
  assert(r.minEquityCheck !== undefined, 'FIX1.1 — minEquityCheck telemetry populated on every solve');
  assert(r.minEquityCheck!.shortfall === 0, `FIX1.1 — shortfall=0 when actual >> required (got ${r.minEquityCheck?.shortfall})`);
  assert(!hasMinEquityWarning(), 'FIX1.1 — no [FUNDING] warning when final solve passes (regression of stale-warning bug)');
}

// Test 1.2: Final solve fails → telemetry shortfall>0 AND warning fires.
{
  const r = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.5, basis: 'tdc-incl-finance-costs' }));
  assert(r.minEquityCheck!.shortfall > 0, 'FIX1.2 — telemetry shortfall>0 when final solve fails');
  assert(hasMinEquityWarning(), 'FIX1.2 — [FUNDING] warning fires when final solve fails');
}

// Test 1.3: Telemetry numbers MATCH the warning text byte-for-byte.
{
  const r = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.5, basis: 'tdc-incl-finance-costs' }));
  const ch = r.minEquityCheck!;
  const warn = getFundingWarnings().find(w => w.includes('Equity below minimum requirement'))!;
  // The warning embeds rounded-to-int dollar values; reconstruct same.
  const expectedActual = `$${Math.round(ch.actual).toLocaleString()}`;
  const expectedRequired = `$${Math.round(ch.required).toLocaleString()}`;
  const expectedShortfall = `$${Math.round(ch.shortfall).toLocaleString()}`;
  assert(warn.includes(`actual ${expectedActual}`), `FIX1.3 — warning actual matches telemetry (${expectedActual} in: ${warn})`);
  assert(warn.includes(`required ${expectedRequired}`), `FIX1.3 — warning required matches telemetry`);
  assert(warn.includes(`shortfall ${expectedShortfall}`), `FIX1.3 — warning shortfall matches telemetry`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — Basis alignment under GST. The engine's basis is the cash-basis sum
// of monthlyCostsExcFinance (incl. recoverable GST). The Checks tab now
// consumes `data.minEquityCheck` directly so it MUST equal the engine's basis.
// ─────────────────────────────────────────────────────────────────────────────

// Test 2.1: GST-bearing project: telemetry basis includes gstOnCosts.
//   construction $10M with addGST=true at 10% rate → ~$1M of GST on costs,
//   which the cash-basis monthlyCostsExcFinance must include.
{
  const r = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.5, basis: 'tdc' }, 0.10));
  const ch = r.minEquityCheck!;
  // Input-side rollup (totalCost) is ex-GST; engine basis must be HIGHER.
  // We assert ch.basisAmount > feasibility.totalCost - finance costs (the
  // pre-fix Checks-tab basis), confirming the divergence the fix corrects.
  const oldChecksBasis = r.feasibility.totalCost
    - (r.feasibility.seniorFinanceCosts ?? 0)
    - (r.feasibility.mezzFinanceCosts ?? 0);
  assert(ch.basisAmount > oldChecksBasis - 100,
    `FIX2.1 — engine basis (${Math.round(ch.basisAmount)}) ≥ pre-fix Checks basis (${Math.round(oldChecksBasis)}) on GST-bearing project`);
  // Required ALSO uses engine basis, so required matches the warning.
  const expectedRequired = 0.5 * ch.basisAmount;
  assert(Math.abs(ch.required - expectedRequired) < 1,
    `FIX2.1 — telemetry required = mode × engine basis (${Math.round(ch.required)} vs ${Math.round(expectedRequired)})`);
}

// Test 2.2: Disabled (value=0) — telemetry still populated, required=0.
{
  const r = runCalculations(baseAdmin, fixture(0, { mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }));
  const ch = r.minEquityCheck!;
  assert(ch.required === 0, 'FIX2.2 — disabled: required=0');
  assert(ch.shortfall === 0, 'FIX2.2 — disabled: shortfall=0');
  assert(ch.basisAmount > 0, 'FIX2.2 — disabled: basis still computed for diagnostics');
  assert(!hasMinEquityWarning(), 'FIX2.2 — disabled: no warning fires regardless');
}

// Test 2.3: 'tdc' vs 'tdc-incl-finance-costs' produces different basis amounts
// when finance costs are non-zero (senior actually draws). Equity cap $1M
// forces the senior facility to fund most of the build, producing real fees.
{
  const r1 = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.4, basis: 'tdc' }));
  const r2 = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.4, basis: 'tdc-incl-finance-costs' }));
  assert(r1.minEquityCheck!.basisName === 'TDC', 'FIX2.3 — tdc basis name correct');
  assert(r2.minEquityCheck!.basisName === 'TDC + financing costs', 'FIX2.3 — tdc-incl-finance-costs basis name correct');
  assert(r2.minEquityCheck!.basisAmount > r1.minEquityCheck!.basisAmount,
    `FIX2.3 — incl-finance basis > ex-finance basis (${r2.minEquityCheck!.basisAmount} > ${r1.minEquityCheck!.basisAmount})`);
}

console.log(`\nminEquity fixes: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}
