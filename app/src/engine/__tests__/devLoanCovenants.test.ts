/**
 * Regression tests for the development-loan covenant block (LVR / LTC / peak
 * senior vs facility limit). DSCR has been removed wholesale; this test
 * exercises that developmentCovenants is populated for a 'development'
 * senior and omitted for an 'investment' / 'residual-stock' senior, plus the
 * LVR / LTC math.
 *
 * Run: cd app && npx tsx src/engine/__tests__/devLoanCovenants.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs, FacilityType } from '../../types';

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
  projectName: 'Covenants Test',
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

function makeInputs(seniorType: FacilityType | undefined): MainInputs {
  // $20M GRV, $10M build, $4M senior facility limit (illustrative).
  return {
    preliminary: {
      dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 12, projectEndMonth: 12,
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
      sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12,
      addGST: false, ctd: 0, ctc: 10_000_000,
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
      currentSalePrice: 20_000_000,
      gstIncluded: false,
      preSaleExchangeMonth: 12, preSaleSpan: 1,
      settlementMonth: 12, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'Dev', equityCap: 6_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 6_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional: { name: '', equityCap: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name: 'L', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name: 'M', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 2 },
    seniorFacility: {
      name: 'Senior',
      ...(seniorType ? { facilityType: seniorType } : {}),
      facilityLimit: 8_000_000,
      startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0,
      establishmentFeePercent: 0, lineFeePercent: 0,
      interestPaymentFrequency: 1, isCapitalised: true,
      ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1,
    },
    seniorFacility2: { name: 'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name: 'R', facilityLimit: 0, startMonth: 1, maturityMonth: 12, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

// ── 1. development senior → developmentCovenants populated ─────────────────
{
  const result = runCalculations(baseAdmin, makeInputs('development'));
  assert(result.developmentCovenants !== undefined,
    'developmentCovenants populated when seniorFacility.facilityType === "development"');
  if (result.developmentCovenants) {
    const c = result.developmentCovenants;
    assert(c.lvrTarget === 0.65, 'lvrTarget passed through from facility');
    assert(c.ltcTarget === 0.7, 'ltcTarget passed through from facility');
    assert(c.seniorLimit === 8_000_000, 'seniorLimit reflects facilityLimit');
    assert(c.peakSenior >= 0 && c.peakSenior <= c.seniorLimit + 1,
      'peakSenior is within the senior limit (no overdraw)');
    // LVR = peakSenior / GRV ≤ 1 (and on this fixture, well below 1)
    assert(c.lvr >= 0 && c.lvr < 1, 'lvr is in (0,1) range');
    // LTC = peakDebt / totalCost ≤ 1 on this simple project
    assert(c.ltc >= 0, 'ltc is non-negative');
  }
}

// ── 2. residual-stock senior → developmentCovenants omitted ────────────────
{
  const result = runCalculations(baseAdmin, makeInputs('residual-stock'));
  assert(result.developmentCovenants === undefined,
    'developmentCovenants OMITTED when seniorFacility.facilityType === "residual-stock"');
  // Peak exposure (peakDebt/peakEquity/peakEquityMonth) is still always emitted.
  assert(typeof result.peakExposure?.peakDebt === 'number',
    'peakExposure still emitted regardless of facility type (replaces removed DSCR summary)');
}

// ── 3. investment senior → developmentCovenants omitted ────────────────────
{
  const result = runCalculations(baseAdmin, makeInputs('investment'));
  assert(result.developmentCovenants === undefined,
    'developmentCovenants OMITTED when seniorFacility.facilityType === "investment"');
}

// ── 4. unset facilityType → defaults to development (back-compat) ──────────
{
  const result = runCalculations(baseAdmin, makeInputs(undefined));
  assert(result.developmentCovenants !== undefined,
    'unset facilityType defaults to development (covenants populated for legacy projects)');
}

// ── 5. LVR math: peakSenior / GRV ──────────────────────────────────────────
{
  const result = runCalculations(baseAdmin, makeInputs('development'));
  if (result.developmentCovenants) {
    const c = result.developmentCovenants;
    const expectedLVR = c.peakSenior / 20_000_000; // GRV
    close(c.lvr, expectedLVR, 1e-9,
      'LVR = peakSenior / GRV (closed-form check)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`DEV-LOAN-COVENANTS TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
