/**
 * CR3 — Solver convergence transparency.
 *
 * The 50-iteration cap silently clamps with a non-blocking warning. This test
 * locks in the solver's diagnostic surface:
 *   • `solver.converged === true` on known-good fixtures.
 *   • `solver.convergedIn < solver.maxIterations` (with substantial headroom).
 *   • `solver.convergedIn === null` only when `solver.converged === false`.
 *   • `solver.iterations` matches `solver.convergedIn` on success paths.
 *
 * If a future change pushes convergence into the high-40s on a known-good
 * fixture, the threshold check below catches it BEFORE the solver hits the
 * cap (where it would only emit a non-blocking warning).
 *
 * Run: cd app && npx tsx src/engine/__tests__/cr3SolverConvergence.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'CR3', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(opts: { senior?: number; mezz?: number; equity?: number; revenue?: number; cost?: number } = {}): MainInputs {
  const o = { senior: 20_000_000, mezz: 0, equity: 5_000_000, revenue: 18_000_000, cost: 10_000_000, ...opts };
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly', projectLots: 1, projectGFA: 1000, siteArea: 500, projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24, equityDistStartMonth: 22, equityDistSpanMonths: 3 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0, gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false, stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0, paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }], acquisitionCosts: [] },
    developmentCosts: [],
    constructionCosts: [{ code: 'C', description: 'B', costType: 'Total Construction Costs', units: 1, baseRate: o.cost, totalCosts: o.cost, sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18, addGST: true, ctd: 0, ctc: o.cost }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: 'PM', description: 'P', costType: 'Development & Project Management Fees', units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0, sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100, currentSalePrice: o.revenue, gstIncluded: true, preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', fixedAmount: o.equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: o.equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',fixedAmount:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: o.senior, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'M', facilityLimit: o.mezz, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.06, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: 0.85, lvrTarget: 0.80, drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// ============================================================================
// CR3.1 — Clean fixture: should converge with massive headroom (well below 50)
// ============================================================================
{
  const r = runCalculations(baseAdmin, fixture({ senior: 20_000_000, equity: 5_000_000 }));
  const s = r.solver;
  assert(s != null, 'CR3.1a — solver diagnostics surfaced on result');
  if (!s) { /* skip rest of block; assertion above already failed */ } else {
  assert(s.converged === true, `CR3.1b — known-good fixture converges (got converged=${s.converged})`);
  assert(typeof s.convergedIn === 'number' && s.convergedIn !== null,
    `CR3.1c — convergedIn is a number on success (got ${s.convergedIn})`);
  if (typeof s.convergedIn === 'number') {
    assert(s.convergedIn < s.maxIterations,
      `CR3.1d — convergedIn (${s.convergedIn}) < maxIterations (${s.maxIterations})`);
    assert(s.convergedIn < 30,
      `CR3.1e — convergedIn (${s.convergedIn}) has substantial headroom below cap (a value approaching 50 is a calibration warning)`);
    assert(s.convergedIn === s.iterations,
      `CR3.1f — on success path, convergedIn matches iterations (${s.convergedIn} vs ${s.iterations})`);
  }
  } // close if (s) guard
}

// ============================================================================
// CR3.2 — Mezz-active fixture (Q1 fixture shape): still well below cap
// ============================================================================
{
  const r = runCalculations(baseAdmin, fixture({ senior: 5_000_000, mezz: 1_000_000, equity: 1_000_000 }));
  const s = r.solver;
  if (!s) { assert(false, 'CR3.2a — solver missing'); } else {
    assert(s.converged === true, `CR3.2a — mezz-active fixture converges`);
    assert(s.convergedIn !== null && s.convergedIn < 30,
      `CR3.2b — mezz-active convergedIn (${s.convergedIn}) has headroom (target < 30)`);
  }
}

// ============================================================================
// CR3.3 — Loss-making fixture (M2 clawback path): still converges in headroom
// ============================================================================
{
  const r = runCalculations(baseAdmin, fixture({ senior: 5_000_000, mezz: 1_000_000, equity: 1_000_000, revenue: 12_000_000, cost: 10_000_000 }));
  const s = r.solver;
  if (!s) { assert(false, 'CR3.3a — solver missing'); } else {
    assert(s.converged === true, `CR3.3a — loss-making fixture converges`);
    assert(s.convergedIn !== null && s.convergedIn < 30,
      `CR3.3b — loss-making convergedIn (${s.convergedIn}) has headroom`);
  }
}

// ============================================================================
// CR3.4 — Type contract: convergedIn === null only when converged === false
// (We don't have a cap-busting fixture to drive this directly without
// flooding the solver, but assert the relationship at the type level:
// every success-path test above already covers `convergedIn !== null when converged`.
// Here we assert the inverse: if a test elsewhere reports !converged, it MUST
// also have convergedIn === null. Since none of our above fixtures fail to
// converge, just check the field is well-typed on every result we've seen.)
// ============================================================================
{
  const r = runCalculations(baseAdmin, fixture({}));
  const s = r.solver;
  assert(s != null, 'CR3.4a — solver diagnostics surfaced');
  if (s) {
    assert(s.convergedIn === null || typeof s.convergedIn === 'number',
      `CR3.4b — convergedIn is null | number, never undefined`);
    assert((s.converged === true) === (s.convergedIn !== null),
      `CR3.4c — convergedIn === null IFF converged === false (converged=${s.converged}, convergedIn=${s.convergedIn})`);
  }
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`CR3 SOLVER CONVERGENCE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
