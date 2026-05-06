/**
 * Regression tests — PR-C invariants.
 *
 *   R6  — All four facility columns share the same all-in formula
 *         (BBSY + Margin), no fee inflation.
 *   R7  — Mezz Margin/BBSY surfaced from facility.margin / .bbsy
 *         (not legacy interestRate).
 *   R13 — GRV Sold/Exchanged includes settlement-only projects
 *         (no presale).
 *   R15 — Engine emits a warning when input-taxed supplies coexist
 *         with non-zero ITC claim.
 *   R16 — applyGSTWithholding defaults true on margin-scheme projects
 *         and false otherwise; explicit user value still honoured.
 *   R17 — itcRecoveryLagMonths defaults 1 (was 0).
 *
 * Run: cd app && npx tsx src/engine/__tests__/prCInvariants.test.ts
 */
import { runCalculations } from '../index';
import type { AdminConfig, MainInputs } from '../../types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++; failures.push(msg);
}
function close(actual: number, expected: number, tol: number, msg: string): void {
  assert(Math.abs(actual - expected) <= tol, `${msg} — expected ${expected} ±${tol}, got ${actual}`);
}

const baseAdmin: AdminConfig = {
  projectName: 'PR-C invariants',
  modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[], [], []], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(opts: { gstIncluded?: boolean; revenueType?: string; settled?: boolean; mezzBBSY?: number; mezzMargin?: number } = {}): MainInputs {
  return {
    preliminary: { dateOfFirstPeriod: 45017, cashFlowPeriod: 'Monthly',
      projectLots: 1, projectGFA: 1000, siteArea: 500,
      projectStartMonth: 1, projectSpanMonths: 24, projectEndMonth: 24,
      equityDistStartMonth: 24, equityDistSpanMonths: 1 },
    landPurchase: { landPurchasePrice: 4_000_000, prsvUplift: 0, prsvMonth: 0, prsvSpan: 0,
      gstRate: 0.1, gstApplicableLand: false, addGSTOnLandPrice: false,
      stampDutyState: 'NSW', stampDutyAmount: 0,
      interestOnDeposit: 0, profitShareToLandOwner: 0,
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
    sellingCosts: [{ code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: false }],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: [{
      code: 'G', description: 'A',
      revenueType: (opts.revenueType ?? 'Residential') as MainInputs['grvItems'][number]['revenueType'],
      units: 1, totalArea: 100, currentSalePrice: 20_000_000,
      gstIncluded: opts.gstIncluded ?? true,
      preSaleExchangeMonth: opts.settled ? 0 : 6,
      preSaleSpan: opts.settled ? 0 : 1,
      settlementMonth: 24, settlementSpan: 1,
    } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', fixedAmount: 12_000_000, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 12_000_000, profitShare: 1, drawdownPriority: 1 },
    equityJV:        { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityPreferred: { name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    equityAdditional:{ name: '', fixedAmount: 0, percentage: 0, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: 0, profitShare: 0, drawdownPriority: 1 },
    landLoan: { name:'L', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0.10, bbsy: 0.04, margin: 0.06, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    mezzanine: { name:'M', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: opts.mezzBBSY ?? 0.04, margin: opts.mezzMargin ?? 0.10, establishmentFeePercent: 0.02, lineFeePercent: 0.005, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.85, lvrTarget: 0.80, drawdownPriority: 2 },
    seniorFacility:  { name:'S', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0.037, margin: 0.045, establishmentFeePercent: 0.015, lineFeePercent: 0.005, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    seniorFacility2: { name:'S2', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    residualStockFacility: { name:'R', facilityLimit: 0, startMonth: 1, maturityMonth: 24, interestRate: 0, bbsy: 0, margin: 0, establishmentFeePercent: 0, lineFeePercent: 0, interestPaymentFrequency: 1, isCapitalised: true, ltcTarget: 0.7, lvrTarget: 0.65, drawdownPriority: 1 },
    otherFinancingCosts: [],
  };
}

// ── R6: all-in formula consistency. Senior all-in should NOT include est+line. ─
{
  const r = runCalculations(baseAdmin, fixture());
  const dr = r.debtRates;
  // bbsy 0.037 + margin 0.045 = 0.082 exactly (no fees)
  close(dr.seniorAllIn, 0.082, 1e-9, 'R6 — seniorAllIn = bbsy + margin (no fees in all-in)');
  // mezz: bbsy 0.04 + margin 0.10 = 0.14
  close(dr.mezzAllIn, 0.14, 1e-9, 'R6 — mezzAllIn = bbsy + margin');
  // land: bbsy 0.04 + margin 0.06 = 0.10
  close(dr.landAllIn, 0.10, 1e-9, 'R6 — landAllIn = bbsy + margin');
}

// ── R7: Mezz Margin/BBSY mapped from facility.margin / .bbsy. ───────────────
{
  const r = runCalculations(baseAdmin, fixture({ mezzBBSY: 0.05, mezzMargin: 0.12 }));
  const dr = r.debtRates;
  close(dr.mezzMargin, 0.12, 1e-9, 'R7 — mezzMargin reflects facility.margin');
  close(dr.mezzBBSY,   0.05, 1e-9, 'R7 — mezzBBSY reflects facility.bbsy');
}

// ── R13: settled-only project (no presale) reports GRV Sold/Exchanged > 0
//        when the actuals window includes the settlement month. ─────────────
{
  // Use lastActualsPeriod = month 24 (settlement month) to put the settlement
  // inside the actuals window. lastActualsPeriod is an Excel-serial; lastActualPeriodNum
  // is computed from periods[].isActual which is set by modelStartDate vs lastActualsPeriod.
  // For the test, we set modelStartDate equal to lastActualsPeriod so the entire timeline
  // is "actual". Use admin override.
  // 24 monthly periods × ~30.4 days = ~730 days. Use +800 days to ensure entire timeline is actuals.
  const adminAllActual: AdminConfig = { ...baseAdmin, lastActualsPeriod: baseAdmin.modelStartDate + 1000 };
  const r = runCalculations(adminAllActual, fixture({ settled: true }));
  assert((r.grvSummary?.grvSoldExchanged ?? 0) > 0,
    `R13 — settled-only project reports GRV Sold/Exchanged > 0 (got ${r.grvSummary?.grvSoldExchanged})`);
}

// ── R15: input-taxed + ITC contradiction warning emitted. ────────────────────
{
  // B05 — the test previously used Residential gstIncluded=false to trigger
  // the warning. After B05 the legacy gstIncluded=false → input-taxed
  // inference is suppressed for Residential items (s.40-65 first-sale = taxable),
  // so to genuinely test the s.11-15 contradiction we now set EXPLICIT
  // supplyType='input-taxed' on the revenue item AND use a non-residential
  // type so the user is unambiguously declaring an input-taxed supply (e.g.
  // residential rental treated as Hotel, long-term commercial sublease, etc.).
  const fx = fixture({});
  fx.grvItems[0]!.revenueType = 'Hotel';
  // @ts-expect-error — runtime field not on the public type but accepted by the engine
  fx.grvItems[0]!.supplyType = 'input-taxed';
  const r = runCalculations(baseAdmin, fx);
  const warns = (r.warnings ?? []).join(' | ');
  assert(/input-taxed contradiction/i.test(warns) || /s\.11-15/.test(warns),
    `R15 — engine warns about explicit input-taxed + ITC. Warnings: ${warns.slice(0, 200)}`);
}

// ── R16: applyGSTWithholding default = true on margin-scheme projects. ────────
{
  // Don't set admin.applyGSTWithholding; expect default to kick in.
  const margin = runCalculations(baseAdmin, fixture());  // Residential, gstIncluded=true → margin-scheme
  assert((margin.gstCompliance?.gstWithholdingTotal ?? 0) > 0,
    `R16 — withholding auto-applies on margin-scheme project (got ${margin.gstCompliance?.gstWithholdingTotal})`);

  // Non-margin-scheme (commercial gstIncluded=true → standard) should default OFF.
  const noMargin = runCalculations(baseAdmin, fixture({ revenueType: 'Commercial Office' }));
  // Under default-OFF for non-margin projects, withholding total is 0.
  close(noMargin.gstCompliance?.gstWithholdingTotal ?? 0, 0, 1,
    'R16 — withholding auto-OFF on non-margin-scheme project');

  // Explicit user choice still honoured (false on a margin-scheme project)
  const explicit = runCalculations({ ...baseAdmin, applyGSTWithholding: false }, fixture());
  close(explicit.gstCompliance?.gstWithholdingTotal ?? 0, 0, 1,
    'R16 — explicit applyGSTWithholding=false honoured even on margin-scheme');
}

// ── R17: itcRecoveryLagMonths defaults to 1 — itcRecovery is shifted by 1. ───
{
  const r = runCalculations(baseAdmin, fixture());
  // First gstOnCosts paid in period 4 (construction starts), so ITC at period 5.
  // sum(itcRecovery) should equal sum(gstOnCosts) in steady state.
  const cf = r.cashflows;
  const gstC = cf.reduce((s, c) => s + c.gstOnCosts, 0);
  const itc = cf.reduce((s, c) => s + c.itcRecovery, 0);
  // With lag=1, the LAST period's gstOnCosts pushes ITC to period N+1, which falls
  // outside the timeline → small drop tolerated.
  assert(itc <= gstC + 1, `R17 — sum(ITC) ≤ sum(gstOnCosts) under lag=1 (got ITC=${itc}, gstC=${gstC})`);
  // ITC should be > 0 (lag=1 not lag=∞)
  assert(itc > 0, 'R17 — sum(ITC) > 0 with lag=1');
  // Empirically: with default lag=1, the first ITC arrives one period after the first
  // gstOnCosts. Find the first non-zero of each and check the gap.
  const firstGSTC = cf.findIndex(c => c.gstOnCosts > 1);
  const firstITC = cf.findIndex(c => c.itcRecovery > 1);
  if (firstGSTC >= 0 && firstITC >= 0) {
    assert(firstITC === firstGSTC + 1,
      `R17 — first ITC one period after first gstOnCosts (got ${firstGSTC} → ${firstITC})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`PR-C INVARIANTS TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(72)}`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  (globalThis as { process?: { exit: (n: number) => never } }).process?.exit(1);
}
