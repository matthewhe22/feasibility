import type { RevenueLineItem, RentalIncomeItem, Period, SellingCostConfig } from '../types';

// Spread GRV settlements across periods, blending per-period actuals with
// remaining-budget redistribution (same pattern as spreadCost in costSpreading.ts).
export function spreadSettlements(items: RevenueLineItem[], periods: Period[]): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    if (item.currentSalePrice === 0 || item.settlementMonth <= 0) continue;

    if (item.actuals && item.actuals.some(v => v != null && v > 0)) {
      // Actual periods: use uploaded values
      let actualTotal = 0;
      for (let i = 0; i < periods.length; i++) {
        if (periods[i].isActual) {
          const actual = item.actuals[i] ?? 0;
          result[i] += actual;
          actualTotal += actual;
        }
      }
      // Forecast periods within the settlement window: redistribute remaining
      // proportionally to each period's original weight (uniform: 1 per slot).
      const remaining = item.currentSalePrice - actualTotal;
      if (remaining > 0) {
        const startIdx = item.settlementMonth - 1;
        const span = item.settlementSpan || 1;
        const forecastEntries: { idx: number; weight: number }[] = [];
        for (let i = 0; i < span; i++) {
          const idx = startIdx + i;
          if (idx >= 0 && idx < periods.length && !periods[idx].isActual) {
            forecastEntries.push({ idx, weight: 1 }); // uniform: each slot has equal weight
          }
        }
        const weightSum = forecastEntries.reduce((s, e) => s + e.weight, 0);
        if (weightSum > 0) {
          for (const { idx, weight } of forecastEntries) {
            result[idx] += remaining * weight / weightSum;
          }
        }
      }
      continue;
    }

    // Standard: even distribution across settlement span
    const startIdx = item.settlementMonth - 1;
    const span = item.settlementSpan || 1;
    const perMonth = item.currentSalePrice / span;
    for (let i = 0; i < span; i++) {
      const idx = startIdx + i;
      if (idx >= 0 && idx < periods.length) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}

// Spread deposits (presale exchange) across periods
export function spreadDeposits(items: RevenueLineItem[], periods: Period[]): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    if (item.currentSalePrice === 0 || item.preSaleExchangeMonth <= 0 || item.preSaleSpan <= 0) continue;
    const depositAmount = item.currentSalePrice * 0.1;
    const startIdx = item.preSaleExchangeMonth - 1;
    const span = item.preSaleSpan;
    const perMonth = depositAmount / span;
    for (let i = 0; i < span; i++) {
      const idx = startIdx + i;
      if (idx >= 0 && idx < periods.length) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}

// Calculate selling commissions per revenue item
export function calculateSellingCommissions(
  grvItems: RevenueLineItem[],
  sellingCosts: SellingCostConfig[],
): { frontEnd: number; backEnd: number; total: number } {
  let frontEnd = 0;
  let backEnd = 0;

  for (let i = 0; i < grvItems.length && i < sellingCosts.length; i++) {
    const grv = grvItems[i];
    const sc = sellingCosts[i];
    if (!sc || grv.currentSalePrice === 0) continue;

    const totalCommission = grv.currentSalePrice * sc.salesCommission;
    const fe = totalCommission * sc.preCommissionPercent;
    const be = totalCommission * (1 - sc.preCommissionPercent);
    frontEnd += fe;
    backEnd += be;
  }

  return { frontEnd, backEnd, total: frontEnd + backEnd };
}

// Spread back-end commissions at settlement months
export function spreadBackEndCommissions(
  grvItems: RevenueLineItem[],
  sellingCosts: SellingCostConfig[],
  periods: Period[],
): number[] {
  const result = new Array(periods.length).fill(0);
  for (let i = 0; i < grvItems.length && i < sellingCosts.length; i++) {
    const grv = grvItems[i];
    const sc = sellingCosts[i];
    if (!sc || grv.currentSalePrice === 0 || grv.settlementMonth <= 0) continue;

    const totalCommission = grv.currentSalePrice * sc.salesCommission;
    const backEnd = totalCommission * (1 - sc.preCommissionPercent);
    if (backEnd <= 0) continue;

    const startIdx = grv.settlementMonth - 1;
    const span = grv.settlementSpan || 1;
    const perMonth = backEnd / span;
    for (let j = 0; j < span; j++) {
      const idx = startIdx + j;
      if (idx >= 0 && idx < periods.length) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}

// Spread rental/other income, blending per-period actuals with remaining-budget
// redistribution over forecast periods within the item's span.
export function spreadIncome(items: RentalIncomeItem[], periods: Period[]): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    const total = item.units * item.baseRate;
    if (total === 0 || item.monthSpan <= 0) continue;
    const startIdx = item.monthStart - 1;

    if (item.actuals && item.actuals.some(v => v != null && v > 0)) {
      // Actual periods: use uploaded values
      let actualTotal = 0;
      for (let i = 0; i < periods.length; i++) {
        if (periods[i].isActual) {
          const actual = item.actuals[i] ?? 0;
          result[i] += actual;
          actualTotal += actual;
        }
      }
      // Forecast periods within the income span: distribute remaining evenly
      const remaining = total - actualTotal;
      if (remaining > 0) {
        const forecastIdxs: number[] = [];
        for (let i = 0; i < item.monthSpan; i++) {
          const idx = startIdx + i;
          if (idx >= 0 && idx < periods.length && !periods[idx].isActual) {
            forecastIdxs.push(idx);
          }
        }
        if (forecastIdxs.length > 0) {
          const perPeriod = remaining / forecastIdxs.length;
          for (const idx of forecastIdxs) {
            result[idx] += perPeriod;
          }
        }
      }
      continue;
    }

    // Standard: even distribution
    const perMonth = total / item.monthSpan;
    for (let i = 0; i < item.monthSpan; i++) {
      const idx = startIdx + i;
      if (idx >= 0 && idx < periods.length) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}

// Calculate GST on residential sales (margin scheme)
export function calculateGSTOnSales(items: RevenueLineItem[], gstRate: number): number {
  let gst = 0;
  for (const item of items) {
    if (item.gstIncluded && item.currentSalePrice > 0) {
      gst += item.currentSalePrice * gstRate / (1 + gstRate);
    }
  }
  return gst;
}

// Get net revenue (exc GST) for each item
export function getNetRevenue(item: RevenueLineItem, gstRate: number): number {
  if (item.gstIncluded) {
    return item.currentSalePrice / (1 + gstRate);
  }
  return item.currentSalePrice;
}

// Total GRV
export function totalGRV(items: RevenueLineItem[]): number {
  return items.reduce((sum, item) => sum + item.currentSalePrice, 0);
}

// Total NRV (Net Realisable Value)
export function totalNRV(items: RevenueLineItem[], gstRate: number, backEndSellingCosts: number): number {
  let nrv = 0;
  for (const item of items) {
    nrv += getNetRevenue(item, gstRate);
  }
  return nrv - backEndSellingCosts;
}
