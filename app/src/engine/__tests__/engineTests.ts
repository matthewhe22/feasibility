/**
 * Minimal unit tests for the feasibility engine. Run with:
 *   cd app && npx tsx src/engine/__tests__/engineTests.ts
 *
 * Uses bare assertions (no framework) so it can run alongside run-test.ts.
 * Exits with non-zero status on failure.
 */
import {
  spreadSettlements, spreadDeposits, spreadIncome,
  calculateSellingCommissions, totalGRV, totalNRV,
  resolveSupplyType, resolveIncomeSupplyType,
  clearRevenueWarnings, getRevenueWarnings,
} from '../revenue';
import { spreadCost, spreadCosts, spreadLandPayments } from '../costSpreading';
import { calculateIRR, sum } from '../../utils';
import { calculateStampDuty } from '../../utils/stampDuty';
import { STANDARD_BUILD_S_CURVES } from '../sCurves';
import type { Period, RevenueLineItem, CostLineItem, RentalIncomeItem, SellingCostConfig } from '../../types';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; return; }
  failed++;
  failures.push(msg);
}
function assertClose(actual: number, expected: number, tolerance: number, msg: string): void {
  assert(Math.abs(actual - expected) <= tolerance,
    `${msg} — expected ${expected} ±${tolerance}, got ${actual}`);
}

// Fixture: 12 monthly periods, first 3 actual, rest forecast
function makePeriods(n: number): Period[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i, periodNumber: i + 1,
    startDate: new Date(2024, i, 1),
    endDate: new Date(2024, i + 1, 0),
    daysInPeriod: 30,
    isActual: false, isForecast: true,
    label: `M${i + 1}`,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Revenue: spreadSettlements
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(12);
  const items: RevenueLineItem[] = [
    { code: 'X', description: '', revenueType: 'Residential', units: 1, totalArea: 0,
      currentSalePrice: 1200000, preSaleExchangeMonth: 3, preSaleSpan: 2,
      settlementMonth: 10, settlementSpan: 3, gstIncluded: true },
  ];
  const result = spreadSettlements(items, periods);
  assertClose(sum(result), 1200000, 0.01, 'spreadSettlements: total equals sale price');
  assertClose(result[9], 400000, 0.01, 'spreadSettlements: month 10 gets 1/3');
  assertClose(result[10], 400000, 0.01, 'spreadSettlements: month 11 gets 1/3');
  assertClose(result[11], 400000, 0.01, 'spreadSettlements: month 12 gets 1/3');
}

// Settlement month before presale exchange → should emit a warning
{
  clearRevenueWarnings();
  const periods = makePeriods(12);
  const items: RevenueLineItem[] = [
    { code: 'REV_BAD', description: '', revenueType: 'Residential', units: 1, totalArea: 0,
      currentSalePrice: 100000, preSaleExchangeMonth: 10, preSaleSpan: 1,
      settlementMonth: 5, settlementSpan: 1, gstIncluded: true },
  ];
  spreadSettlements(items, periods);
  const warnings = getRevenueWarnings();
  assert(warnings.some(w => w.includes('REV_BAD') && w.includes('precedes')),
    'spreadSettlements: warns when settlement < presale');
}

// Division-by-zero: zero span is normalised to 1, no NaN produced
{
  clearRevenueWarnings();
  const periods = makePeriods(6);
  const items: RevenueLineItem[] = [
    { code: 'Z', description: '', revenueType: 'Residential', units: 1, totalArea: 0,
      currentSalePrice: 100, preSaleExchangeMonth: 0, preSaleSpan: 0,
      settlementMonth: 2, settlementSpan: 0, gstIncluded: true },
  ];
  const result = spreadSettlements(items, periods);
  assert(result.every(v => Number.isFinite(v)), 'spreadSettlements: no NaN with zero span');
  assertClose(sum(result), 100, 0.01, 'spreadSettlements: zero span coerces to span=1');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Revenue: spreadDeposits uses sellingCosts[].depositPercent
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(12);
  const items: RevenueLineItem[] = [
    { code: 'A', description: '', revenueType: 'Residential', units: 1, totalArea: 0,
      currentSalePrice: 1000000, preSaleExchangeMonth: 3, preSaleSpan: 1,
      settlementMonth: 10, settlementSpan: 1, gstIncluded: true },
  ];
  const sellingCosts: SellingCostConfig[] = [
    { code: '', description: '', salesCommission: 0, preCommissionPercent: 0, depositPercent: 0.2, sCurve: 'Evenly Split', addGST: false },
  ];
  const result = spreadDeposits(items, periods, sellingCosts);
  assertClose(sum(result), 200000, 0.01, 'spreadDeposits: uses configured depositPercent (20%)');
  const resultDefault = spreadDeposits(items, periods); // no sellingCosts
  assertClose(sum(resultDefault), 100000, 0.01, 'spreadDeposits: falls back to 10% default');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Cost spreading: guards against invalid inputs
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(6);
  const item: CostLineItem = {
    code: '', description: '', costType: 'Development Costs',
    units: 1, baseRate: 0, totalCosts: 1000,
    sCurve: 'Evenly Split', monthStart: 0, monthSpan: 3,
    addGST: true, ctd: 0, ctc: 1000,
  };
  const r = spreadCost(item, periods);
  assertClose(sum(r), 0, 0.01, 'spreadCost: monthStart=0 returns zeros');
}
{
  const periods = makePeriods(6);
  const item: CostLineItem = {
    code: '', description: '', costType: 'Development Costs',
    units: 1, baseRate: 0, totalCosts: NaN,
    sCurve: 'Evenly Split', monthStart: 1, monthSpan: 3,
    addGST: true, ctd: 0, ctc: 0,
  };
  const r = spreadCost(item, periods);
  assert(r.every(v => Number.isFinite(v)), 'spreadCost: NaN totalCosts returns finite zeros');
}

// spreadCosts aggregate
{
  const periods = makePeriods(6);
  const items: CostLineItem[] = [
    { code: '1', description: '', costType: 'Development Costs', units: 1, baseRate: 0,
      totalCosts: 600, sCurve: 'Evenly Split', monthStart: 1, monthSpan: 6,
      addGST: true, ctd: 0, ctc: 600 },
    { code: '2', description: '', costType: 'Development Costs', units: 1, baseRate: 0,
      totalCosts: 300, sCurve: 'Evenly Split', monthStart: 3, monthSpan: 3,
      addGST: true, ctd: 0, ctc: 300 },
  ];
  const r = spreadCosts(items, periods);
  assertClose(sum(r), 900, 0.01, 'spreadCosts: total equals sum of totals');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Revenue: supply-type resolution
// ═══════════════════════════════════════════════════════════════════════════
{
  const resi: RevenueLineItem = {
    code: '', description: '', revenueType: 'Residential', units: 0, totalArea: 0,
    currentSalePrice: 100, preSaleExchangeMonth: 0, preSaleSpan: 0,
    settlementMonth: 1, settlementSpan: 1, gstIncluded: true,
  };
  assert(resolveSupplyType(resi) === 'margin-scheme', 'resolveSupplyType: gstIncluded residential → margin-scheme');

  const commercial: RevenueLineItem = { ...resi, revenueType: 'Retail F&B', gstIncluded: false };
  assert(resolveSupplyType(commercial) === 'input-taxed', 'resolveSupplyType: default non-gstIncluded → input-taxed');

  const explicit: RevenueLineItem = { ...commercial, supplyType: 'standard' };
  assert(resolveSupplyType(explicit) === 'standard', 'resolveSupplyType: explicit supplyType wins');
}

// Rental income defaults to input-taxed
{
  const rental: RentalIncomeItem = { code: '', description: '', revenueType: '',
    units: 0, baseRate: 0, sCurve: 'Evenly Split', monthStart: 1, monthSpan: 12 };
  assert(resolveIncomeSupplyType(rental) === 'input-taxed',
    'resolveIncomeSupplyType: default rental → input-taxed');
  const hotel: RentalIncomeItem = { ...rental, supplyType: 'standard' };
  assert(resolveIncomeSupplyType(hotel) === 'standard',
    'resolveIncomeSupplyType: explicit standard wins');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Commission calculation
// ═══════════════════════════════════════════════════════════════════════════
{
  const items: RevenueLineItem[] = [
    { code: '', description: '', revenueType: 'Residential', units: 0, totalArea: 0,
      currentSalePrice: 1000000, preSaleExchangeMonth: 0, preSaleSpan: 0,
      settlementMonth: 1, settlementSpan: 1, gstIncluded: true },
  ];
  const scs: SellingCostConfig[] = [
    { code: '', description: '', salesCommission: 0.04, preCommissionPercent: 0.5, depositPercent: 0.1, sCurve: 'Evenly Split', addGST: true },
  ];
  const r = calculateSellingCommissions(items, scs);
  assertClose(r.total, 40000, 0.01, 'calculateSellingCommissions: 4% × $1M = $40k total');
  assertClose(r.frontEnd, 20000, 0.01, 'calculateSellingCommissions: 50% front-end');
  assertClose(r.backEnd, 20000, 0.01, 'calculateSellingCommissions: 50% back-end');
}

// ═══════════════════════════════════════════════════════════════════════════
//  NRV and GRV
// ═══════════════════════════════════════════════════════════════════════════
{
  const items: RevenueLineItem[] = [
    { code: '', description: '', revenueType: 'Residential', units: 0, totalArea: 0,
      currentSalePrice: 1100000, preSaleExchangeMonth: 0, preSaleSpan: 0,
      settlementMonth: 1, settlementSpan: 1, gstIncluded: true },
    { code: '', description: '', revenueType: 'Retail F&B', units: 0, totalArea: 0,
      currentSalePrice: 100000, preSaleExchangeMonth: 0, preSaleSpan: 0,
      settlementMonth: 1, settlementSpan: 1, gstIncluded: false },
  ];
  assertClose(totalGRV(items), 1200000, 0.01, 'totalGRV: sum of all items');
  // NRV = (1.1M / 1.1) + 100k - 0 = 1M + 100k = 1.1M
  assertClose(totalNRV(items, 0.10, 0), 1100000, 0.01, 'totalNRV: net of GST on gstIncluded, no commission');
}

// ═══════════════════════════════════════════════════════════════════════════
//  IRR guards
// ═══════════════════════════════════════════════════════════════════════════
{
  assert(calculateIRR([]) === 0, 'IRR: empty array returns 0');
  assert(calculateIRR([0, 0, 0]) === 0, 'IRR: all zeros returns 0');
  assert(calculateIRR([100, 200, 300]) === 0, 'IRR: all positive returns 0');
  assert(calculateIRR([-100, -200]) === 0, 'IRR: all negative returns 0');
  const r = calculateIRR([-1000, 1100], 0.01);
  // 1100/1000 = 1.10 monthly → annualised ~213%
  assertClose(r, Math.pow(1.1, 12) - 1, 0.01, 'IRR: single period positive return');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Stamp duty concessions
// ═══════════════════════════════════════════════════════════════════════════
{
  const full = calculateStampDuty(2_000_000, 'QLD', 'none');
  const halfConc = calculateStampDuty(2_000_000, 'QLD', 'home-concession');
  assertClose(halfConc, full * 0.5, 0.01, 'stampDuty: home concession is 50%');
  assertClose(calculateStampDuty(2_000_000, 'QLD', 'first-home'), 0, 0.01,
    'stampDuty: first-home exemption is 0');
  const fs = calculateStampDuty(2_000_000, 'QLD', 'foreign-surcharge');
  assert(fs > full, 'stampDuty: foreign surcharge exceeds standard rate');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Standard build S-curves sum to 1
// ═══════════════════════════════════════════════════════════════════════════
{
  for (const months of [12, 24, 36, 48, 60]) {
    const curve = STANDARD_BUILD_S_CURVES[months];
    assert(curve != null && curve.length === months,
      `STANDARD_BUILD_S_CURVES: length ${months} present`);
    const s = sum(curve);
    assertClose(s, 1.0, 1e-9, `STANDARD_BUILD_S_CURVES[${months}] sums to 1.0`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Land payment stages
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(6);
  const stages = [
    { amount: 100, monthStart: 1, monthSpan: 2 },
    { amount: 200, monthStart: 0, monthSpan: 1 }, // invalid — skipped
    { amount: 50,  monthStart: 3, monthSpan: -1 }, // invalid — skipped
  ];
  const r = spreadLandPayments(stages, periods);
  assertClose(sum(r), 100, 0.01, 'spreadLandPayments: invalid stages skipped');
  assertClose(r[0], 50, 0.01, 'spreadLandPayments: month 1 half of stage 1');
  assertClose(r[1], 50, 0.01, 'spreadLandPayments: month 2 half of stage 1');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Income spread
// ═══════════════════════════════════════════════════════════════════════════
{
  const periods = makePeriods(12);
  const items: RentalIncomeItem[] = [
    { code: '', description: '', revenueType: '', units: 10, baseRate: 1000,
      sCurve: 'Evenly Split', monthStart: 3, monthSpan: 4 },
  ];
  const r = spreadIncome(items, periods);
  assertClose(sum(r), 10000, 0.01, 'spreadIncome: units × baseRate total');
  assertClose(r[2], 2500, 0.01, 'spreadIncome: even split per month');
  assertClose(r[5], 2500, 0.01, 'spreadIncome: spread across full span');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Final summary
// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(72)}`);
console.log(`ENGINE TESTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'='.repeat(72)}`);
if (failed > 0) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  // @ts-ignore — process is available at runtime via Node/tsx
  if (typeof process !== 'undefined') process.exit(1);
}
