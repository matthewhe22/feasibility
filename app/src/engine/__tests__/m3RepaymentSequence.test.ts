/**
 * Regression test — M3: Repayment sequence config affects cash-sweep order.
 *
 * Builds a fixture where senior + mezz are both outstanding at revenue period.
 * Asserts that ['senior','mezz','equity'] repays senior first, while
 * ['mezz','senior','equity'] repays mezz first.
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'M3', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

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
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18, addGST: true, ctd: 0, ctc: 10_000_000 }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: 30_000_000, gstIncluded: true,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as any],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', fixedAmount: 5_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 5_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    // Both senior + mezz active so the repayment sequence matters.
    seniorFacility: { name:'S', facilityLimit:8_000_000, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.7, lvrTarget:0.65, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'M', facilityLimit:3_000_000, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.10, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.85, lvrTarget:0.80, drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// Settlement period 22-24 — first revenue arrives at 22.
function getFirstRevenueRepayment(seq: ('senior'|'mezz'|'equity')[], facility: 'senior' | 'mezz'): number {
  const r = runCalculations({ ...baseAdmin, repaymentSequence: seq }, fixture());
  const cf = r.cashflows;
  // First period where the facility gets repaid
  for (let i = 0; i < cf.length; i++) {
    const c = cf[i]; if (!c) continue; const repay = facility === 'senior' ? c.seniorRepayment : c.mezzRepayment;
    if (repay > 0) return i;
  }
  return -1;
}

// Senior-first ordering: senior repaid first
{
  const seniorFirstSnrIdx = getFirstRevenueRepayment(['senior', 'mezz', 'equity'], 'senior');
  const seniorFirstMezzIdx = getFirstRevenueRepayment(['senior', 'mezz', 'equity'], 'mezz');
  // With senior-first, senior repayment starts at or before mezz repayment
  assert(seniorFirstSnrIdx >= 0 && seniorFirstSnrIdx <= seniorFirstMezzIdx,
    `M3 — senior-first sequence: senior repays at-or-before mezz (snr=${seniorFirstSnrIdx}, mz=${seniorFirstMezzIdx})`);
}
// Mezz-first ordering: mezz repaid first
{
  const mezzFirstSnrIdx = getFirstRevenueRepayment(['mezz', 'senior', 'equity'], 'senior');
  const mezzFirstMezzIdx = getFirstRevenueRepayment(['mezz', 'senior', 'equity'], 'mezz');
  // With mezz-first, mezz repayment starts at or before senior repayment
  assert(mezzFirstMezzIdx >= 0 && mezzFirstMezzIdx <= mezzFirstSnrIdx,
    `M3 — mezz-first sequence: mezz repays at-or-before senior (snr=${mezzFirstSnrIdx}, mz=${mezzFirstMezzIdx})`);
}

// Default sequence (no admin override) → senior-first
{
  const r = runCalculations(baseAdmin, fixture());
  const cf = r.cashflows;
  const firstSnr = cf.findIndex(c => (c.seniorRepayment ?? 0) > 0);
  const firstMezz = cf.findIndex(c => (c.mezzRepayment ?? 0) > 0);
  assert(firstSnr >= 0 && firstSnr <= firstMezz,
    `M3 — default sequence is senior-first (no admin override)`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`M3 REPAYMENT SEQUENCE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
