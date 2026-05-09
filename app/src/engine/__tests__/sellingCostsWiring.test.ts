/**
 * Reproducer for the frontEndSellingCosts / backEndSellingCosts wiring bug.
 *
 * `inputs.frontEndSellingCosts` and `inputs.backEndSellingCosts` are declared
 * in MainInputs (types/index.ts) and seeded by the Inputs UI as named cost
 * line items, but the engine never read them: cf.sellingCostsFrontEnd /
 * sellingCostsBackEnd were populated only from the % commission spread
 * (commissions.frontEnd / commissions.backEnd in selling.ts). On Kew Demo
 * Extra this silently dropped $1.5M (Sales Marketing) + $1M (Settlement
 * Legal) on both feasibility and waterfall sides.
 *
 * Run: cd app && npx tsx src/engine/__tests__/sellingCostsWiring.test.ts
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
function close(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) <= tol,
    `${msg} — expected ${expected} ±${tol}, got ${actual}`);
}

const baseAdmin: AdminConfig = {
  projectName: 'Selling Costs Wiring Test',
  modelStartDate: 44927,
  monthsPerPeriod: 1,
  lastActualsPeriod: 44927,
  tolerance: 10,
  daysPerYear: 365,
  monthsPerYear: 12,
  currency: '$',
  sCurveOptions: ['Evenly Split'],
  manualSCurves: [[], [], []],
  buildSCurves: {},
  contingencyGSTMode: 'none',
};

function baseInputs(): MainInputs {
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 28, projectEndMonth: 28,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: {
      landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [], acquisitionCosts: [],
    },
    developmentCosts: [],
    constructionCosts: [{
      code: 'C1', description: 'Build', costType: 'Total Construction Costs',
      units: 1, baseRate: 10_000_000, totalCosts: 10_000_000,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 28,
      addGST: false, ctd: 0, ctc: 10_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 28,
      addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [{ code: 'S1', description: 'Apt', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [],
    backEndSellingCosts: [],
    lettingFees: [],
    grvItems: [{
      code: 'G1', description: 'Apartment', revenueType: 'Apartments',
      units: 1, totalArea: 100, currentSalePrice: 25_000_000, gstIncluded: false,
      preSaleExchangeMonth: 28, preSaleSpan: 1,
      settlementMonth: 28, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Dev', equityCap: 20_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 20_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: 'JV', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: { name: 'S', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 28, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

function inputsWithSellingCosts(): MainInputs {
  const inp = baseInputs();
  inp.frontEndSellingCosts = [{
    code: 'FS1', description: 'Sales Marketing', costType: 'Selling & Leasing Costs',
    units: 1, baseRate: 1_500_000, totalCosts: 1_500_000,
    sCurve: 'Evenly Split', monthStart: 22, monthSpan: 6,
    addGST: true, ctd: 0, ctc: 1_500_000,
  }];
  inp.backEndSellingCosts = [{
    code: 'BS1', description: 'Settlement Legal', costType: 'Selling & Leasing Costs',
    units: 1, baseRate: 1_000_000, totalCosts: 1_000_000,
    sCurve: 'Evenly Split', monthStart: 26, monthSpan: 3,
    addGST: true, ctd: 0, ctc: 1_000_000,
  }];
  return inp;
}

// Reference run: empty selling-costs arrays.
const refResult = runCalculations(baseAdmin, baseInputs());
const refTotalCost = refResult.feasibility.totalCost;

// Test run: with $1.5M FE + $1M BE selling costs.
const result = runCalculations(baseAdmin, inputsWithSellingCosts());
const cf = result.cashflows;

// ── 1. Front-end named items show up in the cashflow row ──
{
  const sumFE = cf.reduce((s, c) => s + (c.sellingCostsFrontEnd ?? 0), 0);
  assert(sumFE >= 1_500_000 - 1,
    `Σ cf.sellingCostsFrontEnd must include the $1.5M named line item — got ${sumFE.toFixed(0)}`);
}

// ── 2. Back-end named items show up in the cashflow row ──
{
  const sumBE = cf.reduce((s, c) => s + (c.sellingCostsBackEnd ?? 0), 0);
  assert(sumBE >= 1_000_000 - 1,
    `Σ cf.sellingCostsBackEnd must include the $1M named line item — got ${sumBE.toFixed(0)}`);
}

// ── 3. feasibility.totalCost increases by AT LEAST the named-item nominals ──
//
// Selling costs are now in the PM-fee dynamic base (so totalPMFees grows by
// `pmFeeRate × $2.5M × (1+gstRate)`) and add to the itcUnrecovered tail (last
// itcLag periods of GST never refund). Both are intentional downstream
// effects of correctly wiring the costs through. The fix's contract is that
// the named-item nominals MUST appear in totalCost; bonus knock-on
// adjustments (PM fee uplift, ITC tail) are legitimate accounting
// consequences. Lower bound = nominal; upper bound = nominal + small overhead.
{
  const delta = result.feasibility.totalCost - refTotalCost;
  assert(delta >= 2_500_000 - 1,
    `feasibility.totalCost delta must include the $2.5M nominal — got ${delta.toFixed(0)}`);
  assert(delta < 2_500_000 * 1.10,
    `feasibility.totalCost delta should be ≈ $2.5M plus small PM/ITC overhead, not far above — got ${delta.toFixed(0)}`);
}

// ── 4. R2 reconciliation still holds with selling costs wired through ──
{
  const wf = cf.reduce((s, c) => s + (c.profitDistribution ?? 0), 0);
  const eqIn = cf.reduce((s, c) => s + (c.equityInjection ?? 0), 0);
  const eqOut = cf.reduce((s, c) => s + (c.equityRepatriation ?? 0), 0);
  const last = cf[cf.length - 1];
  const debt = last
    ? (last.landLoanBalance ?? 0) + (last.seniorBalance ?? 0) + (last.senior2Balance ?? 0) + (last.mezzBalance ?? 0)
    : 0;
  const reconciled = wf - Math.max(0, eqIn - eqOut) - debt;
  close(reconciled, result.feasibility.totalProfit, 10,
    `R2 reconciliation: feasibility ≈ waterfall − unrepatriated equity − unpaid debt (within $10)`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`SELLING-COSTS-WIRING TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
