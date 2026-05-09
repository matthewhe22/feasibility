/**
 * Bug B — Equity-cap overshoot warning.
 *
 * The user enters `equityDeveloper.equityCap` on the Financing tab as a
 * term-sheet equity commitment. Two engine mechanisms can push
 * `cumulativeEquityDeveloperDrawn` above that cap silently:
 *   1. minEquityRequirement floor enforcement
 *   2. equity-of-last-resort backstop (when senior+mezz can't fund a gap)
 *
 * Pre-fix: the cap was breached without any warning, leaving financiers
 * unaware. Post-fix: the engine emits a [FUNDING] / [INFO] warning + populates
 * `result.equityCapCheck` telemetry consumed by the Checks tab.
 *
 * Severity ladder (verified by these tests):
 *   • drawn ≤ cap (within $1)         → severity='pass', no warning
 *   • drawn ≤ cap × 1.05              → severity='info'
 *   • cap × 1.05 < drawn ≤ cap × 1.20 → severity='warn'
 *   • drawn > cap × 1.20 OR > cap×1.5 → severity='fail'
 *   • cap === 0 (uncapped)            → severity='pass', no warning
 *
 * Same logic applies to `equityJV.equityCap` when the JV is active.
 */
import { runCalculations } from '../index';
import { getFundingWarnings, clearFundingWarnings } from '../funding';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'EqCap-fix', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

/**
 * Fixture: tightly-funded project where the engine MUST back-solve equity
 * past any cap via the equity-of-last-resort backstop.
 *
 * Senior runs at drawdown priority 1 with a $5M limit (vs ~$15M TDC). When
 * senior exhausts mid-build, dev (priority 2) is asked to fund — clamped to
 * cap. After dev hits its cap the equity-of-last-resort backstop fires
 * unconditionally each negative-bank-balance period, pushing cumulativeEquity
 * past the cap. By varying `equityCap` we land each severity tier
 * deterministically.
 */
function fixture(opts: {
  equityCap: number;
  jvEquityCap?: number;
  jvActive?: boolean;
  seniorLimit?: number;
}): MainInputs {
  const { equityCap, jvEquityCap = 0, jvActive = false, seniorLimit = 5_000_000 } = opts;
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24,
      equityDistStartMonth: 22, equityDistSpanMonths: 3 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.10, gstApplicableLand: false, addGSTOnLandPrice: false,
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
      currentSalePrice: 18_000_000, gstIncluded: true,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    // Developer at drawdown priority 2 — senior draws FIRST, exhausts, then
    // dev fills (clamped to cap), and the equity-of-last-resort backstop
    // fires for any remaining gap. Without this priority ordering the dev
    // priority-1 fixture used by the minEquityFixes tests doesn't exercise
    // the backstop path because dev draws first and naturally clamps to cap.
    equityDeveloper: { name: 'D', equityCap, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: equityCap, profitShare: 1, drawdownPriority: 2 },
    equityJV: { name: jvActive ? 'JV' : '', equityCap: jvEquityCap, percentage: jvActive ? 0.3 : 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: jvActive ? jvEquityCap : 0, profitShare: 0, drawdownPriority: 3 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: seniorLimit, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: 0.85, lvrTarget: 0.85, drawdownPriority: 1 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
  };
}

function hasEqCapAnyWarning(): boolean {
  return getFundingWarnings().some(w => w.includes('exceeds user-set equity cap'));
}
function hasEqCapInfoWarning(): boolean {
  return getFundingWarnings().some(w => w.startsWith('[INFO]') && w.includes('exceeds user-set equity cap'));
}
function hasEqCapWarnWarning(): boolean {
  return getFundingWarnings().some(w => w.startsWith('[FUNDING]') && !w.includes('FAIL') && w.includes('exceeds user-set equity cap'));
}
function hasEqCapFailWarning(): boolean {
  return getFundingWarnings().some(w => w.startsWith('[FUNDING] FAIL') && w.includes('exceeds user-set equity cap'));
}

// Probe natural draw with cap=0 (uncapped). All scenarios then position
// `equityCap` against this anchor to land each severity tier deterministically.
clearFundingWarnings();
const probe = runCalculations(baseAdmin, fixture({ equityCap: 0 }));
const naturalDraw = probe.equityCapCheck.developer.drawn;
// Sanity: the fixture is engineered to force ~$10M of equity draws via the
// equity-of-last-resort backstop. If naturalDraw is much smaller the test
// fixture is broken (senior is over-funding the gap on its own).
assert(naturalDraw > 5_000_000,
  `setup — naturalDraw must be substantial (>$5M) so the cap-overshoot scenarios bite (got ${Math.round(naturalDraw)})`);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: drawn ≤ cap → severity='pass', no warning
// (Cap with $100k headroom over natural draw → no overshoot.)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cap = naturalDraw + 100_000;
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({ equityCap: cap }));
  assert(r.equityCapCheck !== undefined, 'T1 — telemetry populated on every solve');
  assert(r.equityCapCheck.developer.severity === 'pass',
    `T1 — drawn ≤ cap → severity='pass' (got ${r.equityCapCheck.developer.severity}, drawn=${Math.round(r.equityCapCheck.developer.drawn)}, cap=${Math.round(cap)})`);
  assert(r.equityCapCheck.developer.overshoot === 0, `T1 — overshoot = 0 (got ${r.equityCapCheck.developer.overshoot})`);
  assert(!hasEqCapAnyWarning(), 'T1 — no warning fires when drawn ≤ cap');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: drawn ~3% over cap → INFO only, no [FUNDING] WARN/FAIL
// ─────────────────────────────────────────────────────────────────────────────
{
  // Cap at 97.1% of natural draw → ~3% overshoot.
  const cap = naturalDraw / 1.03;
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({ equityCap: cap }));
  assert(r.equityCapCheck.developer.severity === 'info',
    `T2 — 3% over cap → severity='info' (got ${r.equityCapCheck.developer.severity}, drawn=${Math.round(r.equityCapCheck.developer.drawn)}, cap=${Math.round(cap)}, pct=${(r.equityCapCheck.developer.overshootPct*100).toFixed(1)}%)`);
  assert(r.equityCapCheck.developer.overshoot > 0, 'T2 — overshoot > 0');
  assert(hasEqCapInfoWarning(), 'T2 — [INFO] warning fires');
  assert(!hasEqCapWarnWarning(), 'T2 — no [FUNDING] (WARN-tier) warning fires for INFO-tier overshoot');
  assert(!hasEqCapFailWarning(), 'T2 — no [FUNDING] FAIL warning fires for INFO-tier overshoot');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: drawn ~8% over cap → WARN
// ─────────────────────────────────────────────────────────────────────────────
{
  const cap = naturalDraw / 1.08;
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({ equityCap: cap }));
  assert(r.equityCapCheck.developer.severity === 'warn',
    `T3 — 8% over cap → severity='warn' (got ${r.equityCapCheck.developer.severity}, pct=${(r.equityCapCheck.developer.overshootPct*100).toFixed(1)}%)`);
  assert(hasEqCapWarnWarning(), 'T3 — [FUNDING] WARN-tier warning fires');
  assert(!hasEqCapFailWarning(), 'T3 — not FAIL severity for 8% overshoot');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: drawn ~50% over cap → FAIL (50% > 20% threshold)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cap = naturalDraw / 1.5;
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({ equityCap: cap }));
  assert(r.equityCapCheck.developer.severity === 'fail',
    `T4 — 50% over cap → severity='fail' (got ${r.equityCapCheck.developer.severity}, pct=${(r.equityCapCheck.developer.overshootPct*100).toFixed(1)}%)`);
  assert(hasEqCapFailWarning(), 'T4 — [FUNDING] FAIL warning fires');
  // The warning text should mention specific dollar amounts so financiers
  // can see at a glance.
  const failMsg = getFundingWarnings().find(w => w.includes('[FUNDING] FAIL') && w.includes('exceeds user-set equity cap'));
  assert(failMsg !== undefined, 'T4 — FAIL message present');
  if (failMsg) {
    assert(failMsg.includes('Developer equity drawn'), 'T4 — message mentions Developer equity drawn');
    assert(failMsg.includes('user-set equity cap'), 'T4 — message mentions user-set equity cap');
    assert(failMsg.includes('funding gap'), 'T4 — message mentions funding gap');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: equityCap = 0 (uncapped) → no warning regardless of drawn amount
// (`equityCap = 0` is the legacy default for v7 fixtures and the common
// "equity is gap-fill, no fixed cap" scenario.)
// ─────────────────────────────────────────────────────────────────────────────
{
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({ equityCap: 0 }));
  assert(r.equityCapCheck.developer.severity === 'pass',
    `T5 — equityCap=0 → severity='pass' regardless of drawn (got ${r.equityCapCheck.developer.severity})`);
  assert(r.equityCapCheck.developer.cap === 0, 'T5 — cap=0 reported on telemetry');
  assert(r.equityCapCheck.developer.drawn > 0, 'T5 — drawn still populated for diagnostics');
  assert(!hasEqCapAnyWarning(), 'T5 — no warning fires when uncapped');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: equityJV cap also enforced when set
// ─────────────────────────────────────────────────────────────────────────────
{
  // Developer cap is generous so dev passes; JV cap is tiny so JV trips
  // (when the JV draws). Even when the engine routes most equity to the
  // backstop on Developer (which is always the equity-of-last-resort), JV
  // can still get partial draws via the priority mechanism — the test
  // asserts the telemetry/cap relationship holds whether or not JV draws.
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({
    equityCap: naturalDraw * 10,           // way above natural — Developer passes
    jvActive: true,
    jvEquityCap: 1_000,                    // tiny — JV trips if it draws
  }));
  assert(r.equityCapCheck.jv !== undefined, 'T6 — JV telemetry populated');
  assert(r.equityCapCheck.jv.cap === 1_000, `T6 — JV cap = 1000 reflected in telemetry (got ${r.equityCapCheck.jv.cap})`);
  // If JV happens to draw past 1000, a JV warning should fire AND severity
  // should NOT be pass.
  if (r.equityCapCheck.jv.drawn > 1001) {
    assert(r.equityCapCheck.jv.severity !== 'pass',
      `T6 — JV draw ${Math.round(r.equityCapCheck.jv.drawn)} > cap 1000 → severity ≠ 'pass' (got ${r.equityCapCheck.jv.severity})`);
    assert(getFundingWarnings().some(w => w.includes('JV equity drawn')),
      'T6 — [FUNDING] warning mentions "JV equity drawn"');
  }
  // Developer must still pass (cap is naturalDraw × 10).
  assert(r.equityCapCheck.developer.severity === 'pass',
    `T6 — Developer with generous cap still passes (got ${r.equityCapCheck.developer.severity})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: Telemetry numbers match the warning text byte-for-byte.
// (Mirrors the minEquityCheck cross-check pattern — Checks tab consumers
// MUST read these via `data.equityCapCheck` and not recompute.)
// ─────────────────────────────────────────────────────────────────────────────
{
  const cap = naturalDraw / 1.5;  // 50% overshoot, FAIL tier
  clearFundingWarnings();
  const r = runCalculations(baseAdmin, fixture({ equityCap: cap }));
  const ec = r.equityCapCheck.developer;
  const warn = getFundingWarnings().find(w => w.includes('[FUNDING] FAIL') && w.includes('Developer equity drawn'));
  assert(warn !== undefined, 'T7 — FAIL warning string present');
  if (warn) {
    const expectedDrawn = `$${Math.round(ec.drawn).toLocaleString()}`;
    const expectedCap = `$${Math.round(ec.cap).toLocaleString()}`;
    const expectedOvershoot = `$${Math.round(ec.overshoot).toLocaleString()}`;
    assert(warn.includes(expectedDrawn), `T7 — warning includes drawn ${expectedDrawn}`);
    assert(warn.includes(expectedCap), `T7 — warning includes cap ${expectedCap}`);
    assert(warn.includes(expectedOvershoot), `T7 — warning includes overshoot ${expectedOvershoot}`);
  }
}

console.log(`\nequity-cap overshoot fixes: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log('  FAIL:', f);
  process.exit(1);
}
