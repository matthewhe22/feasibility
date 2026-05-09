// Excel serial date to JS Date (UTC-anchored, TZ-stable).
//
// Dandenong B2 — the prior implementation used `new Date(1899, 11, 30)`
// which is a LOCAL-timezone construction. Round-tripping via
// `epoch.getTime() + serial * 86400000` and then reading the date back
// with local getMonth() / getFullYear() worked correctly for serial
// values in the standard range, but became fragile across DST transitions
// when the result was further mutated via `addMonths` / `setMonth` over
// many periods (the timeline iterates i = 0..N for cashflow labels, and
// each setMonth call can pick up DST drift in TZs that change offsets in
// the resulting year).
//
// Switching to a UTC-anchored epoch and reading dates back via UTC
// methods eliminates DST + historical-TZ drift entirely. Excel itself has
// no concept of timezones — its serials are wall-clock day counts — so
// UTC is the correct semantic match.
//
// Verified Excel-serial → calendar date mapping:
//   45017 → Apr 1, 2023 (default dateOfFirstPeriod)
//   46388 → Jan 1, 2027
//   46478 → Apr 1, 2027
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

export function excelDateToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC_MS + serial * 86400000);
}

// JS Date to Excel serial. Round-trip-stable with `excelDateToDate` for
// any serial in the supported range.
export function dateToExcelSerial(d: Date): number {
  return Math.round((d.getTime() - EXCEL_EPOCH_UTC_MS) / 86400000);
}

// Format date as "Mon-YY". Reads the UTC month / year so the label is
// stable across timezones — pairs with the UTC-anchored converter so a
// serial always renders the same wall-clock month label everywhere.
export function formatMonthYear(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

// Format currency
export function formatCurrency(value: number, decimals = 0): string {
  if (value === 0) return '$0';
  const absVal = Math.abs(value);
  const formatted = absVal.toLocaleString('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

// Format as millions
export function formatMillions(value: number, decimals = 1): string {
  return `$${(value / 1_000_000).toFixed(decimals)}M`;
}

// Format an IRR value with project-loss awareness. When the project profit
// (or any sign-aware "is the deal making money?" indicator) is negative, the
// IRR solver result is mathematically undefined or only matches the equity
// cashflow series in a degenerate way — Newton-Raphson typically converges to a
// large garbage value that the ±999% clip then surfaces as ">999.00%". This is
// misleading: it suggests an exceptional return when in fact the project is
// loss-making. Return "N/M (loss)" instead so the dashboard truthfully reports
// "not meaningful". Box Hill UAT bug 2.
export function formatIRR(irr: number, totalProfit: number): string {
  if (!Number.isFinite(irr)) return 'N/A';
  if (totalProfit < 0) return 'N/M (loss)';
  return formatPercent(irr);
}

// Format percentage. Values outside ±999% are clipped for display so an
// IRR solver that diverges (e.g. 5e+42% on a loss-making project — UAT v2 #17 /
// Melbourne UAT Dh3) never produces an unreadable e+N display. The underlying
// numeric value is unchanged for any downstream calculation.
export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return 'N/A';
  const CLIP = 9.99;        // ±999% in decimal
  if (value >  CLIP) return `>${(CLIP * 100).toFixed(decimals)}%`;
  if (value < -CLIP) return `<-${(CLIP * 100).toFixed(decimals)}%`;
  return `${(value * 100).toFixed(decimals)}%`;
}

// Format number with commas
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Add months to a date — UTC-stable. Pairs with the UTC-anchored
// excelDateToDate so iterating period labels via addMonths(firstDate, i)
// never picks up DST drift mid-iteration.
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

// Get end of month (UTC).
export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

// Get start of month (UTC).
export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// Days between two dates
export function daysBetween(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

// Clamp value
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Sum array
export function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

/**
 * Safe numeric array indexing — returns the element or 0 when out of bounds.
 * Lets per-period engine math compile cleanly under `noUncheckedIndexedAccess`
 * without sprinkling `?? 0` across hundreds of array reads.
 */
export function at(arr: number[], i: number): number {
  return arr[i] ?? 0;
}

/**
 * Safe array indexing for non-numeric arrays — returns the element or undefined.
 * Forces callers to handle the missing case explicitly.
 */
export function get<T>(arr: ReadonlyArray<T>, i: number): T | undefined {
  return arr[i];
}

// IRR calculation using Newton-Raphson method
export function calculateIRR(cashflows: number[], guess = 0.1, maxIter = 1000, tolerance = 1e-7): number {
  if (cashflows.length === 0) return 0;

  // All-zero cashflows → no return
  if (cashflows.every(cf => cf === 0)) return 0;

  // All same sign → no IRR exists (need at least one sign change)
  const hasPositive = cashflows.some(cf => cf > 0);
  const hasNegative = cashflows.some(cf => cf < 0);
  if (!hasPositive || !hasNegative) return 0;

  let rate = guess;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const cft = cashflows[t] ?? 0;
      const factor = Math.pow(1 + rate, t);
      npv += cft / factor;
      dnpv -= (t * cft) / (factor * (1 + rate));
    }

    if (Math.abs(npv) < tolerance) break;

    // Guard: derivative is zero or not finite
    if (dnpv === 0 || !isFinite(dnpv)) return 0;

    const newRate = rate - npv / dnpv;

    // Guard: result is not finite or rate collapsed below -100%
    if (!isFinite(newRate) || newRate <= -1) {
      // Bisect toward 0 to recover
      rate = rate > 0 ? rate / 2 : -rate / 2;
      continue;
    }

    if (Math.abs(newRate - rate) < tolerance) {
      rate = newRate;
      break;
    }
    rate = newRate;
  }

  if (!isFinite(rate) || rate <= -1) return 0;

  // Convert monthly to annual
  return Math.pow(1 + rate, 12) - 1;
}
