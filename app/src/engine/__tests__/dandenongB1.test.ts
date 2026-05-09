/**
 * Dandenong B1 — Internal Dashboard Table 12 LTC Met? labelling.
 *
 * Symptom: Table 12 said "LTC Met? = No" because it compared total senior+mezz
 * combined LTC (peak debt / total cost) against the senior facility's 75%
 * target. On Dandenong, peakDebt/totalCost was ~85% which exceeded the senior
 * 75% target — but the SENIOR balance individually was well below the senior
 * target, and the MEZZ balance individually was within the mezz target.
 * The Checks tab does it correctly per-facility; Table 12 didn't.
 *
 * Fix: developmentCovenants.ltc is now SENIOR LTC (peakSenior / totalCost),
 * compared against the senior ltcTarget. Mezz gets its own LTC + target +
 * meets flag (when mezz is in the stack).
 *
 * Run: cd app && npx tsx src/engine/__tests__/dandenongB1.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs, FacilityType } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++; else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'Dandenong B1', modelStartDate: 44927, monthsPerPeriod: 1,
  lastActualsPeriod: 44927, tolerance: 10, daysPerYear: 365, monthsPerYear: 12,
  currency: '$', sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []],
  buildSCurves: {}, contingencyGSTMode: 'none',
};

function makeDandenongShape(opts: { seniorLimit: number; mezzLimit: number; build: number; grv: number; equity: number; }) {
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 12, projectEndMonth: 12,
      equityDistStartMonth: 1, equityDistSpanMonths: 1,
    },
    landPurchase: { landPurchasePrice: 0, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
      paymentStages: [], acquisitionCosts: [],
    },
    developmentCosts: [],
    constructionCosts: [{
      code: 'C1', description: 'Build', costType: 'Total Construction Costs',
      units: 1, baseRate: opts.build, totalCosts: opts.build,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
      addGST: false, ctd: 0, ctc: opts.build,
    }],
    constructionContingencyPercent: 0,
    marketingCosts: [], otherStandardCosts: [],
    pmFees: [{
      code: '6001', description: 'PM', costType: 'Development & Project Management Fees',
      units: 1, baseRate: 0, totalCosts: 0, feeRatePercent: 0,
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
      addGST: false, ctd: 0, ctc: 0,
    }],
    sellingCosts: [{ code: 'S1', description: 'Apt', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{
      code: 'G1', description: 'Apt', revenueType: 'Apartments',
      units: 1, totalArea: 100,
      currentSalePrice: opts.grv,
      gstIncluded: false,
      preSaleExchangeMonth: 12, preSaleSpan: 1,
      settlementMonth: 12, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Dev', equityCap: opts.equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: opts.equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: opts.mezzLimit, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.85, lvrTarget: 0.80, drawdownPriority: 3 },
    seniorFacility: {
      name: 'Senior',
      facilityType: 'development' as FacilityType,
      facilityLimit: opts.seniorLimit,
      startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0,
      establishmentFeePercent: 0, lineFeePercent: 0,
      interestPaymentFrequency: 1, isCapitalised: true,
      ltcTarget: 0.75, lvrTarget: 0.65, drawdownPriority: 2,
    },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  } as unknown as MainInputs;
}

// ── 1. Dandenong-shape: senior 70% LTC, mezz 15% LTC, combined 85% — should
//      pass meetsLTC (senior <= 75%) and meetsMezzLTC (mezz <= 85%).
{
  // build $10M, equity $1.5M, senior limit $7M (70% LTC), mezz limit $1.5M (15% LTC)
  const inputs = makeDandenongShape({ build: 10_000_000, grv: 20_000_000, equity: 1_500_000, seniorLimit: 7_000_000, mezzLimit: 1_500_000 });
  const result = runCalculations(baseAdmin, inputs);
  const c = result.developmentCovenants;
  assert(c !== undefined, 'B1: developmentCovenants populated for development senior');
  if (c) {
    // ltc must now be SENIOR LTC, NOT combined peakDebt/totalCost
    assert(c.ltc <= c.ltcTarget + 1e-6, `B1: Senior LTC ${(c.ltc*100).toFixed(2)}% should meet senior target ${(c.ltcTarget*100).toFixed(2)}%`);
    assert(c.meetsLTC === true, 'B1: meetsLTC=true when senior LTC within senior target (per-facility, not combined)');
    // Mezz fields populated
    assert(c.mezzPresent === true, 'B1: mezzPresent flag set when mezz is in stack');
    assert(c.mezzLTC !== undefined, 'B1: mezzLTC populated when mezz present');
    assert(c.mezzLTCTarget === 0.85, `B1: mezzLTCTarget reflects mezz facility (got ${c.mezzLTCTarget})`);
    assert(c.meetsMezzLTC === true, 'B1: meetsMezzLTC=true when mezz LTC within mezz target');
    // ltc field should NOT equal combined peakDebt/totalCost when there are mezz balances.
    // peakDebt includes both senior+mezz, so combined ratio would be ~85% = senior+mezz.
    // Senior alone should be ~70% — definitely smaller.
    if (c.peakMezz !== undefined && c.peakMezz > 0) {
      assert(c.ltc < c.peakDebt / Math.max(1, result.feasibility.totalCost),
        `B1: senior LTC (${c.ltc.toFixed(4)}) is strictly less than combined peakDebt/totalCost when mezz is in stack`);
    }
  }
}

// ── 2. No-mezz project: mezzPresent=false, no mezz fields populated.
{
  const inputs = makeDandenongShape({ build: 10_000_000, grv: 20_000_000, equity: 3_000_000, seniorLimit: 7_000_000, mezzLimit: 0 });
  const result = runCalculations(baseAdmin, inputs);
  const c = result.developmentCovenants;
  assert(c !== undefined, 'B1: developmentCovenants populated (no-mezz case)');
  if (c) {
    assert(c.mezzPresent === false, 'B1: mezzPresent=false when mezz limit=0 and no mezz balance');
    assert(c.mezzLTC === undefined, 'B1: no mezzLTC when mezz absent');
    assert(c.meetsMezzLTC === undefined, 'B1: no meetsMezzLTC when mezz absent');
  }
}

console.log(`\nDANDENONG-B1 TESTS: ${passed} passed, ${failed} failed (${passed+failed} total)`);
if (failed > 0) {
  console.log('Failures:'); for (const f of failures) console.log('  -', f);
  (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(1);
}
