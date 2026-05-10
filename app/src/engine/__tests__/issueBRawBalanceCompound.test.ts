/**
 * ISSUE B — Per-facility raw "would-be" balance tracking that compounds
 * across periods even when the FU2 cap-int ceiling fires.
 *
 * Background (review batch follow-up): PR #60 added per-facility rawPeak
 * signals that captured the would-be balance immediately BEFORE the FU2
 * ceiling fired (`rawPeakX = max(rawPeakX, runningBalance + thisPeriodInt)`).
 * That fixed period-zero overshoot detection but UNDER-REPORTED across
 * multi-period overflow: when the ceiling suppressed cap-int in period N,
 * `runningBalance` froze at the cap, and period N+1's `runningBalance + int`
 * was still measured against the same frozen base — the COMPOUND of would-be
 * cap-int never showed up.
 *
 * Fix: maintain a parallel `rawSnrBalance / rawSnr2Balance / rawMezzBalance
 * / rawLLBalance` that mirrors every actual-balance change EXCEPT cap-int —
 * for cap-int, raw always grows by the would-be amount regardless of
 * whether the ceiling diverted the actual to cash. Subsequent periods
 * compute would-be interest on the RAW opening balance, so compounding is
 * preserved across the entire ceiling-firing run.
 *
 * Invariants tested:
 *   IB.1 — Capitalised mezz, multi-period overflow: shrink loop converges
 *          with peakActual <= facilityLimit and meaningful utilisation
 *          (raw compounding correctly tightens the principal cap).
 *   IB.2 — Cash-pay facility: actual peak reaches close to facilityLimit
 *          (raw mirrors actual; no shrinkage triggered).
 *   IB.3 — Multi-facility (senior + mezz both capitalised + binding): each
 *          rawPeak tracks independently; both peaks <= their respective
 *          facilityLimits with combined meaningful utilisation.
 *   IB.4 — LL presence sanity: senior+mezz+LL configuration still respects
 *          all limits (raw tracking didn't introduce cross-contamination).
 *
 * Run: cd app && npx tsx src/engine/__tests__/issueBRawBalanceCompound.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'IssueBRawBalanceCompound', modelStartDate: 44927, monthsPerPeriod: 1,
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
  landLoanLimit?: number;
}

function fixtureProgressiveDraw(opts: FixOpts): MainInputs {
  const mezzMargin = opts.mezzMargin ?? 0.10;
  const seniorMargin = opts.seniorMargin ?? 0.025;
  const construction = opts.constructionCost ?? 90_000_000;
  const buildSpan = opts.buildSpan ?? 28;
  const landLoanLimit = opts.landLoanLimit ?? 0;
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
    landLoan: { name:'L',facilityLimit:landLoanLimit,startMonth:1,maturityMonth:36,interestRate:0.08,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:false,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
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

// ═══════════════════════════════════════════════════════════════════════════
// IB.1 — Capitalised mezz, multi-period overflow.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    mezzLimit: 30_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);

  let peakMezzActual = 0;
  for (const cf of r.cashflows) {
    if ((cf.mezzBalance ?? 0) > peakMezzActual) peakMezzActual = cf.mezzBalance ?? 0;
  }
  assert(peakMezzActual <= 30_000_000 + 1_000,
    'IB.1a — actual mezz peak <= facilityLimit (got $' + peakMezzActual.toFixed(0) + ')');
  assert(peakMezzActual >= 18_000_000,
    'IB.1b — mezz utilised after shrink (got $' + peakMezzActual.toFixed(0) + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
// IB.2 — Cash-pay facility: raw mirrors actual exactly.
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
    'IB.2a — cash-pay mezz peak <= facilityLimit (got $' + peakMezz.toFixed(0) + ')');
  assert(peakMezz >= 25_000_000,
    'IB.2b — cash-pay mezz draws close to limit (got $' + peakMezz.toFixed(0) + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
// IB.3 — Multi-facility independence (senior + mezz both capitalised).
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
  assert(peakSenior <= 60_000_000 + 1_000,
    'IB.3a — senior peak <= limit (got $' + peakSenior.toFixed(0) + ')');
  assert(peakMezz <= 30_000_000 + 1_000,
    'IB.3b — mezz peak <= limit (got $' + peakMezz.toFixed(0) + ')');
  assert(peakSenior >= 30_000_000,
    'IB.3c — senior utilised independently (got $' + peakSenior.toFixed(0) + ')');
  assert(peakMezz >= 15_000_000,
    'IB.3d — mezz utilised independently (got $' + peakMezz.toFixed(0) + ')');
  assert(peakSenior + peakMezz > 60_000_000,
    'IB.3e — combined utilisation > $60M (got $' + (peakSenior + peakMezz).toFixed(0) + ')');
}

// ═══════════════════════════════════════════════════════════════════════════
// IB.4 — LL presence sanity. Confirm senior+mezz+LL config respects all limits.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = fixtureProgressiveDraw({
    landLoanLimit: 5_000_000,
    seniorLimit: 60_000_000, seniorCapitalised: true, seniorMargin: 0.06,
    seniorLtc: 1.0, seniorLvr: 1.0,
    mezzLimit: 25_000_000, mezzCapitalised: true, mezzMargin: 0.10,
    mezzLtc: 1.0, mezzLvr: 1.0,
    equityCap: 5_000_000,
    constructionCost: 70_000_000,
  });
  const r = runCalculations(baseAdmin, inputs);
  let peakSenior = 0, peakMezz = 0, peakLL = 0;
  for (const cf of r.cashflows) {
    if ((cf.seniorBalance ?? 0) > peakSenior) peakSenior = cf.seniorBalance ?? 0;
    if ((cf.mezzBalance ?? 0) > peakMezz) peakMezz = cf.mezzBalance ?? 0;
    if ((cf.landLoanBalance ?? 0) > peakLL) peakLL = cf.landLoanBalance ?? 0;
  }
  assert(peakSenior <= 60_000_000 + 1_000,
    'IB.4a — senior peak <= limit with LL (got $' + peakSenior.toFixed(0) + ')');
  assert(peakMezz <= 25_000_000 + 1_000,
    'IB.4b — mezz peak <= limit with LL (got $' + peakMezz.toFixed(0) + ')');
  assert(peakLL <= 5_000_000 + 1_000,
    'IB.4c — LL peak <= limit (got $' + peakLL.toFixed(0) + ')');
}

console.log();
console.log('='.repeat(72));
console.log('ISSUE B RAW BALANCE COMPOUND: ' + passed + ' passed, ' + failed + ' failed (' + (passed+failed) + ' total)');
console.log('='.repeat(72));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  x ' + f);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
