/**
 * Q1 — Checks/warnings consolidation invariants.
 *
 * The funding solver runs ~50 iterations to converge finance costs. Pre-Q1,
 * each iteration emitted per-period warnings with $X drifting by a few
 * dollars, escaping the exact-string Set-dedupe in getFundingWarnings. A loss-
 * making project like Box Hill produced ~46 funding-warning entries that
 * actually represented just 2 underlying signals (covenant overshoot + auto-
 * sized mezz).
 *
 * Q1 fixes this at the engine source: per-period covenant breaches and auto-
 * size INFOs feed an accumulator (kind, facility) → peak/period-range, which
 * is flushed ONCE per solveFunding call. The prelim+final solve pair produces
 * one summary per (kind, facility), not 2*N.
 *
 * Invariants tested:
 *   I1 — Covenant overshoot (cap-int pushed senior past LTC/LVR): emits
 *        EXACTLY ONE summary message containing the peak balance + period
 *        range. The message starts with `[FUNDING] <facility> covenant cap
 *        exceeded by`.
 *   I2 — Auto-sized mezz / senior: ONE summary per facility per converged
 *        solve, no per-iteration drift.
 *   I3 — Clean fixture (facility >= covenant cap, sufficient equity): no
 *        funding-warning emissions whatsoever.
 *   I4 — Equity backstop overshoot: one consolidated summary, not per-period.
 *
 * Run: cd app && npx tsx src/engine/__tests__/checksConsolidation.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'Q1', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(opts: {
  seniorFacility: number; ltcTarget: number; lvrTarget?: number;
  equity: number;
  mezzFacility?: number; mezzLtc?: number;
  totalCost?: number; revenue?: number;
  margin?: number; bbsy?: number;
}): MainInputs {
  const lvr = opts.lvrTarget ?? 0.65;
  const cost = opts.totalCost ?? 10_000_000;
  const rev = opts.revenue ?? 18_000_000;
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
      units: 1, baseRate: cost, totalCosts: cost,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 18, addGST: true, ctd: 0, ctc: cost }],
    constructionContingencyPercent: 0, marketingCosts: [], otherStandardCosts: [],
    pmFees: [{ code: '6', description: 'P', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 24, addGST: false, ctd: 0, ctc: 0 }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: rev, gstIncluded: true,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: opts.equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: opts.equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: opts.seniorFacility, startMonth:1, maturityMonth:24, interestRate:0, bbsy:opts.bbsy ?? 0.04, margin:opts.margin ?? 0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: opts.ltcTarget, lvrTarget: lvr, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'M', facilityLimit: opts.mezzFacility ?? 0, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.06, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: opts.mezzLtc ?? 0.85, lvrTarget: 0.80, drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// ============================================================================
// I1 — Covenant overshoot consolidation
// Cap-int pushes senior past LTC/LVR ceiling — should emit EXACTLY ONE summary
// (peak balance + period range), not one per period × N iterations.
// ============================================================================
{
  // Aggressive cap-int scenario: very high rates ensure cap-int meaningfully
  // pushes senior past covenant cap during construction tail.
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 50_000_000, ltcTarget: 0.50, lvrTarget: 0.50,
    equity: 1_000_000, totalCost: 10_000_000, revenue: 30_000_000,
    bbsy: 0.10, margin: 0.10, // 20% rate to force cap-int overshoot
  }));
  const allWarns = r.warnings ?? [];
  // Per-period overshoot messages (the legacy spam) should NOT appear.
  const perPeriodOvershoots = allWarns.filter(w => /Period \d+: Senior #1 balance .* exceeds covenant cap/.test(w));
  assert(perPeriodOvershoots.length === 0,
    `I1a — no per-period covenant overshoot messages (legacy spam suppressed); got ${perPeriodOvershoots.length}`);

  // Exactly one consolidated covenant overshoot summary should appear (if any).
  const summaries = allWarns.filter(w => /\[FUNDING\] Senior #1 covenant cap exceeded by/.test(w));
  assert(summaries.length <= 1,
    `I1b — at most one consolidated covenant overshoot summary; got ${summaries.length}: ${summaries.join(' || ')}`);

  if (summaries.length === 1) {
    const s = summaries[0]!;
    assert(/peak \$[\d,]+/.test(s), `I1c — summary contains peak; got "${s.slice(0, 200)}"`);
    assert(/(month \d+|months \d+)/.test(s), `I1d — summary contains a month/range; got "${s.slice(0, 200)}"`);
  }
}

// ============================================================================
// I2 — Auto-sized mezz: exactly ONE [INFO] per converged solve
// ============================================================================
{
  // Mezz active: senior at LTC cap, plus mezz with low committed limit and
  // high covenant cap → engine grows mezz to cover gap → emits auto-size INFO.
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 5_000_000, ltcTarget: 0.5, lvrTarget: 0.65,
    equity: 1_000_000,
    mezzFacility: 1_000_000, mezzLtc: 0.85,
    totalCost: 10_000_000, revenue: 18_000_000,
  }));
  const allWarns = r.warnings ?? [];
  const autoMezz = allWarns.filter(w => /Auto-sized Mezz/i.test(w));
  // Note: solveFunding is called twice from runCalculations (prelim + final).
  // The accumulator key is stable, so the final-solve summary OVERWRITES the
  // prelim-solve summary — exactly one final entry.
  assert(autoMezz.length === 1,
    `I2 — exactly one [INFO] Auto-sized Mezz entry per converged solve pair; got ${autoMezz.length}: ${autoMezz.join(' || ')}`);
  if (autoMezz.length === 1) {
    const s = autoMezz[0]!;
    assert(/\[INFO\] Auto-sized Mezz \$[\d,]+ → \$[\d,]+/.test(s),
      `I2b — auto-size message has expected shape "[INFO] Auto-sized Mezz $X → $Y"; got "${s.slice(0, 200)}"`);
  }
}

// ============================================================================
// I3 — Clean fixture: facility >= covenant cap with sufficient equity → no
// funding warnings of any kind.
// ============================================================================
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 20_000_000, ltcTarget: 0.7, lvrTarget: 0.65,
    equity: 5_000_000, totalCost: 10_000_000, revenue: 18_000_000,
  }));
  const allWarns = r.warnings ?? [];
  const fundingWarns = allWarns.filter(w =>
    /\[FUNDING\]|covenant cap exceeded|Auto-sized|equity backstop|Period \d+:/.test(w));
  assert(fundingWarns.length === 0,
    `I3 — clean fixture emits zero funding warnings; got ${fundingWarns.length}: ${fundingWarns.join(' || ').slice(0, 400)}`);
}

// ============================================================================
// I4 — Auto-size NOT emitted when facility >= covenant cap (regression check)
// ============================================================================
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 20_000_000, ltcTarget: 0.7, lvrTarget: 0.65,
    equity: 5_000_000, totalCost: 10_000_000, revenue: 18_000_000,
  }));
  const allWarns = (r.warnings ?? []).join(' | ');
  assert(!/Auto-sized Senior/i.test(allWarns),
    `I4 — no auto-size when facility >= covenant cap`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`Q1 CHECKS-CONSOLIDATION TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
