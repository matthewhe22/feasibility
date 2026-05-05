import type { Period, AdminConfig, MainInputs } from '../types';
import { excelDateToDate, addMonths, endOfMonth, daysBetween, formatMonthYear } from '../utils';

/**
 * Generate the period array used by the engine.
 *
 * Horizon = inputs.preliminary.projectSpanMonths exactly. The legacy +10
 * buffer caused the cashflow tab to render 10 trailing zero-only months
 * (UAT v2 issue #6 / Melbourne UAT C1). If a settlement or other event
 * is configured beyond projectSpanMonths, the engine and dashboard already
 * surface that as a Checks-tab "Last settlement month" finding rather than
 * silently extending the horizon.
 */
export function generateTimeline(admin: AdminConfig, inputs: MainInputs): Period[] {
  const totalPeriods = Math.max(1, inputs.preliminary.projectSpanMonths);
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
