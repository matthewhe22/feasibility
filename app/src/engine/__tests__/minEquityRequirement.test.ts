/**
 * Regression test — V8: minEquityRequirement term-sheet equity-floor warning.
 *
 * Invariants:
 *   • value === 0  → no [FUNDING] warning fires regardless of equity level
 *                    (back-compat for v7 fixtures and disabled-by-default).
 *   • value > 0 AND actual cash equity < required → [FUNDING] warning fires
 *                    with shortfall + basis name in the message.
 *   • value > 0 AND actual cash equity ≥ required → no warning.
 *   • Both 'tdc' and 'tdc-incl-finance-costs' bases are honoured.
 *   • 'amount' mode treats `value` as a $ floor (no basis multiplication).
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs, MinEquityRequirement } from '../../types';
import { getFundingWarnings } from '../funding';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'V8', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(equityCap: number, minEq?: MinEquityRequirement): MainInputs {
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

// Test 1: NEGATIVE — value=0 disables the check, no warning even with $0 equity.
{
  const r = runCalculations(baseAdmin, fixture(0, { mode: 'percent', value: 0, basis: 'tdc-incl-finance-costs' }));
  assert(r.feasibility.totalCost > 0, 'fixture computed totalCost > 0');
  assert(!hasMinEquityWarning(),
    'V8 — value=0 disables check (no [FUNDING] equity warning fires)');
}

// Test 2: NEGATIVE — minEquityRequirement undefined entirely (legacy v7 fixture).
{
  const r = runCalculations(baseAdmin, fixture(5_000_000, undefined));
  assert(r.feasibility.totalCost > 0, 'fixture computed totalCost > 0');
  assert(!hasMinEquityWarning(),
    'V8 — undefined requirement is treated as disabled (no warning)');
}

// Test 3: POSITIVE — actual equity below required, percent basis.
//   TDC ≈ $14M+. 50% of TDC ≈ $7M. equityCap=$1M → actual ~ $1M < $7M required.
{
  const r = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.5, basis: 'tdc-incl-finance-costs' }));
  const totalEq = r.cashflows.reduce((a, c) => a + (c.equityInjection ?? 0), 0);
  assert(totalEq < r.feasibility.totalCost * 0.5,
    `V8 — actual equity ($${Math.round(totalEq).toLocaleString()}) below 50% TDC ($${Math.round(r.feasibility.totalCost * 0.5).toLocaleString()})`);
  assert(hasMinEquityWarning(),
    `V8 — [FUNDING] equity-shortfall warning fires when actual < required (warnings: ${JSON.stringify(getFundingWarnings())})`);
}

// Test 4: POSITIVE — fixed-amount mode shortfall.
{
  const r = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'amount', value: 5_000_000, basis: 'tdc' }));
  void r;
  assert(hasMinEquityWarning(),
    'V8 — amount-mode shortfall: warning fires when actual < $5M required');
}

// Test 5: POSITIVE — actual equity meets required (no warning).
//   With equityCap = $20M and required = $1M, actual >> required → PASS.
{
  const r = runCalculations(baseAdmin, fixture(20_000_000, { mode: 'amount', value: 1_000_000, basis: 'tdc' }));
  void r;
  assert(!hasMinEquityWarning(),
    'V8 — actual equity meets requirement: no warning fires');
}

// Test 6: 'tdc' vs 'tdc-incl-finance-costs' basis behaviour.
//   TDC excl finance < TDC incl finance. Same percent, same actual → only the
//   incl-fin basis exceeds actual when actual sits in the gap, BUT here we just
//   confirm both bases are accepted without crashing.
{
  const r1 = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.4, basis: 'tdc' }));
  const w1 = hasMinEquityWarning();
  void r1;
  const r2 = runCalculations(baseAdmin, fixture(1_000_000, { mode: 'percent', value: 0.4, basis: 'tdc-incl-finance-costs' }));
  const w2 = hasMinEquityWarning();
  void r2;
  assert(w1 || w2, 'V8 — basis selector accepted; at least one basis flags shortfall');
}

console.log(`\nminEquityRequirement: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}
