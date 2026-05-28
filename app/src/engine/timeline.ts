import type { Period, AdminConfig, MainInputs } from '../types';
import { excelDateToDate, addMonths, endOfMonth, daysBetween, formatMonthYear } from '../utils';

/**
 * Generate the period array used by the engine.
 *
 * Horizon = max(inputs.preliminary.projectSpanMonths, last event month).
 *
 * History:
 *   v1: projectSpanMonths + 10 buffer — caused trailing zero-only months
 *       on Cashflow tab (UAT v2 issue #6 / Melbourne UAT C1).
 *   v2: projectSpanMonths exactly — fixed trailing zeros but silently
 *       dropped events (settlements / construction spans / payment stages)
 *       configured beyond span. On Brisbane mid-rise UAT this destroyed
 *       $112.8M of revenue (FAIL: GRV inputs $112.8M vs cashflow settlements $0).
 *   v3 (this fix, B03): take max(projectSpanMonths, last-event-month). The
 *       events the user has actually configured govern the horizon. The
 *       Checks-tab "Last settlement month" surface still warns the user
 *       that span < event so their settings are inconsistent — but data
 *       integrity is preserved instead of being silently dropped.
 */
function lastConfiguredEventMonth(inputs: MainInputs): number {
  let m = 0;
  // Revenue settlements (and their span)
  for (const g of inputs.grvItems ?? []) {
    if (typeof g.settlementMonth !== 'number' || g.settlementMonth <= 0) continue;
    const span = Math.max(1, (g as { settlementSpan?: number }).settlementSpan ?? 1);
    m = Math.max(m, g.settlementMonth + span - 1);
  }
  // Land payment stages + acquisition costs (both spread by spreadLandPayments)
  const landStageGroups = [
    inputs.landPurchase?.paymentStages,
    inputs.landPurchase?.acquisitionCosts,
  ];
  for (const grp of landStageGroups) {
    for (const s of grp ?? []) {
      if (typeof s.monthStart !== 'number' || s.monthStart <= 0) continue;
      const span = Math.max(1, s.monthSpan ?? 1);
      m = Math.max(m, s.monthStart + span - 1);
    }
  }
  // Rental / other income streams (spread by spreadIncome over monthStart+span).
  // Omitting these truncated income configured past the cost/settlement horizon,
  // silently dropping its tail from the cashflow — the same class of bug the v3
  // settlement fix addressed.
  for (const grp of [inputs.rentalIncome, inputs.otherIncome]) {
    for (const r of grp ?? []) {
      if (typeof r.monthStart !== 'number' || r.monthStart <= 0) continue;
      const span = Math.max(1, r.monthSpan ?? 1);
      m = Math.max(m, r.monthStart + span - 1);
    }
  }
  // Construction / development / marketing / other costs / PM fees / financing
  const costGroups = [
    inputs.constructionCosts, inputs.developmentCosts, inputs.marketingCosts,
    inputs.otherStandardCosts, inputs.pmFees, inputs.otherFinancingCosts,
  ];
  for (const grp of costGroups) {
    for (const c of grp ?? []) {
      if (typeof c.monthStart !== 'number' || c.monthStart <= 0) continue;
      const span = Math.max(1, c.monthSpan ?? 1);
      m = Math.max(m, c.monthStart + span - 1);
    }
  }
  // PRSV uplift (land)
  const prsvMonth = inputs.landPurchase?.prsvMonth ?? 0;
  const prsvSpan = inputs.landPurchase?.prsvSpan ?? 0;
  if (prsvMonth > 0) m = Math.max(m, prsvMonth + Math.max(0, prsvSpan - 1));
  return m;
}

export function generateTimeline(admin: AdminConfig, inputs: MainInputs): Period[] {
  const requestedSpan = Math.max(1, inputs.preliminary.projectSpanMonths);
  const lastEvent = lastConfiguredEventMonth(inputs);
  const totalPeriods = Math.max(requestedSpan, lastEvent);
  const firstPeriodDate = excelDateToDate(inputs.preliminary.dateOfFirstPeriod);
  const lastActualsDate = excelDateToDate(admin.lastActualsPeriod);
  const periods: Period[] = [];

  for (let i = 0; i < totalPeriods; i++) {
    const startDate = addMonths(firstPeriodDate, i);
    startDate.setUTCDate(1);
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
