// Excel serial date to JS Date
export function excelDateToDate(serial: number): Date {
  const epoch = new Date(1899, 11, 30);
  return new Date(epoch.getTime() + serial * 86400000);
}

// JS Date to Excel serial
export function dateToExcelSerial(d: Date): number {
  const epoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

// Format date as "Mon-YY"
export function formatMonthYear(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
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

// Format percentage
export function formatPercent(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

// Format number with commas
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Add months to a date
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// Get end of month
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// Get start of month
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
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
