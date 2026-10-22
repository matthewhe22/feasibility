/**
 * Section-1 (surrounding-suburb pricing) derivations shared by the RV Research
 * table and its Excel export: MHP growth and the indicative averages.
 */
import type { SuburbRow, SuburbsResult } from '../components/research/RetirementVillageResearch';
import { toNum } from '../components/research/RetirementVillageResearch';

/** Mean of the real numbers in `xs`, or null when there are none. */
export const avg = (xs: Array<number | null | undefined>) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/**
 * MHP growth over 12 or 6 months. The server derives it from the two prices
 * (api/_lib/normalizeUnits.ts); this repeats the derivation for responses
 * cached before that, and otherwise falls back to the published percentage.
 */
export function houseGrowth(s: SuburbRow, period: '12m' | '6m'): number | null {
  const current = toNum(s.medianHousePrice);
  const prior = toNum(period === '12m' ? s.medianHousePrice12mAgo : s.medianHousePrice6mAgo);
  if (current !== null && prior !== null && current > 0 && prior > 0) return Math.round((current / prior - 1) * 1000) / 10;
  return toNum(period === '12m' ? s.houseGrowth12mPct : s.houseGrowth6mPct);
}

/** Section-1 averages, preferring the model's where it gave them. */
export function suburbAverages(r: SuburbsResult) {
  const rows = r.suburbs ?? [];
  return {
    mhp: toNum(r.averages?.avgMedianHousePrice) ?? avg(rows.map(s => toNum(s.medianHousePrice))),
    mup: toNum(r.averages?.avgMedianUnitPrice) ?? avg(rows.map(s => toNum(s.medianUnitPrice))),
    psm: toNum(r.averages?.avgDollarPerSqm) ?? avg(rows.map(s => toNum(s.medianDollarPerSqm))),
    mhp12mAgo: avg(rows.map(s => toNum(s.medianHousePrice12mAgo))),
    mhp6mAgo: avg(rows.map(s => toNum(s.medianHousePrice6mAgo))),
    growth12m: avg(rows.map(s => houseGrowth(s, '12m'))),
    growth6m: avg(rows.map(s => houseGrowth(s, '6m'))),
  };
}
