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

// IRR calculation using Newton-Raphson method
export function calculateIRR(cashflows: number[], guess = 0.1, maxIter = 1000, tolerance = 1e-7): number {
  if (cashflows.length === 0) return 0;

  let rate = guess;
  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + rate, t);
      npv += cashflows[t] / factor;
      dnpv -= (t * cashflows[t]) / (factor * (1 + rate));
    }
    if (Math.abs(npv) < tolerance) break;
    if (dnpv === 0) break;
    rate = rate - npv / dnpv;
  }

  // Convert monthly to annual
  return Math.pow(1 + rate, 12) - 1;
}
