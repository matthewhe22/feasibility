import type { Period, AdminConfig, MainInputs } from '../types';
import { excelDateToDate, addMonths, endOfMonth, daysBetween, formatMonthYear } from '../utils';

export function generateTimeline(admin: AdminConfig, inputs: MainInputs): Period[] {
  const totalPeriods = inputs.preliminary.projectSpanMonths + 10; // extra buffer
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
