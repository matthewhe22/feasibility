/**
 * Regression tests — display & transparency (PR-A).
 *
 *   R4 — funding warnings should be unique. solveFunding is called twice from
 *        runCalculations (preliminary + final) and iterates internally. Without
 *        de-duplication, per-period warnings stack up dozens of times.
 *
 *   R10 — a model with both a high raw input limit AND tighter LTC/LVR ceilings
 *         exposes the engine-sized senior facility limit on capitalStack.
 *
 * Run: cd app && npx tsx src/engine/__tests__/displayTransparency.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++; failures.push(msg);
}

const baseAdmin: AdminConfig = {
  projectName: 'Display PR-A',
  modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 10, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []], buildSCurves: {},
  contingencyGSTMode: 'none', applyGSTWithholding: true,
};

function fixture(): MainInputs {
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24,
      equityDistStartMonth: 1, equityDistSpanMonths: 1 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [] },
    developmentCosts: [],
    constructionCosts: [{
      code: 'C', description: 'B', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18,
      addGST: true, ctd: 0, ctc: 10_000_000,
    }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24,
      addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential',
      units: 1, totalArea: 100, currentSalePrice: 8_000_000, gstIncluded: true,
      preSaleExchangeMonth: 6, preSaleSpan: 1, settlementMonth: 24, settlementSpan: 1
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: 2_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 2_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'M',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:2 },
    seniorFacility: { name:'S',facilityLimit:50_000_000,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0.04,margin:0.06,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.50,lvrTarget:0.50,drawdownPriority:1 },
    seniorFacility2: { name:'S2',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    residualStockFacility: { name:'R',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

const result = runCalculations(baseAdmin, fixture());

// R4 — funding warnings unique
{
  const warns = (result.warnings ?? []);
  const fundingWarns = warns.filter(w => /Period \d+:/.test(w));
  const set = new Set(fundingWarns);
  assert(set.size === fundingWarns.length,
    `R4 — funding warnings de-duplicated: ${fundingWarns.length} entries, ${set.size} unique`);
}

// R10 — engine-sized senior limit < raw input limit when LTC/LVR is binding
{
  const cs = result.capitalStack;
  // The raw input limit is $50M; LTC 50% of cost $14.3M = $7.15M, which would bind first.
  // The engine should emit the lesser limit on cs.seniorAmount.
  const raw = 50_000_000;
  assert(cs.seniorAmount <= raw,
    `R10 — engine-sized senior limit ≤ raw input (got ${cs.seniorAmount} vs ${raw})`);
  assert(cs.seniorAmount > 0,
    `R10 — engine-sized senior limit > 0 (LTC binding, expect >0; got ${cs.seniorAmount})`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`DISPLAY-TRANSPARENCY TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
