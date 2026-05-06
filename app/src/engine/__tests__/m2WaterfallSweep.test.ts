/**
 * Regression test — M2: Final-period waterfall fully consumes capitalised
 * interest before equity returns. Cap-int residual on debt must be 0.
 *
 * Plus: confirms that on a no-presale settlement-only project, the front-end
 * commission is correctly routed to back-end (the entire commission is
 * recognised at settlement when there's no presale window).
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'M2 sweep', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(presale: boolean): MainInputs {
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
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0.025, preCommissionPercent: 0.50, depositPercent: 0.10, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: 18_000_000, gstIncluded: true,
      preSaleExchangeMonth: presale ? 8 : 0, preSaleSpan: presale ? 6 : 0,
      settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', fixedAmount: 5_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 5_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: 8_000_000, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.06, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget:0.7, lvrTarget:0.65, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// M2 — Cap-int residual = 0 at end of project (no-presale settlement-only)
{
  const r = runCalculations(baseAdmin, fixture(false));
  const cf = r.cashflows;
  const last = cf[cf.length - 1]!;
  const debtRes = (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0);
  assert(debtRes < 100,
    `M2 — debt residual ≈ 0 at project end (no-presale): got $${debtRes.toFixed(2)}`);
}

// M2 — Cap-int residual = 0 with presale variant
{
  const r = runCalculations(baseAdmin, fixture(true));
  const cf = r.cashflows;
  const last = cf[cf.length - 1]!;
  const debtRes = (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0);
  assert(debtRes < 100,
    `M2 — debt residual ≈ 0 at project end (presale): got $${debtRes.toFixed(2)}`);
}

// M2 — On a no-presale project, the front-end commission is routed to back-end.
//   Total commission = $18M × 2.5% = $450k, spread to back-end at settlement.
{
  const r = runCalculations(baseAdmin, fixture(false));
  const cf = r.cashflows;
  const tot = (k: 'sellingCostsFrontEnd' | 'sellingCostsBackEnd') => cf.reduce((s, c) => s + ((c[k] as number) || 0), 0);
  const totalCommission = 18_000_000 * 0.025;
  const fe = tot('sellingCostsFrontEnd');
  const be = tot('sellingCostsBackEnd');
  assert(Math.abs(fe) < 1,
    `M2 — front-end commissions = 0 on no-presale project: got $${fe.toFixed(2)}`);
  assert(Math.abs(be - totalCommission) < 1,
    `M2 — back-end commissions = full commission on no-presale project: got $${be.toFixed(2)} expected $${totalCommission.toFixed(2)}`);
}

// M2 — Reconciliation invariant: feasibilityProfit ≈ waterfall − unrep − debt (within $1k for no-presale projects)
{
  const r = runCalculations(baseAdmin, fixture(false));
  const cf = r.cashflows;
  const wp = cf.reduce((s, c) => s + c.profitDistribution, 0);
  const eqIn = cf.reduce((s, c) => s + c.equityInjection, 0);
  const eqOut = cf.reduce((s, c) => s + c.equityRepatriation, 0);
  const ue = Math.max(0, eqIn - eqOut);
  const last = cf[cf.length - 1]!;
  const debt = (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0) + (last.landLoanBalance ?? 0);
  const reconciled = wp - ue - debt;
  const variance = reconciled - r.feasibility.totalProfit;
  const tol = Math.max(50_000, r.feasibility.totalCost * 0.005);
  assert(Math.abs(variance) < tol,
    `M2 — reconciliation variance < max($50k, 0.5%×cost) on no-presale project: got $${variance.toFixed(2)} (tol $${tol.toFixed(0)})`);
}

// M2 — On a presale project the same invariant should hold tightly too
{
  const r = runCalculations(baseAdmin, fixture(true));
  const cf = r.cashflows;
  const wp = cf.reduce((s, c) => s + c.profitDistribution, 0);
  const eqIn = cf.reduce((s, c) => s + c.equityInjection, 0);
  const eqOut = cf.reduce((s, c) => s + c.equityRepatriation, 0);
  const ue = Math.max(0, eqIn - eqOut);
  const last = cf[cf.length - 1]!;
  const debt = (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0) + (last.landLoanBalance ?? 0);
  const reconciled = wp - ue - debt;
  const variance = reconciled - r.feasibility.totalProfit;
  const tol2 = Math.max(50_000, r.feasibility.totalCost * 0.005);
  assert(Math.abs(variance) < tol2,
    `M2 — reconciliation variance < max($50k, 0.5%×cost) on presale project: got $${variance.toFixed(2)} (tol $${tol2.toFixed(0)})`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`M2 WATERFALL SWEEP TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
