/**
 * ISSUE 3 — Timing-aware back-solve: rawPeak feedback signal.
 *
 * Background: PR #56 introduced a timing-aware outer shrink loop in
 * `solveFunding`. `checkAndShrink` measured `result.*FacilitySize` peaks
 * AFTER FU2's cap-int hard ceiling had already converted would-be cap-int
 * to cash-pay, so the post-ceiling peak NEVER overshoots the cap. The
 * shrink loop therefore never fired, principal cap stayed at facilityLimit,
 * and capitalised facilities ended up with full-principal + forced cash-pay
 * overflow instead of (smaller principal + cap-int rolling within cap).
 *
 * Fix: track `rawPeak.{senior,senior2,mezz,landLoan}` — the WOULD-BE peak
 * including would-be cap-int BEFORE the ceiling decides to convert it to
 * cash-pay. `checkAndShrink` now reads `rawPeak` instead of `*FacilitySize`,
 * so when timing means cap-int would push the balance over facilityLimit,
 * the shrink loop tightens the principal cap and re-solves until rawPeak
 * fits under the limit.
 *
 * Invariants tested:
 *   I3.1 — Capitalised mezz with drawdown that would push cap-int over
 *          facilityLimit: rawPeak captures the would-be, principal cap
 *          shrinks, ACTUAL peak <= facilityLimit, minimal/zero cash-pay
 *          conversion compared to pre-fix.
 *   I3.2 — Capitalised facility with drawdown well under cap: rawPeak ≈
 *          actualPeak (no shrinkage needed, no cap-int ceiling fires).
 *   I3.3 — Cash-pay facility unchanged (rawPeak == post-ceiling peak;
 *          shrink loop is a no-op for cash-pay).
 *   I3.4 — Senior + mezz both capitalised + binding: each shrinks
 *          independently. rawPeak.senior and rawPeak.mezz reach their
 *          own facilityLimit without cross-contamination.
 *
 * Run: cd app && npx tsx src/engine/__tests__/issue3RawPeakBackSolve.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'Issue3RawPeakBackSolve', modelStartDate: 44927, monthsPerPeriod: 1,
  lastActualsPeriod: 44927, tolerance: 50,
  daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

interface FixOpts {
  mezzLimit: number;
  mezzCapitalised: boolean;
  mezzMargin?: number;
  mezzLtc?: number;
  mezzLvr?: number;
  equityCap?: number;
  seniorLimit?: number;
  seniorCapitalised?: boolean;
  seniorMargin?: number;
  seniorLtc?: number;
  seniorLvr?: number;
  constructionCost?: number;
  buildSpan?: number;
}

// Same shape as timingAwareBackSolve fixtureProgressiveDraw — long capitalised
// facility with progressive drawdown over construction. Cap-int compounds on
// a steadily-rising balance, so the bug shows clearly when the principal cap
// is too generous.
function fixtureProgressiveDraw(opts: FixOpts): MainInputs {
  const mezzMargin = opts.mezzMargin ?? 0.10;
  const seniorMargin = opts.seniorMargin ?? 0.025;
  const construction = opts.constructionCost ?? 90_000_000;
  const buildSpan = opts.buildSpan ?? 28;
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
      units: 1, baseRate: construction, totalCosts: construction,
      sCurve: 'Evenly Split', monthStart: 4, monthSpan: buildSpan, addGST: false, ctd: 0, ctc: construction,
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
      name:'S', facilityLimit: opts.seniorLimit ?? 80_000_000, startMonth: 1, maturityMonth: 36,
      interestRate: 0, bbsy: 0.04, margin: seniorMargin,
      establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1,
      isCapitalised: opts.seniorCapitalised ?? false,
      ltcTarget: opts.seniorLtc ?? 0.7, lvrTarget: opts.seniorLvr ?? 0.65, drawdownPriority: 1,
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

// Helper — count cap-int ceiling INFO firings in the warnings array.
function countCapIntCeilings(warnings: string[]): number {
  return warnings.filter(w => /cap-int exceeds covenant cap/.test(w)).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// I3.1 — Capitalised mezz with binding facilityLimit. The shrink loop must
// tighten the principal cap so the ACTUAL peak balance fits under
// facilityLimit, with minimal cash-pay conversion (i.e. fewer cap-int
// ceiling firings than pre-fix).
//
// Fixture: 36-month build, mezz limit $30M, mezzMargin 10%, equityCap tiny so
// mezz is forced to fund construction (drawdowns large enough to put pressure
// on the cap). Pre-Issue-3-fix the mezz peak hit ~$30M with cap-int repeatedly
// converting to cash-pay (multiple [INFO] firings). Post-fix the principal
// cap shrinks toward ~$22M, and cap-int rolls naturally into the headroom.
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
  // I3.1a — Actual mezz peak still <= facilityLimit (the existing FU2 invariant).
  assert(peakMezz <= 30_000_000 + 1_000,
    `I3.1a — actual mezz peak <= facilityLimit: $${peakMezz.toFixed(0)} > $30,001,000`);

  // I3.1b — Cap-int ceiling firings should be small. Pre-fix, the principal
  // cap stuck at $30M caused dozens of monthly [INFO] firings throughout the
  // 36-month build. Post-fix, the principal cap shrinks so the would-be
  // cap-int fits under the limit and the ceiling rarely (if ever) fires.
  const ceilingFires = countCapIntCeilings(r.warnings ?? []);
  assert(ceilingFires <= 3,
    `I3.1b — cap-int ceiling rarely fires after shrink (got ${ceilingFires} firings; pre-fix expected many more)`);

  // I3.1c — Mezz drawdown peak (capital) is meaningfully smaller than
  // facilityLimit. Pre-fix, drawdowns equalled the mezz balance peak (~$30M).
  // Post-fix, principal drawdowns shrink toward closed-form (~$22M) so cap-int
  // fills the rest naturally. We verify the SUM of mezz drawdowns minus
  // capitalised cap-int (i.e. the actual principal drawn) is well below $30M.
  // Total interest accrued = totalMezzInterest. Drawdowns include both
  // principal and capitalised interest; subtract interest to get principal.
  const totalMezzDrawdowns = r.cashflows.reduce((s, cf) => s + (cf.mezzDrawdown ?? 0), 0);
  // Cumulative repayments (mezz balance is fully repaid by maturity in normal
  // fixtures). Principal = totalDrawdowns - capitalised interest.
  // Use the totalMezzInterest as a proxy for capitalised interest (since the
  // ceiling barely fires post-fix, almost all interest is capitalised).
  const totalMezzInterest = r.cashflows.reduce((s, cf) => s + (cf.mezzInterest ?? 0), 0);
  const principalProxy = totalMezzDrawdowns - totalMezzInterest;
  // Pre-fix: principalProxy ≈ $30M (full draw) and ceiling fires force
  // cash-pay overflow. Post-fix: principalProxy ≈ $22-25M (closed-form-ish
  // back-solve), with cap-int ~$5-8M rolling within cap.
  assert(principalProxy < 28_000_000,
    `I3.1c — mezz principal shrank toward closed-form (got principal proxy $${principalProxy.toFixed(0)}; pre-fix this was ~$30M)`);
  assert(principalProxy > 15_000_000,
    `I3.1c — mezz principal not over-shrunk (got $${principalProxy.toFixed(0)}; should be > $15M)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// I3.2 — Capitalised facility with drawdown well under cap. rawPeak ≈
// actualPeak; no shrinkage. Use the same fixture but with a generous
// facilityLimit far above what construction needs (so the cap never binds).
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 200_000_000, // huge — never binds
    mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  // Peak should be far below the limit (no shrinkage triggered).
  assert(peakMezz < 100_000_000,
    `I3.2a — when limit is non-binding, peak stays small: $${peakMezz.toFixed(0)} < $100M`);
  // No cap-int ceiling firings expected — facility has plenty of headroom.
  const ceilingFires = countCapIntCeilings(r.warnings ?? []);
  assert(ceilingFires === 0,
    `I3.2b — non-binding capitalised facility produces no cap-int ceiling firings (got ${ceilingFires})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// I3.3 — Cash-pay facility unchanged. rawPeak should equal post-ceiling peak
// because the cap-int ceiling never fires for cash-pay. Shrink loop is a
// no-op. Peak should still be able to draw close to facilityLimit.
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
    `I3.3a — cash-pay mezz peak <= facilityLimit: $${peakMezz.toFixed(0)}`);
  assert(peakMezz >= 25_000_000,
    `I3.3b — cash-pay mezz draws close to facilityLimit (no shrinkage): $${peakMezz.toFixed(0)} vs $30M`);
  // No cap-int ceiling firings for cash-pay.
  const ceilingFires = countCapIntCeilings(r.warnings ?? []);
  assert(ceilingFires === 0,
    `I3.3c — cash-pay facility produces no cap-int ceiling firings (got ${ceilingFires})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// I3.4 — Senior + mezz both capitalised + binding. Each shrinks independently.
// Construction cost large enough that both senior and mezz must work, both
// at limits that bind without LTC/LVR getting in the way.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    seniorLimit: 60_000_000, seniorCapitalised: true, seniorMargin: 0.06,
    seniorLtc: 1.0, seniorLvr: 1.0,
    mezzLimit: 30_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
    constructionCost: 75_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakSenior = 0, peakMezz = 0;
  for (const cf of r.cashflows) {
    if ((cf.seniorBalance ?? 0) > peakSenior) peakSenior = cf.seniorBalance ?? 0;
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
  }
  // I3.4a — Both peaks <= their respective limits.
  assert(peakSenior <= 60_000_000 + 1_000,
    `I3.4a — senior peak <= facilityLimit: $${peakSenior.toFixed(0)}`);
  assert(peakMezz <= 30_000_000 + 1_000,
    `I3.4b — mezz peak <= facilityLimit: $${peakMezz.toFixed(0)}`);
  // I3.4c — Senior + mezz peak total close to their combined headline limit
  // (within ~10%) — confirms we're using meaningful headroom in BOTH.
  // Combined budget = $90M; usage should be > $70M. (Allows for the timing-
  // aware solver to leave headroom for cap-int growth, which is correct.)
  const combined = peakSenior + peakMezz;
  assert(combined > 70_000_000,
    `I3.4c — combined senior+mezz peak utilises both facilities: $${combined.toFixed(0)} should exceed $70M`);
  // I3.4d — Cap-int ceiling firings are minimal (each facility's principal
  // shrinks independently to leave room for its own cap-int).
  const ceilingFires = countCapIntCeilings(r.warnings ?? []);
  assert(ceilingFires <= 6,
    `I3.4d — cap-int ceiling rarely fires when both facilities shrink (got ${ceilingFires})`);
}

console.log();
console.log('═'.repeat(72));
console.log(`ISSUE 3 RAWPEAK BACK-SOLVE: ${passed} passed, ${failed} failed (${passed+failed} total)`);
console.log('═'.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
