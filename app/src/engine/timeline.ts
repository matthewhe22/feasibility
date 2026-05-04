import type { Period, AdminConfig, MainInputs } from '../types';
import { excelDateToDate, addMonths, endOfMonth, daysBetween, formatMonthYear } from '../utils';

export function generateTimeline(admin: AdminConfig, inputs: MainInputs): Period[] {
  // Buffer past projectSpanMonths so settlements / income / PM-fee ITC lag that
  // extend slightly past the nominal span are still captured. Size dynamically
  // from the latest settlement / income end month so towers with deep settlement
  // tails aren't silently truncated, with a 10-month minimum and 24-month cap.
  const span = inputs.preliminary.projectSpanMonths;
  const lastGRVMonth = inputs.grvItems.reduce((m, g) => {
    if (!Number.isFinite(g.settlementMonth) || g.settlementMonth <= 0) return m;
    const end = g.settlementMonth + Math.max(1, g.settlementSpan || 1) - 1;
    return Math.max(m, end);
  }, 0);
  const lastIncomeMonth = inputs.rentalIncome.reduce((m, r) => {
    if (!Number.isFinite(r.monthStart) || r.monthStart <= 0) return m;
    const end = r.monthStart + Math.max(1, r.monthSpan || 1) - 1;
    return Math.max(m, end);
  }, 0);
  const itcLag = admin.itcRecoveryLagMonths ?? 0;
  const requiredEnd = Math.max(lastGRVMonth, lastIncomeMonth) + itcLag;
  const buffer = Math.min(24, Math.max(10, requiredEnd - span));
  const totalPeriods = span + buffer;
  const firstPeriodDate = excelDateToDate(inputs.preliminary.dateOfFirstPeriod);
  const lastActualsDate = excelDateToDate(admin.lastActualsPeriod);
  const periods: Period[] = [];

  for (let i = 0; i < totalPeriods; i++) {
    const startDate = addMonths(firstPeriodDate, i);
    startDate.setDate(1);
    const end = endOfMonth(startDate);
    const isActual = end <= lastActualsDate;

    periods.push({
      index: i,
      periodNumber: i + 1,
      startDate,
      endDate: end,
      daysInPeriod: daysBetween(startDate, end) + 1,
      isActual,
      isForecast: !isActual,
      label: formatMonthYear(startDate),
    });
  }

  return periods;
}
