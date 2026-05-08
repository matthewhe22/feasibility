/**
 * Review #2 fix — under senior-first mode, debt is iterated in TRANCHE order
 * (senior → senior2 → mezz), NOT by drawdownPriority. Defaults have mezz
 * priority 3 < senior priority 4, so the prior priority-sorted filter would
 * draw mezz BEFORE senior.
 *
 * Test: small synthetic project with both senior + mezz active and BOTH having
 * headroom. After senior-first runs, in any period where mezz has any draw,
 * senior must already be at its M4 covenant cap (or facility limit).
 *
 * Run: cd app && npx tsx src/engine/__tests__/seniorFirstTrancheOrder.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'TrancheOrder', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
  equityDrawdownMode: 'senior-first',
};

function makeInputs(): MainInputs {
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 5000, siteArea: 1000,
      projectStartMonth: 1, projectSpanMonths: 30, projectEndMonth: 30,
      equityDistStartMonth: 28, equityDistSpanMonths: 2,
    },
    landPurchase: {
      landPurchasePrice: 8_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 400_000,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: 'Settlement', percentOfLand: 1, amount: 8_000_000, lumpSum: 0, monthStart: 4, monthSpan: 1 }],
      acquisitionCosts: [{ id: 'sd', description: 'Stamp Duty', percentOfLand: 0, amount: 400_000, lumpSum: 0, monthStart: 4, monthSpan: 1, addGST: false }],
    },
    developmentCosts: [],
    constructionCosts: [{
      code: '3001', description: 'Build', costType: 'Total Construction Costs',
      units: 5000, baseRate: 4000, totalCosts: 20_000_000,
      sCurve: 'Evenly Split', monthStart: 5, monthSpan: 22,
      addGST: true, ctd: 0, ctc: 20_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 0, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 30, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'Comm', salesCommission: 0.02, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'Apt', revenueType: 'Residential',
      units: 1, currentSalePrice: 40_000_000, monthlySalesRate: 1,
      presaleRequired: 0, preSaleExchangeMonth: 0, settlementMonth: 28, settlementSpan: 3,
      gstIncluded: true, addGST: false } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    // Tight equity cap forces senior+mezz to fund construction
    equityDeveloper: { name: 'Developer', equityCap: 6_000_000, percentage: 0,
      interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
      equityContribution: 1, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'JV',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:2 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'LL',facilityLimit:6_000_000,startMonth:1,maturityMonth:5,interestRate:0.08,bbsy:0,margin:0.08,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:3,isCapitalised:false,ltcTarget:0,lvrTarget:0.8,drawdownPriority:1 },
    // Mezz with HEADROOM and lower priority (3) than senior (4) — pre-fix this drew first
    mezzanine: { name:'Mz',facilityLimit:5_000_000,startMonth:5,maturityMonth:30,interestRate:0.12,bbsy:0,margin:0.12,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.15,lvrTarget:0,drawdownPriority:3 },
    // Senior smaller than full project cost so mezz is genuinely needed
    seniorFacility: { name:'Snr',facilityLimit:18_000_000,startMonth:5,maturityMonth:30,interestRate:0.065,bbsy:0.04,margin:0.025,establishmentFeePercent:0.005,lineFeePercent:0.0025,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.60,lvrTarget:0.60,drawdownPriority:4 },
    seniorFacility2: { name:'Snr2',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:5 },
    residualStockFacility: { name:'',facilityType:'residual-stock',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0,lvrTarget:0,drawdownPriority:4 },
    otherFinancingCosts: [],
  };
}

const inputs = makeInputs();
const d = runCalculations(baseAdmin, inputs);

const peakSnr = Math.max(...d.cashflows.map(cf => cf.seniorBalance ?? 0));
const peakMz = Math.max(...d.cashflows.map(cf => cf.mezzBalance ?? 0));
const totalCost = d.feasibility.totalCost;
// Post-Bug-2 (Kew UAT): effective senior cap = min(LTC × TDC, LVR × NRV, facilityLimit).
// Pre-fix this test used totalCost * 0.60 (LTC) directly; post-fix the user's
// facilityLimit ($18M) is below the LTC × TDC (≈ $19.6M), so the hard cap is
// $18M. Compute the effective cap explicitly so the assertion stays correct.
const seniorLtcCap = totalCost * 0.60;
const seniorFacilityLimit = inputs.seniorFacility.facilityLimit;
const seniorCovCap = seniorFacilityLimit > 0 && seniorFacilityLimit < seniorLtcCap
  ? seniorFacilityLimit
  : seniorLtcCap;

console.log(`peakSnr=$${peakSnr.toFixed(0)} peakMz=$${peakMz.toFixed(0)} seniorCovCap=$${seniorCovCap.toFixed(0)} totalCost=$${totalCost.toFixed(0)}`);

// Tranche-order invariant — find the FIRST period mezz starts drawing.
// At that period, senior should already be at (or very close to) its M4
// covenant cap.
let firstMzPeriod = -1;
for (let i = 0; i < d.cashflows.length; i++) {
  const cfi = d.cashflows[i]; if (cfi && (cfi.mezzDrawdown ?? 0) > 100) { firstMzPeriod = i; break; }
}

if (firstMzPeriod === -1) {
  // Mezz never drew. That's fine if senior could fund alone.
  assert(peakSnr <= seniorCovCap + 1, `Senior peak should not breach M4 covenant cap (got ${peakSnr.toFixed(0)} vs cap ${seniorCovCap.toFixed(0)})`);
  console.log('Note: mezz never drew — senior covered the gap alone');
} else {
  // Pre-fix: mezz drew before senior. Post-fix: senior should be at cap when mezz begins.
  const snrAtMz = d.cashflows[firstMzPeriod]?.seniorBalance ?? 0;
  console.log(`First mezz draw at month ${firstMzPeriod + 1}: senior balance was $${snrAtMz.toFixed(0)}`);
  assert(snrAtMz >= seniorCovCap * 0.95,
    `Tranche order — senior should be ≥95% of M4 cap when mezz starts drawing (senior=${snrAtMz.toFixed(0)}, cap=${seniorCovCap.toFixed(0)})`);
}

// R1 cashflow drift remains 0
const r1 = d.cashflows.reduce((s, cf) => s + (cf.netCashflow ?? 0), 0);
assert(Math.abs(r1) < 100, `R1 drift remains ≈ 0 (got $${r1.toFixed(2)})`);

console.log();
console.log('═'.repeat(72));
console.log(`SENIOR-FIRST TRANCHE ORDER: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
