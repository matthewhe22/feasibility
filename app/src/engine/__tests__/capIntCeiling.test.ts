/**
 * FU2 — Cap-int hard ceiling at the M4 covenant cap.
 *
 * Invariant: under any drawdown mode, a capitalised senior facility's running
 * balance must NEVER exceed the M4 covenant cap (LTC × tdc OR LVR × nrv).
 * Previously, accrued cap-int could push balance over the cap by up to one
 * period's worth of interest, surfacing as a [FUNDING] covenant overshoot
 * warning. After FU2: when balance + would-be cap-int > covenant cap, the
 * engine pays that period's interest in cash instead of capitalising.
 *
 * Test on Sydney CBD senior-first fixture — pre-FU2 it breached by ~$6.18M.
 *
 * Run: cd app && npx tsx src/engine/__tests__/capIntCeiling.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'CapIntCeiling', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
  equityDrawdownMode: 'senior-first',
};

function makeInputs(): MainInputs {
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 200, projectGFA: 22000, siteArea: 1500,
      projectStartMonth: 1, projectSpanMonths: 42, projectEndMonth: 42,
      equityDistStartMonth: 41, equityDistSpanMonths: 2 },
    landPurchase: { landPurchasePrice: 40_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 2_206_000,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 'd', description: 'Deposit', percentOfLand: 0.05, amount: 2_000_000, lumpSum: 0, monthStart: 1, monthSpan: 1 },
                      { id: 's', description: 'Settlement', percentOfLand: 0.95, amount: 38_000_000, lumpSum: 0, monthStart: 6, monthSpan: 1 }],
      acquisitionCosts: [{ id: 'sd', description: 'Stamp Duty', percentOfLand: 0, amount: 2_206_000, lumpSum: 0, monthStart: 6, monthSpan: 1, addGST: false }] },
    developmentCosts: [],
    constructionCosts: [{ code: '3001', description: 'Build', costType: 'Total Construction Costs',
      units: 22000, baseRate: 5300, totalCosts: 116_600_000,
      sCurve: 'Evenly Split', monthStart: 7, monthSpan: 30,
      addGST: true, ctd: 0, ctc: 116_600_000 }],
    constructionContingencyPercent: 0.05,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 0, baseRate: 0, totalCosts: 0, feeRatePercent: 0.02,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 38, addGST: true, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'Comm', salesCommission: 0.02, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'Apt', revenueType: 'Residential',
      units: 200, currentSalePrice: 249_000_000, monthlySalesRate: 16,
      presaleRequired: 0, preSaleExchangeMonth: 0, settlementMonth: 36, settlementSpan: 5,
      gstIncluded: true, addGST: false } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Developer', equityCap: 80_000_000, percentage: 0,
      interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
      equityContribution: 1, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:2 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'LL',facilityLimit:32_000_000,startMonth:1,maturityMonth:7,interestRate:0.0825,bbsy:0.04,margin:0.0425,establishmentFeePercent:0.0075,lineFeePercent:0,interestPaymentFrequency:3,isCapitalised:false,ltcTarget:0,lvrTarget:0.8,drawdownPriority:1 },
    mezzanine: { name:'Mz',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0.15,bbsy:0,margin:0.15,establishmentFeePercent:0.015,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0,lvrTarget:0,drawdownPriority:3 },
    seniorFacility: { name:'Snr',facilityLimit:139_000_000,startMonth:7,maturityMonth:42,interestRate:0.065,bbsy:0.04,margin:0.025,establishmentFeePercent:0.005,lineFeePercent:0.0025,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.7,drawdownPriority:4 },
    seniorFacility2: { name:'Snr2',facilityLimit:0,startMonth:33,maturityMonth:33,interestRate:0.025,bbsy:0.0196,margin:0.025,establishmentFeePercent:0.005,lineFeePercent:0.025,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:5 },
    residualStockFacility: { name:'',facilityType:'residual-stock',facilityLimit:0,startMonth:0,maturityMonth:0,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:0,isCapitalised:true,ltcTarget:0.84,lvrTarget:0.754,drawdownPriority:4 },
    otherFinancingCosts: [],
  };
}

const inputs = makeInputs();
const d = runCalculations(baseAdmin, inputs);

// FU2.1 — Senior peak balance ≤ engine's reported M4 covenant cap. The cap is
// `tdc × ltcTarget` (tdc includes capitalised finance from prior iteration),
// so test it via the [INFO] auto-size message — its 'within covenant cap $X'
// substring is the engine's authoritative cap. Falls back to skipping if the
// fixture doesn't surface auto-size (no overflow → no message).
const peakSenior = Math.max(...d.cashflows.map(cf => cf.seniorBalance ?? 0));
const autoSizeMsg = d.warnings.find(w => /Auto-sized Senior #1/.test(w));
const autoCapMatch = autoSizeMsg?.match(/within covenant cap \$([0-9,]+)/);
const engineCovenantCap = autoCapMatch && autoCapMatch[1] ? parseFloat(autoCapMatch[1].replace(/,/g, '')) : Infinity;
console.log(`Sydney CBD senior-first: peakSenior=$${peakSenior.toFixed(0)} vs engineCovenantCap=$${engineCovenantCap.toFixed(0)}`);
assert(peakSenior <= engineCovenantCap + 1,
  `FU2.1 — Senior peak ${peakSenior.toFixed(0)} should NOT exceed engine M4 covenant cap ${engineCovenantCap.toFixed(0)} (post-FU2 cap-int ceiling)`);

// FU2.2 — No [FUNDING] Senior #1 covenant cap exceeded warning
const covenantBreachWarning = d.warnings.find(w => /Senior #1 covenant cap exceeded/.test(w));
assert(!covenantBreachWarning,
  `FU2.2 — No covenant-breach warning under senior-first (got: '${covenantBreachWarning?.slice(0, 80) ?? 'none'}')`);

// FU2.3 — There IS a [INFO] cap-int ceiling message (since the fixture pushes senior to its cap)
const ceilingInfo = d.warnings.find(w => /cap-int exceeds covenant cap/.test(w));
assert(!!ceilingInfo,
  `FU2.3 — Expected [INFO] cap-int ceiling message indicating switch to cash-pay (got: ${d.warnings.length} warnings, none matched)`);

// FU2.4 — R1 cashflow drift remains ≈ 0 (cash-pay interest doesn't break the close)
const r1 = d.cashflows.reduce((s, cf) => s + (cf.netCashflow ?? 0), 0);
assert(Math.abs(r1) < 100,
  `FU2.4 — R1 cashflow drift remains ≈ 0 under cap-int ceiling (got $${r1.toFixed(2)})`);

// FU2.5 — Some periods have positive seniorInterest paid in cash (bankBalance absorbed it)
//        i.e. cashflow shows interest > 0 in periods where senior balance was at the cap.
let cashPaidInterestPeriods = 0;
for (const cf of d.cashflows) {
  if ((cf.seniorInterest ?? 0) > 0 && (cf.seniorDrawdown ?? 0) === 0) cashPaidInterestPeriods++;
}
assert(cashPaidInterestPeriods > 0,
  `FU2.5 — Expected ≥1 period with cash-paid senior interest (interest > 0 AND drawdown = 0); got ${cashPaidInterestPeriods}`);

console.log();
console.log('═'.repeat(72));
console.log(`FU2 CAP-INT CEILING: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
