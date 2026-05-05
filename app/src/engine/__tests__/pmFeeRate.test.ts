/**
 * Regression tests for the v2-UAT P0 PM-Fee-100% bug.
 *
 * Old engine: rate = pmFees[0].units → user typing units=1 produced 100% PM
 * fee on every cost line. New engine: rate = pmFees[0].feeRatePercent only.
 *
 * Run: cd app && npx tsx src/engine/__tests__/pmFeeRate.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs, CostLineItem } from '../../types';

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
  projectName: 'PM Test',
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

function makeInputs(pmFees: CostLineItem[]): MainInputs {
  // Dead-simple project: one $10M construction line, no GST on costs
  // (addGST=false), no land/dev/marketing/etc — so the PM fee base equals
  // exactly $10M and the math is easy to verify.
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 100, projectGFA: 10000, siteArea: 1000,
      projectStartMonth: 1, projectSpanMonths: 12, projectEndMonth: 12,
      equityDistStartMonth: 12, equityDistSpanMonths: 1,
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
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
      addGST: false, ctd: 0, ctc: 10_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [], pmFees,
    sellingCosts: [], frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [], rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityJV: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: { name: 'S', facilityLimit: 100_000_000, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

const PM_BASE: CostLineItem = {
  code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
  units: 1, baseRate: 0, totalCosts: 0,
  sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
  addGST: false, ctd: 0, ctc: 0,
};

// ── 1. The headline fix: feeRatePercent=0.02 → PM fee = 2% × $10M = $200K ──
//    NOT 100% × $10M = $10M (the v2-UAT bug shape).
{
  const pmFees: CostLineItem[] = [{ ...PM_BASE, feeRatePercent: 0.02 }];
  const result = runCalculations(baseAdmin, makeInputs(pmFees));
  close(result.feasibility.pmFee, 200_000, 1,
    'PM Fee with feeRatePercent=0.02 should be $200K (2% × $10M base)');
}

// ── 2. The bug shape it MUST NOT replicate: units=1 alone no longer triggers 100% rate ──
{
  // Construct a PM line where feeRatePercent is unset (literally absent from
  // the object). The old engine read .units as the rate; the fixed engine
  // ignores .units entirely and falls back to 0.02 when feeRatePercent is
  // missing. The presence of units=1 must NOT produce 100% PM fee.
  const pmFees: CostLineItem[] = [{ ...PM_BASE, units: 1 }];
  // Defensive: ensure no feeRatePercent leaked from the spread base
  delete (pmFees[0] as { feeRatePercent?: number }).feeRatePercent;
  const result = runCalculations(baseAdmin, makeInputs(pmFees));
  // Default fallback is 0.02 (2%), so PM fee should be $200K, NOT $10M.
  close(result.feasibility.pmFee, 200_000, 1,
    'units=1 alone (no feeRatePercent) MUST NOT produce 100% PM fee; defaults to 2%');
  assert(result.feasibility.pmFee < 1_000_000,
    'PM fee never approaches the $10M cost base when feeRatePercent is unset');
}

// ── 3. Out-of-range feeRatePercent (≥1) is rejected and falls back to 0.02 with a warning ──
{
  const pmFees: CostLineItem[] = [{ ...PM_BASE, feeRatePercent: 5 }];
  const result = runCalculations(baseAdmin, makeInputs(pmFees));
  close(result.feasibility.pmFee, 200_000, 1,
    'feeRatePercent=5 (invalid) falls back to 0.02 → $200K');
  const sawWarning = (result.warnings ?? []).some(w =>
    typeof w === 'string' ? w.includes('PM Fee rate') : (w as { message?: string }).message?.includes('PM Fee rate'));
  assert(sawWarning, 'an out-of-range PM fee rate emits a warning');
}

// ── 4. Different rates produce proportionally different PM fees ──
{
  const r1 = runCalculations(baseAdmin, makeInputs([{ ...PM_BASE, feeRatePercent: 0.01 }]));
  const r3 = runCalculations(baseAdmin, makeInputs([{ ...PM_BASE, feeRatePercent: 0.03 }]));
  close(r1.feasibility.pmFee, 100_000, 1, 'rate=1% → $100K PM fee');
  close(r3.feasibility.pmFee, 300_000, 1, 'rate=3% → $300K PM fee');
  assert(Math.abs(r3.feasibility.pmFee - 3 * r1.feasibility.pmFee) < 1,
    'tripling the rate triples the PM fee (linearity)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`PM-FEE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  /// <reference types="node" />
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
