import type { CostLineItem, Period } from '../types';

// Generate S-curve weights for N-month build
function buildSCurveWeights(months: number): number[] {
  if (months <= 0) return [];
  const weights: number[] = [];
  // Bell-shaped: ramp up then ramp down
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
export function getSCurveWeights(sCurve: string, span: number, manualSCurves?: number[][]): number[] {
  if (sCurve === 'Evenly Split') {
    return evenSplitWeights(span);
  }
  const buildMatch = sCurve.match(/^(\d+) Month Build$/);
  if (buildMatch) {
    const buildMonths = parseInt(buildMatch[1]);
    return buildSCurveWeights(buildMonths);
  }
  // Manual S-curves — use configured weights if available, else fall back to even split
  if (sCurve.startsWith('Manual S-curve') && manualSCurves) {
    const num = parseInt(sCurve.replace('Manual S-curve ', '')) - 1; // 0-indexed
    const curveWeights = manualSCurves[num];
    if (curveWeights && curveWeights.length > 0) {
      const total = curveWeights.reduce((a, b) => a + b, 0);
      if (total > 0) return curveWeights.map(w => w / total);
    }
  }
  return evenSplitWeights(span);
}

// Spread a cost item across periods
export function spreadCost(item: CostLineItem, periods: Period[], manualSCurves?: number[][]): number[] {
  const result = new Array(periods.length).fill(0);
  if (item.totalCosts === 0 || item.monthSpan <= 0) return result;

  const startIdx = item.monthStart - 1; // Convert 1-based to 0-based
  const span = item.monthSpan;
  const weights = getSCurveWeights(item.sCurve, span, manualSCurves);

  for (let i = 0; i < weights.length; i++) {
    const periodIdx = startIdx + i;
    if (periodIdx >= 0 && periodIdx < periods.length) {
      result[periodIdx] = item.totalCosts * weights[i];
    }
  }
  return result;
}

// Spread multiple cost items and sum
export function spreadCosts(items: CostLineItem[], periods: Period[], manualSCurves?: number[][]): number[] {
  const result = new Array(periods.length).fill(0);
  for (const item of items) {
    const spread = spreadCost(item, periods, manualSCurves);
    for (let i = 0; i < result.length; i++) {
      result[i] += spread[i];
    }
  }
  return result;
}

// Spread land payment stages
export function spreadLandPayments(
  stages: { amount: number; monthStart: number; monthSpan: number }[],
  periods: Period[]
): number[] {
  const result = new Array(periods.length).fill(0);
  for (const stage of stages) {
    if (stage.amount === 0 || stage.monthSpan <= 0 || stage.monthStart <= 0) continue;
    const startIdx = stage.monthStart - 1;
    const perMonth = stage.amount / stage.monthSpan;
    for (let i = 0; i < stage.monthSpan; i++) {
      const idx = startIdx + i;
      if (idx >= 0 && idx < periods.length) {
        result[idx] += perMonth;
      }
    }
  }
  return result;
}
