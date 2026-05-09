import type { CostLineItem, CostLineVariance, Period } from '../types';

// Collect warnings for empty S-curve fallbacks — reset per engine run via clearSCurveWarnings()
const _sCurveWarnings: Set<string> = new Set();

export function clearSCurveWarnings(): void {
  _sCurveWarnings.clear();
}

export function getSCurveWarnings(): string[] {
  return Array.from(_sCurveWarnings);
}

// Generate S-curve weights for N-month build (parabolic bell, used as fallback)
function buildSCurveWeightsFallback(months: number): number[] {
  if (months <= 0) return [];
  const weights: number[] = [];
  const mid = months / 2;
  let sum = 0;
  for (let i = 0; i < months; i++) {
    const dist = Math.abs(i - mid) / mid;
    const w = 1 - dist * dist; // parabolic
    weights.push(w);
    sum += w;
  }
  return weights.map(w => w / sum);
}

// Evenly split across span
function evenSplitWeights(span: number): number[] {
  if (span <= 0) return [];
  return Array(span).fill(1 / span);
}

// Get weights for a given S-curve type
// buildSCurves: user-defined weights keyed by build duration (12–60)
export function getSCurveWeights(
  sCurve: string,
  span: number,
  manualSCurves?: number[][],
  buildSCurves?: Record<number, number[]>,
): number[] {
  if (sCurve === 'Evenly Split') {
    return evenSplitWeights(span);
  }
  const buildMatch = sCurve.match(/^(\d+) Month Build$/);
  if (buildMatch) {
    const buildMonths = parseInt(buildMatch[1] ?? '0');
    // Check user-defined curve first
    if (buildSCurves) {
      const userCurve = buildSCurves[buildMonths];
      if (userCurve && userCurve.length > 0) {
        const total = userCurve.reduce((a, b) => a + b, 0);
        if (total > 0) return userCurve.map(w => w / total);
      }
      // User defined curve exists but is empty — warn and fall back
      if (buildSCurves[buildMonths] !== undefined) {
        _sCurveWarnings.add(
          `"${sCurve}" has no weights defined — falling back to parabolic approximation.`
        );
      }
    }
    return buildSCurveWeightsFallback(buildMonths);
  }
  // Manual S-curves — use configured weights if available, else fall back to even split.
  //
  // Truncate to `span` and renormalise — matches the contract of Evenly Split
  // and N Month Build, both of which return exactly `span` weights summing to
  // 1. Without truncation, weights past `span` would be silently dropped by
  // the spreading loop in spreadCost(), producing a feasibility-vs-waterfall
  // wedge equal to the dropped portion of the curve. Kew Demo Extra carried
  // a $3.47M residual under that asymmetry — Architects et al referenced a
  // 75-element manual curve while the cost item only ran 27 months.
  if (sCurve.startsWith('Manual S-curve') && manualSCurves) {
    const num = parseInt(sCurve.replace('Manual S-curve ', '')) - 1; // 0-indexed
    const curveWeights = manualSCurves[num];
    if (curveWeights && curveWeights.length > 0) {
      const truncated = curveWeights.slice(0, span);
      const total = truncated.reduce((a, b) => a + b, 0);
      if (total > 0) return truncated.map(w => w / total);
      // total === 0 — all in-window weights are zero. Warn and fall through
      // to even split so the item still reaches the cashflow with the right
      // nominal.
      _sCurveWarnings.add(
        `"${sCurve}" has no in-window weights for span=${span} — falling back to even split.`
      );
    } else {
      // Curve missing or empty — warn
      _sCurveWarnings.add(
        `"${sCurve}" has no weights defined — falling back to even split.`
      );
    }
  }
  return evenSplitWeights(span);
}

// Spread a cost item across periods, blending per-period actuals with S-curve forecast.
//
// For actual periods: use item.actuals[periodIdx] if defined, else 0.
// For forecast periods: distribute remaining budget (totalCosts - sum(actuals))
//   using the normalised S-curve weights for forecast periods within the item's span.
export function spreadCost(
  item: CostLineItem,
  periods: Period[],
  manualSCurves?: number[][],
  buildSCurves?: Record<number, number[]>,
): number[] {
  const result = new Array(periods.length).fill(0);
  if (!Number.isFinite(item.totalCosts) || item.totalCosts === 0) return result;
  if (!Number.isFinite(item.monthSpan) || item.monthSpan <= 0) return result;
  if (!Number.isFinite(item.monthStart) || item.monthStart <= 0) return result;

  const startIdx = item.monthStart - 1; // Convert 1-based to 0-based
  const span = Math.max(1, Math.floor(item.monthSpan));

  // If the item has per-period actuals, use them for actual periods and
  // redistribute the remaining budget over forecast periods.
  if (item.actuals && item.actuals.some(v => v != null && v > 0)) {
    let actualTotal = 0;
    for (let i = 0; i < periods.length; i++) {
      if (periods[i]?.isActual) {
        const actual = item.actuals[i] ?? 0;
        result[i] = actual;
        actualTotal += actual;
      }
    }
    const remainingBudget = item.totalCosts - actualTotal;
    if (remainingBudget > 0) {
      // Get full S-curve weights for the span
      const allWeights = getSCurveWeights(item.sCurve, span, manualSCurves, buildSCurves);
      // Collect weights for forecast periods within the item's span
      const forecastEntries: { periodIdx: number; weight: number }[] = [];
      for (let wi = 0; wi < allWeights.length; wi++) {
        const periodIdx = startIdx + wi;
        if (periodIdx >= 0 && periodIdx < periods.length && !periods[periodIdx]?.isActual) {
          forecastEntries.push({ periodIdx, weight: allWeights[wi] ?? 0 });
        }
      }
      const weightSum = forecastEntries.reduce((s, e) => s + e.weight, 0);
      if (weightSum > 0) {
        for (const { periodIdx, weight } of forecastEntries) {
          result[periodIdx] = remainingBudget * weight / weightSum;
        }
      }
    }
    return result;
  }

  // Standard S-curve spreading (no actuals defined)
  const weights = getSCurveWeights(item.sCurve, span, manualSCurves, buildSCurves);
  for (let i = 0; i < weights.length; i++) {
    const periodIdx = startIdx + i;
    if (periodIdx >= 0 && periodIdx < periods.length) {
      result[periodIdx] = item.totalCosts * (weights[i] ?? 0);
    }
  }
  return result;
}

// Spread multiple cost items and sum
export function spreadCosts(
  items: CostLineItem[],
  periods: Period[],
  manualSCurves?: number[][],
  buildSCurves?: Record<number, number[]>,
): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    const spread = spreadCost(item, periods, manualSCurves, buildSCurves);
    for (let i = 0; i < result.length; i++) {
      result[i] += spread[i] ?? 0;
    }
  }
  return result;
}

/**
 * Compute cost-to-date (ctd) and cost-to-complete (ctc) for a single cost line item.
 * ctd = sum of actuals[i] for every period where isActual is true.
 * ctc = max(0, totalCosts − ctd).
 */
export function computeCtdCtc(item: CostLineItem, periods: Period[]): { ctd: number; ctc: number } {
  let ctd = 0;
  if (item.actuals) {
    for (let i = 0; i < periods.length; i++) {
      if (periods[i]?.isActual) ctd += item.actuals[i] ?? 0;
    }
  }
  return { ctd, ctc: Math.max(0, item.totalCosts - ctd) };
}

/** Build a CostLineVariance array for a set of cost items. */
export function buildCostVariance(items: CostLineItem[], periods: Period[]): CostLineVariance[] {
  return items.map(item => {
    const { ctd, ctc } = computeCtdCtc(item, periods);
    return {
      code: item.code,
      description: item.description,
      budget: item.totalCosts,
      ctd,
      ctc,
      varianceToDate: ctd - item.totalCosts,
    };
  });
}

// Spread land payment stages
export function spreadLandPayments(
  stages: { amount: number; monthStart: number; monthSpan: number }[],
  periods: Period[]
): number[] {
  const result = new Array(periods.length).fill(0);
  for (const stage of stages) {
    if (!Number.isFinite(stage.amount) || stage.amount === 0) continue;
    if (!Number.isFinite(stage.monthSpan) || stage.monthSpan <= 0) continue;
    if (!Number.isFinite(stage.monthStart) || stage.monthStart <= 0) continue;
    const startIdx = stage.monthStart - 1;
    const span = Math.min(stage.monthSpan, periods.length);
    const perMonth = stage.amount / span;
    for (let i = 0; i < span; i++) {
      const idx = startIdx + i;
      if (idx >= 0 && idx < periods.length) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}
