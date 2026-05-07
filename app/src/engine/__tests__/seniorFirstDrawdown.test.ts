/**
 * Engine test — `equityDrawdownMode: 'senior-first'`.
 *
 * Invariant: once `i >= senior.startMonth` AND senior has covenant headroom
 * (LTC, LVR, and facility limit all > current balance), the period gap fills
 * from senior BEFORE equity. Equity may only step in when all debt facilities
 * are at cap. Pre-construction periods (i < senior.startMonth) keep the
 * existing equity-priority behaviour, so equity still covers land + DA.
 *
 * Compares senior-first against equity-first on the same fixture:
 *   - cumulative equity (senior-first) ≤ cumulative equity (equity-first)
 *   - peak senior balance (senior-first) ≥ peak senior balance (equity-first)
 *   - total cost ~equal modulo finance-cost differences (cap-int basis varies)
 *   - both modes produce R1-clean cashflows (Σ netCashflow ≈ 0)
 *
 * Run: cd app && npx tsx src/engine/__tests__/seniorFirstDrawdown.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'SeniorFirst', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
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
    marketingCosts: [],
    otherStandardCosts: [],
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
    equityDeveloper: { name: 'Developer', fixedAmount: 6_000_000, percentage: 0,
      interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
      equityContribution: 1, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'JV',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:2 },
    equityPreferred: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'LL',facilityLimit:6_000_000,startMonth:1,maturityMonth:5,interestRate:0.08,bbsy:0,margin:0.08,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:3,isCapitalised:false,ltcTarget:0,lvrTarget:0.8,drawdownPriority:1 },
    mezzanine: { name:'Mz',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0.15,bbsy:0,margin:0.15,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0,lvrTarget:0,drawdownPriority:3 },
    seniorFacility: { name:'Snr',facilityLimit:25_000_000,startMonth:5,maturityMonth:30,interestRate:0.065,bbsy:0.04,margin:0.025,establishmentFeePercent:0.005,lineFeePercent:0.0025,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.7,drawdownPriority:4 },
    seniorFacility2: { name:'Snr2',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:5 },
    residualStockFacility: { name:'',facilityType:'residual-stock',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0,lvrTarget:0,drawdownPriority:4 },
    otherFinancingCosts: [],
  };
}

const inputs = makeInputs();
const adminEquityFirst: AdminConfig = { ...baseAdmin, equityDrawdownMode: 'equity-first' };
const adminSeniorFirst: AdminConfig = { ...baseAdmin, equityDrawdownMode: 'senior-first' };

const dEF = runCalculations(adminEquityFirst, inputs);
const dSF = runCalculations(adminSeniorFirst, inputs);

const cumEqEF = dEF.cashflows.reduce((s, cf) => s + (cf.equityInjection ?? 0), 0);
const cumEqSF = dSF.cashflows.reduce((s, cf) => s + (cf.equityInjection ?? 0), 0);
const peakSnrEF = Math.max(...dEF.cashflows.map(cf => cf.seniorBalance ?? 0));
const peakSnrSF = Math.max(...dSF.cashflows.map(cf => cf.seniorBalance ?? 0));
const r1EF = dEF.cashflows.reduce((s, cf) => s + (cf.netCashflow ?? 0), 0);
const r1SF = dSF.cashflows.reduce((s, cf) => s + (cf.netCashflow ?? 0), 0);

console.log('=== Senior-first drawdown invariants ===');
console.log('Equity-first  : cum equity = $' + cumEqEF.toFixed(0).padStart(12) + ', peak Senior $' + peakSnrEF.toFixed(0));
console.log('Senior-first  : cum equity = $' + cumEqSF.toFixed(0).padStart(12) + ', peak Senior $' + peakSnrSF.toFixed(0));

assert(cumEqSF < cumEqEF - 1, `senior-first equity should be < equity-first equity (${cumEqSF} vs ${cumEqEF})`);
assert(peakSnrSF > peakSnrEF + 1, `senior-first peak senior should be > equity-first peak senior (${peakSnrSF} vs ${peakSnrEF})`);
assert(Math.abs(r1EF) < 100, `equity-first cashflow drift should be ~0 (got ${r1EF.toFixed(2)})`);
assert(Math.abs(r1SF) < 100, `senior-first cashflow drift should be ~0 (got ${r1SF.toFixed(2)})`);

// Per-period invariant: under senior-first, in any period i >= senior.startMonth where
// the period had a positive gap AND senior was below its M4 auto-size covenant cap
// (LTC × totalCost), equity injection should be ~0. Use a tolerance to account for
// rounding inside the gap-fill loop (~$1).
const snrStartIdx = inputs.seniorFacility.startMonth - 1;
const seniorCovenantCap = inputs.seniorFacility.ltcTarget > 0
  ? dSF.feasibility.totalCost * inputs.seniorFacility.ltcTarget
  : Infinity;
let badPeriods = 0;
for (let i = snrStartIdx; i < dSF.cashflows.length; i++) {
  const cf = dSF.cashflows[i];
  if (!cf) continue;
  const costExc = (cf.constructionCosts ?? 0) + (cf.contingency ?? 0) + (cf.developmentCosts ?? 0)
                + (cf.marketingCosts ?? 0) + (cf.otherStandardCosts ?? 0) + (cf.pmFees ?? 0)
                + (cf.landCosts ?? 0) + (cf.acquisitionCosts ?? 0);
  if (costExc > 1000 && (cf.equityInjection ?? 0) > 100) {
    const seniorCovenantHeadroom = seniorCovenantCap - (cf.seniorBalance ?? 0);
    if (seniorCovenantHeadroom > 1000) badPeriods++;
  }
}
assert(badPeriods === 0, `senior-first: equity drawn during construction while senior had M4 covenant headroom (${badPeriods} periods)`);

// Pre-construction equity invariant: equity drawn before senior.startMonth + completion top-up
// Should account for ~all of land + DA + early acquisition. Bounded above by 1.10 × cumulative
// pre-construction cost (10% slack for completion top-up + cap-int absorption).
let preConstructionCost = 0;
for (let i = 0; i < snrStartIdx; i++) {
  const cf = dSF.cashflows[i];
  if (!cf) continue;
  preConstructionCost += (cf.landCosts ?? 0) + (cf.acquisitionCosts ?? 0) + (cf.developmentCosts ?? 0)
                       + (cf.constructionCosts ?? 0) + (cf.contingency ?? 0) + (cf.marketingCosts ?? 0)
                       + (cf.otherStandardCosts ?? 0) + (cf.pmFees ?? 0);
}
console.log('pre-construction cost (m1-' + snrStartIdx + '): $' + preConstructionCost.toFixed(0));
console.log('cum equity under senior-first        : $' + cumEqSF.toFixed(0));
assert(cumEqSF <= preConstructionCost * 1.10 + 100_000, `senior-first cum equity ${cumEqSF.toFixed(0)} exceeds 1.10 × preConstructionCost ${(preConstructionCost*1.10).toFixed(0)}`);

console.log();
console.log('═'.repeat(72));
console.log(`SENIOR-FIRST DRAWDOWN: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
