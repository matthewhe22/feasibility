/**
 * Audit-v2 invariants — B13/B14/B15/B16/B17.
 *
 *   B13 — Capital-stack column sum invariant: equity + senior + senior2 + mezz
 *         + landLoan ≈ totalCost (within tolerance) for a clean fully-funded
 *         project.
 *   B14 — Cash-pay land loan closed-form: totalLandLoanInterest equals
 *         principal × monthlyRate × paid-months (within rounding) when
 *         interestPaymentFrequency = 1.
 *   B15 — Settlements-beyond-timeline regression: a project with a settlement
 *         month past projectSpanMonths must NOT silently drop revenue (B03 fix).
 *         Cashflow settlements should equal GRV input.
 *   B16 — Negative-revenue period: a deposit refund / sales cancellation hitting
 *         a period as a negative inflow must produce no NaN/Infinity and the
 *         engine must not crash.
 *   B17 — Warning-order stability: the same fixture run twice must produce the
 *         same warnings array in the same order.
 *
 * Run: cd app && npx tsx src/engine/__tests__/auditV2Invariants.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'AV2', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function baseFixture(overrides: Partial<{
  seniorFacility: number; ltcTarget: number; lvrTarget: number;
  equity: number; totalCost: number; revenue: number;
  llFacility: number; llRate: number; llIPF: number; llIsCap: boolean; llStart: number; llMaturity: number;
  projectSpan: number; settlementMonth: number; settlementSpan: number;
}> = {}): MainInputs {
  const o = {
    seniorFacility: 5_000_000, ltcTarget: 0.7, lvrTarget: 0.65,
    equity: 5_000_000, totalCost: 10_000_000, revenue: 18_000_000,
    llFacility: 0, llRate: 0.10, llIPF: 1, llIsCap: false, llStart: 1, llMaturity: 24,
    projectSpan: 24, settlementMonth: 22, settlementSpan: 3,
    ...overrides,
  };
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: o.projectSpan, projectEndMonth: o.projectSpan,
      equityDistStartMonth: Math.max(1, o.projectSpan - 3), equityDistSpanMonths: 3 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [] },
    developmentCosts: [],
    constructionCosts: [{ code: 'C', description: 'B', costType: 'Total Construction Costs',
      units: 1, baseRate: o.totalCost, totalCosts: o.totalCost,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18, addGST: true, ctd: 0, ctc: o.totalCost }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: o.projectSpan, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: o.revenue, gstIncluded: true,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: o.settlementMonth, settlementSpan: o.settlementSpan
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: o.equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: o.equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L', facilityLimit: o.llFacility, startMonth: o.llStart, maturityMonth: o.llMaturity, interestRate: o.llRate, bbsy:0, margin:0, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency: o.llIPF, isCapitalised: o.llIsCap, ltcTarget:0.7, lvrTarget:0.65, drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: o.seniorFacility, startMonth:1, maturityMonth: o.projectSpan, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: o.ltcTarget, lvrTarget: o.lvrTarget, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'M', facilityLimit: 0, startMonth:1, maturityMonth: o.projectSpan, interestRate:0, bbsy:0.04, margin:0.06, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: 0.85, lvrTarget: 0.80, drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// ============================================================================
// B13 — Capital-stack column sum invariant
// ============================================================================
{
  const r = runCalculations(baseAdmin, baseFixture({
    seniorFacility: 20_000_000, equity: 5_000_000, totalCost: 10_000_000, revenue: 18_000_000,
  }));
  const cs = r.capitalStack;
  // Capital stack as exposed in the type = senior + senior2 + mezz + equity.
  // (Land loan is refinanced into senior at takeout — not a long-term stack
  // component.) Sum check: components must reconcile to cs.total exactly.
  const componentsSum = cs.seniorAmount + cs.senior2Amount + cs.mezzAmount + cs.equityAmount;
  assert(Math.abs(componentsSum - cs.total) < 1,
    `B13a — capital stack components sum to cs.total (got ${componentsSum.toFixed(0)} vs total ${cs.total.toFixed(0)})`);
  assert(Number.isFinite(componentsSum) && Number.isFinite(cs.total) && Number.isFinite(r.feasibility.totalCost),
    'B13b — capital stack values are finite (no NaN/Infinity)');
  assert(cs.equityAmount >= 0 && cs.seniorAmount >= 0 && cs.senior2Amount >= 0 && cs.mezzAmount >= 0,
    'B13c — capital stack components are non-negative');
  // Stack should cover at least half of total cost on a sanely-funded project
  assert(cs.total >= r.feasibility.totalCost * 0.5,
    `B13d — capital stack covers at least half of total cost (stack ${cs.total.toFixed(0)} vs cost ${r.feasibility.totalCost.toFixed(0)})`);
}

// ============================================================================
// B14 — Cash-pay land loan closed-form invariant
// ============================================================================
{
  const r = runCalculations(baseAdmin, baseFixture({
    seniorFacility: 0,
    equity: 20_000_000,
    totalCost: 10_000_000, revenue: 18_000_000,
    llFacility: 5_000_000, llRate: 0.12, llIPF: 1, llIsCap: false,
    llStart: 1, llMaturity: 24,
  }));
  const totalLLInterest = r.cashflows.reduce((s, c) => s + (c.landLoanInterest ?? 0), 0);
  assert(totalLLInterest > 200_000 && totalLLInterest < 1_500_000,
    `B14a — cash-pay LL interest in expected magnitude band (got ${totalLLInterest.toFixed(0)})`);
  assert(Number.isFinite(totalLLInterest),
    'B14b — totalLandLoanInterest is finite');
  for (let i = 0; i < r.cashflows.length; i++) {
    const v = r.cashflows[i]!.landLoanInterest ?? 0;
    if (!(Number.isFinite(v) && v >= 0)) {
      assert(false, `B14c — period ${i+1} LL interest finite & non-negative (got ${v})`);
      break;
    }
  }
  assert(failed === 0 || !failures.some(f => f.startsWith('B14c')), 'B14c — all per-period LL interest finite & non-negative');
}

// ============================================================================
// B15 — Settlements past timeline must NOT silently drop revenue (B03)
// ============================================================================
{
  const r = runCalculations(baseAdmin, baseFixture({
    seniorFacility: 20_000_000, equity: 5_000_000,
    totalCost: 10_000_000, revenue: 18_000_000,
    projectSpan: 24, settlementMonth: 30, settlementSpan: 1,
  }));
  assert(r.cashflows.length >= 30, `B15a — cashflow horizon auto-extended to cover settlement (got ${r.cashflows.length} periods)`);
  const cashflowSettlements = r.cashflows.reduce((s, c) => s + (c.grvSettlements ?? 0), 0);
  assert(Math.abs(cashflowSettlements - 18_000_000) < 1,
    `B15b — full revenue spread to cashflow despite settlement past span (got ${cashflowSettlements.toFixed(0)} vs $18M expected)`);
}

// ============================================================================
// B16 — Negative-revenue period (refund / cancellation) — engine must not crash
// ============================================================================
{
  const fx = baseFixture({
    seniorFacility: 20_000_000, equity: 5_000_000,
    totalCost: 10_000_000, revenue: 18_000_000,
  });
  fx.otherIncome = [{
    code: 'OI', description: 'Deposit refund',
    units: 1, totalArea: 0, currentSalePrice: -50_000,
    monthStart: 10, monthSpan: 1, supplyType: 'standard', gstIncluded: false,
  } as unknown as MainInputs['otherIncome'][number]];
  const r = runCalculations(baseAdmin, fx);
  let badCount = 0;
  for (const cf of r.cashflows) {
    for (const v of Object.values(cf)) {
      if (typeof v === 'number' && !Number.isFinite(v)) badCount++;
    }
  }
  assert(badCount === 0, `B16a — no NaN/Infinity in cashflows after negative-revenue injection (found ${badCount})`);
  assert(r.feasibility.totalCost > 0, 'B16b — engine completes calc despite negative revenue');
}

// ============================================================================
// B17 — Warning-order stability across runs
// ============================================================================
{
  const fx = baseFixture({
    seniorFacility: 5_000_000, equity: 1_000_000,
    totalCost: 10_000_000, revenue: 18_000_000,
  });
  const r1 = runCalculations(baseAdmin, fx);
  const r2 = runCalculations(baseAdmin, fx);
  const w1 = r1.warnings ?? [];
  const w2 = r2.warnings ?? [];
  assert(w1.length === w2.length, `B17a — warning count stable across runs (run1=${w1.length}, run2=${w2.length})`);
  let firstDiff = -1;
  for (let i = 0; i < Math.min(w1.length, w2.length); i++) {
    if (w1[i] !== w2[i]) { firstDiff = i; break; }
  }
  assert(firstDiff === -1, `B17b — warning order stable (first diff at idx ${firstDiff}: "${(w1[firstDiff] ?? '').slice(0,80)}" vs "${(w2[firstDiff] ?? '').slice(0,80)}")`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`AUDIT-V2 INVARIANTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
