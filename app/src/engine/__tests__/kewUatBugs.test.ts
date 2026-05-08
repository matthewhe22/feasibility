/**
 * Kew UAT Extra — invariant tests for the 6-bug fix bundle.
 *
 * Bug 2: senior auto-size respects min(LTC × TDC, LVR × NRV, facilityLimit).
 * Bug 3: minEquityRequirement.value semantic — fraction in [0, 1] when mode='percent';
 *        engine + v9 migration heal legacy values > 1.
 * Bug 6: salesCommission broadcasts a single sellingCost row across all grvItems.
 *
 * Run: cd app && npx tsx src/engine/__tests__/kewUatBugs.test.ts
 */
import { runCalculations } from '../index';
import { calculateSellingCommissions } from '../revenue';
import { migratePersistedState } from '../../store/useStore';
import type { AdminConfig, MainInputs, SellingCostConfig, RevenueLineItem } from '../../types';

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; failures.push(msg); }
}

const baseAdmin: AdminConfig = {
  projectName: 'Kew-UAT', modelStartDate: 44927, monthsPerPeriod: 1, lastActualsPeriod: 44927,
  tolerance: 50, daysPerYear: 365, monthsPerYear: 12, currency: '$',
  sCurveOptions: ['Evenly Split'], manualSCurves: [[],[],[]], buildSCurves: {},
  contingencyGSTMode: 'none',
};

function fixture(overrides: {
  seniorFacility: number;
  ltcTarget: number;
  lvrTarget: number;
  equity?: number;
  cost?: number;
  revenue?: number;
  minEq?: MainInputs['minEquityRequirement'];
  sellingCosts?: SellingCostConfig[];
  grvItems?: RevenueLineItem[];
}): MainInputs {
  const cost = overrides.cost ?? 10_000_000;
  const revenue = overrides.revenue ?? 18_000_000;
  const equity = overrides.equity ?? 1_000_000;
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
    sellingCosts: overrides.sellingCosts ?? [
      { code: 'S', description: 'A', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0, sCurve: 'Evenly Split', addGST: false },
    ],
    frontEndSellingCosts: [], backEndSellingCosts: [], lettingFees: [],
    grvItems: overrides.grvItems ?? [{ code: 'G', description: 'A', revenueType: 'Residential', units: 1, totalArea: 100,
      currentSalePrice: revenue, gstIncluded: true,
      preSaleExchangeMonth: 0, preSaleSpan: 0, settlementMonth: 22, settlementSpan: 3 } as unknown as MainInputs['grvItems'][number]],
    rentalIncome: [], otherIncome: [],
    equityDeveloper: { name: 'D', equityCap: equity, percentage: 1, interestRate: 0, interestCompound: 0, repayEquityBeforeDebt: 0, equityContribution: equity, profitShare: 1, drawdownPriority: 1 },
    equityJV: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityPreferred: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    equityAdditional: { name:'',equityCap:0,percentage:0,interestRate:0,interestCompound:0,repayEquityBeforeDebt:0,equityContribution:0,profitShare:0,drawdownPriority:1 },
    landLoan: { name:'L',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    seniorFacility: { name:'S', facilityLimit: overrides.seniorFacility, startMonth:1, maturityMonth:24, interestRate:0, bbsy:0.04, margin:0.04, establishmentFeePercent:0, lineFeePercent:0, interestPaymentFrequency:1, isCapitalised:true, ltcTarget: overrides.ltcTarget, lvrTarget: overrides.lvrTarget, drawdownPriority:2 },
    seniorFacility2: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    mezzanine: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.85,lvrTarget:0.80,drawdownPriority:3 },
    residualStockFacility: { name:'',facilityLimit:0,startMonth:1,maturityMonth:24,interestRate:0,bbsy:0,margin:0,establishmentFeePercent:0,lineFeePercent:0,interestPaymentFrequency:1,isCapitalised:true,ltcTarget:0.7,lvrTarget:0.65,drawdownPriority:1 },
    otherFinancingCosts: [],
    ...(overrides.minEq !== undefined ? { minEquityRequirement: overrides.minEq } : {}),
  };
}

// ── Bug 2: LTC binds first ────────────────────────────────────────────────
// Cost ~$13M, LTC=0.50 (tight), LVR=0.99 (loose). LTC × TDC ≈ $7M is binding.
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 100_000_000,  // huge facility — should not matter
    ltcTarget: 0.50,
    lvrTarget: 0.99,
  }));
  const peakSnr = Math.max(...r.cashflows.map(c => c.seniorBalance ?? 0));
  const ltcCap = r.feasibility.totalCost * 0.50;
  // Within 5% slack for cap-int compounding (matches m4MatrixCR2 convention).
  assert(peakSnr <= ltcCap * 1.10 + 100,
    `Bug 2 — LTC binds first: peak senior $${Math.round(peakSnr).toLocaleString()} ≤ LTC×TDC $${Math.round(ltcCap).toLocaleString()} (within 10% cap-int slack)`);
}

// ── Bug 2: LVR binds first ────────────────────────────────────────────────
// Cost ~$13M, LTC=0.99 (loose), LVR=0.30 (tight). LVR × NRV ≈ $5.4M is binding.
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 100_000_000,
    ltcTarget: 0.99,
    lvrTarget: 0.30,
    revenue: 18_000_000,
  }));
  const peakSnr = Math.max(...r.cashflows.map(c => c.seniorBalance ?? 0));
  // NRV ≈ totalGRV - GST - selling. Approximate against feasibility.totalNRV.
  // No totalNRV on FeasibilitySummary; approximate NRV ≈ totalGRV − GST − commissions.
  const grv = r.feasibility.totalGRV;
  const grvNRV = grv - (r.feasibility.gstOnRevenue ?? 0) - (r.feasibility.salesCommissions ?? 0);
  const lvrCap = grvNRV * 0.30;
  assert(peakSnr <= lvrCap * 1.10 + 100,
    `Bug 2 — LVR binds first: peak senior $${Math.round(peakSnr).toLocaleString()} ≤ LVR×NRV $${Math.round(lvrCap).toLocaleString()} (within 10% cap-int slack)`);
}

// ── Bug 2: facilityLimit hard cap ─────────────────────────────────────────
// LTC=0.99 + LVR=0.99 (both loose) but facilityLimit = $5M → senior peak ≤ $5M.
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 5_000_000,
    ltcTarget: 0.99,
    lvrTarget: 0.99,
  }));
  const peakSnr = Math.max(...r.cashflows.map(c => c.seniorBalance ?? 0));
  assert(peakSnr <= 5_000_000 * 1.05 + 100,
    `Bug 2 — facilityLimit binds: peak senior $${Math.round(peakSnr).toLocaleString()} ≤ facilityLimit $5,000,000 (within 10% cap-int slack)`);
}

// ── Bug 3: minEquityRequirement percent semantic — value=0.10 → 10% × TDC ──
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 100_000_000, ltcTarget: 0.99, lvrTarget: 0.99,
    minEq: { mode: 'percent', value: 0.10, basis: 'tdc-incl-finance-costs' },
  }));
  const c = r.minEquityCheck;
  const expected = (c?.basisAmount ?? 0) * 0.10;
  assert(Math.abs(c.required - expected) < 1,
    `Bug 3 — value=0.10 yields required ≈ 10% × TDC: required=$${Math.round(c.required).toLocaleString()}, expected≈$${Math.round(expected).toLocaleString()}`);
}

// ── Bug 3: legacy value=10 with mode='percent' — engine self-heals (warn + /100) ──
{
  const r = runCalculations(baseAdmin, fixture({
    seniorFacility: 100_000_000, ltcTarget: 0.99, lvrTarget: 0.99,
    minEq: { mode: 'percent', value: 10, basis: 'tdc-incl-finance-costs' },
  }));
  const c = r.minEquityCheck;
  // Engine should normalise 10 → 0.10 inside computeMinEquityCheck.
  const expected = (c?.basisAmount ?? 0) * 0.10;
  assert(Math.abs(c.required - expected) < 1,
    `Bug 3 — legacy value=10 normalised to 10%: required=$${Math.round(c.required).toLocaleString()}, expected≈$${Math.round(expected).toLocaleString()} (would have been 10× = $${Math.round((c?.basisAmount ?? 0) * 10).toLocaleString()} pre-fix)`);
}

// ── Bug 3: v9 migration heals stored value > 1 ─────────────────────────────
{
  const v8State = {
    inputs: {
      minEquityRequirement: { mode: 'percent', value: 10, basis: 'tdc-incl-finance-costs' },
    },
  };
  // Migrate from v8 → v9.
  const out = migratePersistedState(v8State, 8) as { inputs: { minEquityRequirement: { value: number } } };
  assert(Math.abs(out.inputs.minEquityRequirement.value - 0.10) < 1e-9,
    `Bug 3 — v9 migration: 10 → 0.10, got ${out.inputs.minEquityRequirement.value}`);
}

// ── Bug 3: v9 migration is idempotent on values already in [0, 1] ─────────
{
  const v8State = {
    inputs: { minEquityRequirement: { mode: 'percent', value: 0.10, basis: 'tdc-incl-finance-costs' } },
  };
  const out = migratePersistedState(v8State, 8) as { inputs: { minEquityRequirement: { value: number } } };
  assert(Math.abs(out.inputs.minEquityRequirement.value - 0.10) < 1e-9,
    `Bug 3 — v9 migration idempotent on fractional value: 0.10 → ${out.inputs.minEquityRequirement.value}`);
}

// ── Bug 3: v9 migration leaves amount-mode untouched ──────────────────────
{
  const v8State = {
    inputs: { minEquityRequirement: { mode: 'amount', value: 50_000_000, basis: 'tdc' } },
  };
  const out = migratePersistedState(v8State, 8) as { inputs: { minEquityRequirement: { value: number } } };
  assert(out.inputs.minEquityRequirement.value === 50_000_000,
    `Bug 3 — v9 migration: amount-mode value untouched, got ${out.inputs.minEquityRequirement.value}`);
}

// ── Bug 6: single sellingCost row applies to ALL grvItems ─────────────────
{
  const grvItems: RevenueLineItem[] = [
    { code: 'A', description: 'Tower 1', revenueType: 'Residential', units: 100, totalArea: 5000,
      currentSalePrice: 100_000_000, preSaleExchangeMonth: 3, preSaleSpan: 1, settlementMonth: 22, settlementSpan: 3, gstIncluded: true } as unknown as RevenueLineItem,
    { code: 'B', description: 'Tower 2', revenueType: 'Residential', units: 100, totalArea: 5000,
      currentSalePrice: 100_000_000, preSaleExchangeMonth: 3, preSaleSpan: 1, settlementMonth: 22, settlementSpan: 3, gstIncluded: true } as unknown as RevenueLineItem,
    { code: 'C', description: 'Tower 3', revenueType: 'Residential', units: 100, totalArea: 5000,
      currentSalePrice: 112_950_000, preSaleExchangeMonth: 3, preSaleSpan: 1, settlementMonth: 22, settlementSpan: 3, gstIncluded: true } as unknown as RevenueLineItem,
  ];
  // ONE selling cost row, expected to apply to all three grvItems.
  const sellingCosts: SellingCostConfig[] = [
    { code: 'S', description: 'all', salesCommission: 0.025, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: false },
  ];
  const c = calculateSellingCommissions(grvItems, sellingCosts);
  // Expected = 2.5% × (100 + 100 + 112.95) = $7,823,750. Pre-fix it was 2.5% × 100M = $2.5M.
  const expected = 0.025 * (100_000_000 + 100_000_000 + 112_950_000);
  assert(Math.abs(c.total - expected) < 1,
    `Bug 6 — single sellingCost row spans all grvItems: total=$${Math.round(c.total).toLocaleString()}, expected=$${Math.round(expected).toLocaleString()}`);
}

// ── Bug 6: per-grvItem sellingCost rows still pair index-to-index ─────────
{
  const grvItems: RevenueLineItem[] = [
    { code: 'A', description: 'a', revenueType: 'Residential', units: 1, totalArea: 100, currentSalePrice: 1_000_000, preSaleExchangeMonth: 3, preSaleSpan: 1, settlementMonth: 22, settlementSpan: 3, gstIncluded: true } as unknown as RevenueLineItem,
    { code: 'B', description: 'b', revenueType: 'Residential', units: 1, totalArea: 100, currentSalePrice: 2_000_000, preSaleExchangeMonth: 3, preSaleSpan: 1, settlementMonth: 22, settlementSpan: 3, gstIncluded: true } as unknown as RevenueLineItem,
  ];
  const sellingCosts: SellingCostConfig[] = [
    { code: 'S1', description: 'res', salesCommission: 0.025, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: false },
    { code: 'S2', description: 'comm', salesCommission: 0.027, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: false },
  ];
  const c = calculateSellingCommissions(grvItems, sellingCosts);
  const expected = 0.025 * 1_000_000 + 0.027 * 2_000_000;  // 25k + 54k = 79k
  assert(Math.abs(c.total - expected) < 1,
    `Bug 6 — multi-row sellingCosts pair index-to-index: total=$${c.total.toFixed(2)}, expected=$${expected.toFixed(2)}`);
}

// ── Output ─────────────────────────────────────────────────────────────────
console.log(`\nKew UAT bugs invariant tests — passed ${passed}, failed ${failed}`);
if (failed > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
