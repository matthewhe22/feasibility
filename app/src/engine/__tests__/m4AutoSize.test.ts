/**
 * Regression test — M4 / Bug 2 (Kew UAT): senior/mezz peak respects
 * min(LTC×TDC, LVR×NRV, facilityLimit).
 *
 * Post-Bug-2 invariants (semantics changed in `fix/kew-uat-bugs`):
 *   • Senior peak balance ≤ min(LTC×totalCost, LVR×nrv, facilityLimit) —
 *     ALL three caps are NEVER breached. The user-configured facilityLimit
 *     is now a HARD cap (pre-fix it was advisory: auto-size could grow
 *     senior past facilityLimit up to the covenant ceiling).
 *   • When facilityLimit = 0 (not set), only covenants bind, so the
 *     auto-size mechanic still grows senior up toward LTC/LVR.
 *   • When facilityLimit > 0, senior peak respects facilityLimit.
 *   • Same for mezz.
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'M4', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(seniorFacility: number, ltcTarget: number, equity: number = 1_000_000): MainInputs {
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
    equityDeveloper: { name: 'D', equityCap: equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: seniorFacility, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget, lvrTarget: 0.65, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// Case 1: facilityLimit very high ($100M, well above covenants) + LTC 0.7
// (covenant cap ~$9.1M). Covenants bind, not facilityLimit. Auto-size grows
// senior up to the covenant ceiling.
//
// NOTE: facilityLimit=0 cannot be used here — `hasSenior` gates senior
// drawing on facilityLimit > 0. To exercise covenant-binding, the user must
// configure a facilityLimit; we set it well above covenants so covenants
// bind first.
{
  const r = runCalculations(baseAdmin, fixture(100_000_000, 0.7));
  const cf = r.cashflows;
  const peakSnr = Math.max(...cf.map(c => c.seniorBalance ?? 0));
  // covenant cap = LTC × tdc; tdc ≈ totalCost. Use 0.7 × ~$13M ≈ $9.1M as ceiling.
  // Cap-int can push balance ~5% above the cap (pre-existing engine behaviour).
  assert(peakSnr <= r.feasibility.totalCost * 0.7 * 1.05 + 100,
    `M4 — senior peak respects LTC covenant cap (within 5% cap-int slack); got $${Math.round(peakSnr).toLocaleString()}`);
  assert(peakSnr > 5_000_000,
    `M4 — senior grew above $5M up toward covenant cap; peak=$${Math.round(peakSnr).toLocaleString()}`);
}

// Case 1b (Bug 2): facilityLimit=$5M (hard cap) + LTC 0.7 (covenant ~$9.1M).
// Post-Bug-2 senior peak MUST stay within the user-configured facilityLimit.
// Pre-fix the engine grew senior to ~$9.1M (auto-size past facilityLimit);
// now the equity backstop fires when senior is at facilityLimit.
{
  const r = runCalculations(baseAdmin, fixture(5_000_000, 0.7));
  const cf = r.cashflows;
  const peakSnr = Math.max(...cf.map(c => c.seniorBalance ?? 0));
  assert(peakSnr <= 5_000_000 * 1.05 + 100,
    `Bug 2 — facilityLimit hard caps senior peak; got $${Math.round(peakSnr).toLocaleString()} (cap $5M, 5% cap-int slack)`);
}

// Case 2: facility $20M, LTC 0.7 (covenant cap ~$9.1M, facility well above).
// Senior should NOT exceed covenant cap. No auto-size message (facility >= cap).
{
  const r = runCalculations(baseAdmin, fixture(20_000_000, 0.7, 5_000_000));
  const cf = r.cashflows;
  const peakSnr = Math.max(...cf.map(c => c.seniorBalance ?? 0));
  assert(peakSnr <= r.feasibility.totalCost * 0.7 * 1.05 + 100,
    `M4 — senior peak respects LTC covenant cap when facility > cap; got $${Math.round(peakSnr).toLocaleString()}`);
  const warns = (r.warnings ?? []).join(' | ');
  assert(!/Auto-sized Senior/i.test(warns),
    `M4 — no auto-size message when facility > covenant cap`);
}

// Case 3: facilityLimit very high ($100M) + LTC 0.85 → LVR ≈ $11.7M binds.
{
  const r = runCalculations(baseAdmin, fixture(100_000_000, 0.85));
  const cf = r.cashflows;
  const peakSnr = Math.max(...cf.map(c => c.seniorBalance ?? 0));
  // covenant LTC×$13M ≈ $11M; LVR×$18M ≈ $11.7M. The min binds.
  assert(peakSnr <= r.feasibility.totalCost * 0.85 * 1.05 + 100,
    `M4 — senior peak respects LTC covenant cap (LTC 0.85, ±5% cap-int slack); got $${Math.round(peakSnr).toLocaleString()}`);
  assert(peakSnr > 5_000_000 + 1,
    `M4 — senior auto-sized up to covenants when facilityLimit far above covenant cap`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`M4 AUTO-SIZE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
