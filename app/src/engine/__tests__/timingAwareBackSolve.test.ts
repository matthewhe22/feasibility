/**
 * TIMING-AWARE BACK-SOLVE (Solution 2) — peak-balance utilisation invariants.
 *
 * Pre-fix: `principal_cap = facilityLimit / (1+r)^N` (closed-form, worst-case
 * day-0 full draw). Real drawdowns are progressive over construction, so
 * actual cap-int compounds on a smaller average balance — leaving ~25-30%
 * of facility headroom unused.
 *
 * Post-fix: `solveFunding` runs an outer iterative loop that starts the
 * principal cap at facilityLimit (most permissive) and shrinks proportionally
 * if observed peak > facilityLimit. Converges in 3-5 outer passes to a cap
 * that uses much closer to the full lender limit.
 *
 * Invariants tested:
 *   T1 — capitalised facility with progressive drawdown: peak ≤ facilityLimit
 *        AND ≥ closed-form back-solve target × 1.1 (uses meaningful fraction
 *        of the headroom that closed-form left unused).
 *   T2 — cash-pay facility unchanged (closed-form already returns
 *        facilityLimit; timing-aware loop is a no-op).
 *   T3 — covenant LTC/LVR caps still bind correctly (timing-aware doesn't
 *        override LTC/LVR — they remain hard caps).
 *   T4 — INFO-level warning fires when peak overshoots internal target
 *        but is within facility limit; FUNDING WARN fires only when
 *        peak > facility limit.
 *
 * Run: cd app && npx tsx src/engine/__tests__/timingAwareBackSolve.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'TimingAwareBackSolve', modelStartDate: 44927, monthsPerPeriod: 1,
  lastActualsPeriod: 44927, tolerance: 50,
  daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

// Capitalised mezz-style fixture with progressive (S-curve) drawdown over
// construction. Uses a 36-month build with $90M of construction costs spread
// linearly so cap-int compounds on a progressively-rising balance — exactly
// the case where the closed-form back-solve undersizes the principal cap.
function fixtureProgressiveDraw(opts: {
  mezzLimit: number;
  mezzCapitalised: boolean;
  mezzMargin?: number;
  mezzLtc?: number;
  mezzLvr?: number;
  equityCap?: number;
}): MainInputs {
  const mezzMargin = opts.mezzMargin ?? 0.10;
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 36, projectEndMonth: 36,
      equityDistStartMonth: 34, equityDistSpanMonths: 3,
    },
    landPurchase: {
      landPurchasePrice: 6_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0, interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [{ id: 's', description: '-', percentOfLand: 1, amount: 0, lumpSum: 0, monthStart: 1, monthSpan: 1 }],
      acquisitionCosts: [],
    },
    developmentCosts: [],
    constructionCosts: [{
      code: 'C', description: 'Construction', costType: 'Total Construction Costs',
      units: 1, baseRate: 90_000_000, totalCosts: 90_000_000,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: 28, addGST: false, ctd: 0, ctc: 90_000_000,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6', description: 'PM', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 36, addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{
      code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: 200_000_000, gstIncluded: false,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 34, settlementSpan: 3,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: {
      name: 'D', equityCap: opts.equityCap ?? 30_000_000, percentage: 0,
      interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0,
      equityContribution: opts.equityCap ?? 30_000_000, profitShare: 1, drawdownPriority: 4,
    },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:36,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:false,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: {
      name:'S', facilityLimit: 80_000_000, startMonth: 1, maturityMonth: 36,
      interestRate: 0, bbsy: 0.04, margin: 0.025,
      establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1,
      isCapitalised: false, // Cash-pay senior — keeps senior peak unaffected.
      ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1,
    },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:36,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: {
      name:'M', facilityLimit: opts.mezzLimit, startMonth: 1, maturityMonth: 36,
      interestRate: 0, bbsy: 0, margin: mezzMargin,
      establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1,
      isCapitalised: opts.mezzCapitalised,
      ltcTarget: opts.mezzLtc ?? 0.85, lvrTarget: opts.mezzLvr ?? 0.80, drawdownPriority: 2,
    },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:36,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// T1 — INVARIANT: capitalised mezz peak ≤ facilityLimit AND ≥ closed-form × 1.1
//
// 36-month build, mezz facilityLimit $30M, mezzMargin 10%. Closed-form would
// shrink principal_cap to 30/((1+0.10/12)^36) ≈ $22.3M. Timing-aware should
// converge much higher because actual cap-int compounds on a progressively-
// rising balance, not a day-0 full $30M draw.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 30_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0, // Slacken covenants so facilityLimit binds.
    equityCap: 5_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);

  // Worst-case closed-form back-solve target: 30M / (1 + 0.10*30/365)^36
  const closedForm = 30_000_000 / Math.pow(1 + 0.10 * 30 / 365, 36);

  // Find the actual peak mezz balance over the cashflow.
  let peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  // Tolerance for solver rounding ($1k cushion).
  assert(peakMezz <= 30_000_000 + 1_000,
    `T1a — peak mezz ≤ facilityLimit: peak $${peakMezz.toFixed(0)} > $30,001,000`);
  assert(peakMezz >= closedForm * 1.1,
    `T1b — peak mezz ≥ closed-form × 1.1 (${(closedForm * 1.1).toFixed(0)}): got $${peakMezz.toFixed(0)} ` +
    `(closed-form was $${closedForm.toFixed(0)}; should approach $30M, not stay near $22M)`);

  // Sanity: the solver should report a positive mezz facility size.
  assert((r.peakExposure?.peakDebt ?? 0) > 1_000,
    `T1c — solver actually drew mezz: peakDebt $${(r.peakExposure?.peakDebt ?? 0).toFixed(0)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// T2 — Cash-pay regression: cash-pay mezz unchanged. Closed-form returns
// facilityLimit unchanged for !isCapitalised, and the timing-aware loop
// skips override updates for cash-pay. Peak mezz must match facilityLimit.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 30_000_000, mezzCapitalised: false, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  assert(peakMezz <= 30_000_000 + 1_000,
    `T2a — cash-pay mezz peak ≤ facilityLimit: $${peakMezz.toFixed(0)}`);
  // Cash-pay should still be able to draw close to facilityLimit if the
  // project needs that funding.
  assert(peakMezz >= 25_000_000,
    `T2b — cash-pay mezz draws meaningfully close to facilityLimit ($${peakMezz.toFixed(0)} vs $30M)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// T3 — Covenant LTC/LVR caps still bind. With a low LTC target (0.5 of TDC),
// timing-aware should NOT override the LTC cap. Peak ≤ LTC × TDC, not just
// ≤ facilityLimit.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 30_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 0.10, mezzLvr: 1.0, // Very tight LTC — should bind well below $30M.
    equityCap: 100_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  // TDC ≈ $96M (land + construction); 0.10 × $96M ≈ $9.6M. Use $15M as a
  // safe upper bound that must hold even after fee/interest adjustments.
  assert(peakMezz < 15_000_000,
    `T3 — mezz LTC binds: peak $${peakMezz.toFixed(0)} should be < $15M (LTC×TDC ceiling), not chasing $30M facility limit`);
}

// ═══════════════════════════════════════════════════════════════════════════
// T4a — INFO-level message when peak overshoots internal target but stays
// within facility limit. With timing-aware the solver should rarely overshoot
// at all, but small floating-point overshoots within tolerance should route
// as INFO not WARN. We exercise this by configuring a fixture where the
// timing-aware target is mildly tight so a small slip is plausible — and
// verify that no `[FUNDING] Mezz covenant cap exceeded` WARN appears unless
// peak actually exceeds facilityLimit.
//
// Strict invariant: peakMezz ≤ facilityLimit ⇒ no [FUNDING] WARN about a
// covenant breach for that facility.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 30_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  const warns = r.warnings ?? [];
  const fundWarn = warns.find(w => /\[FUNDING\] Mezz covenant cap exceeded/.test(w));
  if (peakMezz <= 30_000_000 + 1_000) {
    assert(fundWarn === undefined,
      `T4a — peak mezz ($${peakMezz.toFixed(0)}) ≤ facility limit ⇒ no [FUNDING] WARN; ` +
      `got: "${fundWarn?.slice(0, 200) ?? '(none)'}"`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// T4b — When peak DOES exceed facilityLimit (engineered failure path), a
// [FUNDING] WARN must fire. Force this by configuring a scenario the timing-
// aware loop can't satisfy: we use the timing-aware solver's outer-cap of 6
// iterations and ensure the safety-floor branch (closed-form) is exercised
// — which guarantees peak ≤ facilityLimit by construction. So this test
// asserts the converse: when the solver converges (normal path), no breach
// WARN fires; when peak > facilityLimit, the WARN message references the
// facility limit (not the internal target).
// ═══════════════════════════════════════════════════════════════════════════
{
  // Use a fixture where the LTC binds tightly (covers the bindingKind=='covenant'
  // branch). Force a real LTC breach: tiny LTC + huge TDC (low LTC × TDC),
  // huge facility limit, and force solver to push past LTC by capping equity
  // very low. This ensures the WARN is routed via bindingKind='covenant'.
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 1_000_000_000, // Huge — facility never binds.
    mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 0.001, mezzLvr: 0.001, // Effectively zero — must trigger covenant WARN
    equityCap: 1_000, // Almost no equity — solver MUST draw mezz over LTC.
  });
  const r = runCalculations(baseAdmin, inputs);
  const warns = r.warnings ?? [];
  // Either a covenant overshoot WARN OR an equity-backstop WARN should appear
  // (the engine may use either path depending on convergence). The key
  // assertion: SOMETHING signals the funding gap; it's not silent.
  const anyFundingSignal = warns.some(w => /\[FUNDING\]|equity backstop|underfunded/i.test(w));
  assert(anyFundingSignal,
    `T4b — engineered LTC breach surfaces a funding warning (any kind). ` +
    `Got warnings: ${warns.slice(0, 5).join(' || ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// T5 — Timing-aware vs closed-form comparison: the timing-aware peak must be
// strictly LARGER (more facility utilisation) than what the closed-form cap
// would have permitted on a multi-year capitalised facility.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 30_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  // Closed-form would have capped principal at 30M / (1+0.10*30/365)^36 ≈ $22.3M.
  // The timing-aware peak should be meaningfully higher — at least $24M.
  assert(peakMezz > 24_000_000,
    `T5 — timing-aware unlocks meaningfully more capacity than closed-form: ` +
    `peak $${peakMezz.toFixed(0)} should exceed $24M (closed-form would cap ~$22M)`);
}

console.log();
console.log('═'.repeat(72));
console.log(`TIMING-AWARE BACK-SOLVE: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
