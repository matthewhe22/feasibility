import type { RevenueLineItem, RentalIncomeItem, Period, SellingCostConfig, GSTSupplyType } from '../types';

// Collects per-engine-run warnings about invalid revenue input (month ordering, span overflow).
// Cleared via clearRevenueWarnings() at the start of each runCalculations() call.
const _revenueWarnings: Set<string> = new Set();
export function clearRevenueWarnings(): void { _revenueWarnings.clear(); }
export function getRevenueWarnings(): string[] { return Array.from(_revenueWarnings); }

// Guard: coerce a possibly-invalid numeric span to a positive integer, logging a warning.
function normaliseSpan(
  span: number | undefined,
  periodsLength: number,
  context: string,
): number {
  const n = Number.isFinite(span) ? Math.floor(span as number) : 0;
  if (n <= 0) return 1;
  if (n > periodsLength) {
    _revenueWarnings.add(`${context}: span ${n} exceeds timeline length ${periodsLength} — capped.`);
    return periodsLength;
  }
  return n;
}

// Spread GRV settlements across periods, blending per-period actuals with
// remaining-budget redistribution (same pattern as spreadCost in costSpreading.ts).
export function spreadSettlements(items: RevenueLineItem[], periods: Period[]): number[] {
  const n = periods.length;
  const result = new Array(n).fill(0);
  for (const item of items) {
    if (!Number.isFinite(item.currentSalePrice) || item.currentSalePrice <= 0) continue;
    if (!Number.isFinite(item.settlementMonth) || item.settlementMonth <= 0) continue;

    // Validate month ordering: settlement must not precede presale exchange.
    if (item.preSaleExchangeMonth > 0 && item.settlementMonth < item.preSaleExchangeMonth) {
      _revenueWarnings.add(
        `Revenue item ${item.code}: settlement month ${item.settlementMonth} precedes presale exchange month ${item.preSaleExchangeMonth}. `
        + `This would reverse the cashflow (deposit received after settlement). Check inputs.`
      );
    }

    if (item.actuals && item.actuals.some(v => v != null && v > 0)) {
      // Actual periods: use uploaded values
      let actualTotal = 0;
      for (let i = 0; i < n; i++) {
        if (periods[i]?.isActual) {
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
        const span = normaliseSpan(item.settlementSpan, n, `Revenue item ${item.code} settlement`);
        const forecastEntries: { idx: number; weight: number }[] = [];
        for (let i = 0; i < span; i++) {
          const idx = startIdx + i;
          if (idx >= 0 && idx < n && !periods[idx]?.isActual) {
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
    const rawSpan = normaliseSpan(item.settlementSpan, n, `Revenue item ${item.code} settlement`);
    // Clip to periods remaining from startIdx so perMonth is computed over the
    // actual number of slots that receive revenue — not a larger normalised span.
    const effectiveSpan = Math.min(rawSpan, Math.max(0, n - startIdx));
    if (effectiveSpan <= 0) {
      _revenueWarnings.add(`Revenue item ${item.code}: settlement month ${item.settlementMonth} is beyond the timeline — revenue not spread.`);
      continue;
    }
    if (effectiveSpan < rawSpan) {
      _revenueWarnings.add(`Revenue item ${item.code}: settlement span clipped from ${rawSpan} to ${effectiveSpan} months to fit within timeline.`);
    }
    const perMonth = item.currentSalePrice / effectiveSpan;
    for (let i = 0; i < effectiveSpan; i++) {
      result[startIdx + i] += perMonth;
    }
  }
  return result;
}

// Spread deposits (presale exchange) across periods.
// Per-item depositPercent is read from the matching SellingCostConfig (defaults to 10%).
export function spreadDeposits(
  items: RevenueLineItem[],
  periods: Period[],
  sellingCosts?: SellingCostConfig[],
): number[] {
  const n = periods.length;
  const result = new Array(n).fill(0);
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!item) continue;
    if (!Number.isFinite(item.currentSalePrice) || item.currentSalePrice <= 0) continue;
    if (!Number.isFinite(item.preSaleExchangeMonth) || item.preSaleExchangeMonth <= 0) continue;
    if (!Number.isFinite(item.preSaleSpan) || item.preSaleSpan <= 0) continue;
    const configuredPct = sellingCosts?.[idx]?.depositPercent;
    const depositPct = (typeof configuredPct === 'number' && configuredPct > 0) ? configuredPct : 0.1;
    const depositAmount = item.currentSalePrice * depositPct;
    const startIdx = item.preSaleExchangeMonth - 1;
    const span = normaliseSpan(item.preSaleSpan, n, `Revenue item ${item.code} presale`);
    const perMonth = depositAmount / span;
    for (let i = 0; i < span; i++) {
      const targetIdx = startIdx + i;
      if (targetIdx >= 0 && targetIdx < n) {
        result[targetIdx] += perMonth;
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
    if (!grv || !sc || grv.currentSalePrice === 0) continue;

    const totalCommission = grv.currentSalePrice * sc.salesCommission;
    // M2 — Items with no presale (preSaleExchangeMonth = 0) have no presale-
    // exchange event for front-end commission to attribute against. The user-
    // configured preCommissionPercent (e.g. 50/50) assumes a presale window
    // exists. Without one, the entire commission is paid at settlement (treat
    // as back-end). Pre-fix the engine still split the commission per the
    // configured percentage but only spread the back-end portion — the front-
    // end portion remained in totalCost without ever appearing in the cashflow,
    // creating a phantom $X reconciliation residual on settlement-only
    // projects. This routing fixes that.
    const hasPresale = grv.preSaleExchangeMonth > 0 && grv.preSaleSpan > 0;
    const fe = hasPresale ? totalCommission * sc.preCommissionPercent : 0;
    const be = totalCommission - fe;
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
  const n = periods.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < grvItems.length && i < sellingCosts.length; i++) {
    const grv = grvItems[i];
    const sc = sellingCosts[i];
    if (!grv || !sc) continue;
    if (!Number.isFinite(grv.currentSalePrice) || grv.currentSalePrice <= 0) continue;
    if (!Number.isFinite(grv.settlementMonth) || grv.settlementMonth <= 0) continue;

    const totalCommission = grv.currentSalePrice * sc.salesCommission;
    // M2 — Mirror calculateSellingCommissions: when no presale, the entire
    // commission falls at settlement (treat as back-end). Without this, the
    // back-end spread used the configured (1 - preCommissionPercent) and
    // dropped the front-end portion entirely from the cashflow.
    const hasPresale = grv.preSaleExchangeMonth > 0 && grv.preSaleSpan > 0;
    const backEnd = hasPresale ? totalCommission * (1 - sc.preCommissionPercent) : totalCommission;
    if (backEnd <= 0) continue;

    const startIdx = grv.settlementMonth - 1;
    const span = normaliseSpan(grv.settlementSpan, n, `Revenue item ${grv.code} settlement`);
    const perMonth = backEnd / span;
    for (let j = 0; j < span; j++) {
      const idx = startIdx + j;
      if (idx >= 0 && idx < n) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}

// Spread rental/other income, blending per-period actuals with remaining-budget
// redistribution over forecast periods within the item's span.
export function spreadIncome(items: RentalIncomeItem[], periods: Period[]): number[] {
  const n = periods.length;
  const result = new Array(n).fill(0);
  for (const item of items) {
    const total = item.units * item.baseRate;
    if (!Number.isFinite(total) || total === 0) continue;
    if (!Number.isFinite(item.monthSpan) || item.monthSpan <= 0) continue;
    const startIdx = item.monthStart - 1;
    const monthSpan = normaliseSpan(item.monthSpan, n, `Income item ${item.code}`);

    if (item.actuals && item.actuals.some(v => v != null && v > 0)) {
      // Actual periods: use uploaded values
      let actualTotal = 0;
      for (let i = 0; i < n; i++) {
        if (periods[i]?.isActual) {
          const actual = item.actuals[i] ?? 0;
          result[i] += actual;
          actualTotal += actual;
        }
      }
      // Forecast periods within the income span: distribute remaining evenly
      const remaining = total - actualTotal;
      if (remaining > 0) {
        const forecastIdxs: number[] = [];
        for (let i = 0; i < monthSpan; i++) {
          const idx = startIdx + i;
          if (idx >= 0 && idx < n && !periods[idx]?.isActual) {
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
    const perMonth = total / monthSpan;
    for (let i = 0; i < monthSpan; i++) {
      const idx = startIdx + i;
      if (idx >= 0 && idx < n) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}

/**
 * Resolve the effective GST supply type for a revenue item.
 * If the item specifies supplyType explicitly, use that. Otherwise derive from
 * gstIncluded: gstIncluded=true → margin-scheme (new residential), false → input-taxed.
 *
 * NOTE: commercial/retail/hotel items that ARE standard-rated should be configured
 * with gstIncluded=true or explicit supplyType='standard'. Legacy projects with
 * gstIncluded=false on commercial items are preserved as input-taxed (no GST).
 */
export function resolveSupplyType(item: RevenueLineItem): GSTSupplyType {
  // Explicit override always wins.
  if (item.supplyType) return item.supplyType;
  // Items not marked gstIncluded are input-taxed (residential rental / non-creditable supplies).
  if (!item.gstIncluded) return 'input-taxed';
  // gstIncluded === true → route by revenueType so a Commercial Office / Hotel
  // / Retail tenancy is correctly standard-rated rather than silently coerced
  // into the margin scheme. New residential premises (Residential, Settlement
  // Adjustments) remain on Division 75; everything else is standard-rated.
  switch (item.revenueType) {
    case 'Retail F&B':
    case 'Commercial Office':
    case 'Hotel':
    case 'Management Rights':
      return 'standard';
    case 'Residential':
    case 'Settlement Adjustments':
      return 'margin-scheme';
    default:
      return 'margin-scheme';
  }
}

/**
 * Resolve the effective GST supply type for a rental/other income item.
 * Default is input-taxed (long-term residential rental, GSTA s.40-70).
 */
export function resolveIncomeSupplyType(item: RentalIncomeItem): GSTSupplyType {
  if (item.supplyType) return item.supplyType;
  return 'input-taxed';
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
