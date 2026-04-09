import type { RevenueLineItem, RentalIncomeItem, Period, SellingCostConfig } from '../types';

// Spread GRV settlements across periods
export function spreadSettlements(items: RevenueLineItem[], periods: Period[]): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    if (item.currentSalePrice === 0 || item.settlementMonth <= 0) continue;
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
    // Deposit is typically 10% of sale price, spread across presale period
    const depositAmount = item.currentSalePrice * 0.1; // default 10% deposit
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

// Spread rental/other income
export function spreadIncome(items: RentalIncomeItem[], periods: Period[]): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    const total = item.units * item.baseRate;
    if (total === 0 || item.monthSpan <= 0) continue;
    const startIdx = item.monthStart - 1;
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
