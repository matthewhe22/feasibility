/**
 * Groups competitor units by typology — bedrooms / bathrooms / study — and
 * averages price and $/m² within each group.
 *
 * This is the comparison that actually drives a feasibility: not what one unit
 * went for, but what a 2-bed/2-bath with a study is worth across the competing
 * villages. Rows whose price or area is unknown are excluded from the relevant
 * average rather than counted as zero, and each average reports how many units
 * it was actually computed from, so a single-sale "average" can't be mistaken
 * for a market rate.
 */
import type { UnitRow } from '../components/research/RetirementVillageResearch';
import { toNum, toBool } from '../components/research/RetirementVillageResearch';

export interface TypologyRow {
  /** e.g. "2 bed, 2 bath + study" */
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  study: boolean | null;
  /** Units in this typology (all of them, priced or not). */
  count: number;
  avgPrice: number | null;
  /** How many units the price average came from. */
  pricedCount: number;
  avgInternalSqm: number | null;
  /** Average of each unit's own $/m², over units having BOTH price and area. */
  avgDollarPerSqm: number | null;
  sqmCount: number;
}

function mean(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
}

function labelFor(bed: number | null, bath: number | null, study: boolean | null): string {
  const parts: string[] = [];
  parts.push(bed === null ? 'Beds n/a' : `${bed} bed`);
  parts.push(bath === null ? 'baths n/a' : `${bath} bath`);
  return `${parts.join(', ')}${study ? ' + study' : ''}`;
}

/**
 * One row per distinct bed/bath/study combination, ordered by bedrooms then
 * bathrooms (unknown-bedroom groups last) so the table reads like a schedule.
 */
export function summariseByTypology(units: UnitRow[]): TypologyRow[] {
  const groups = new Map<string, UnitRow[]>();
  for (const u of units) {
    const bed = toNum(u.bedrooms);
    const bath = toNum(u.bathrooms);
    const study = toBool(u.study);
    const key = `${bed ?? 'x'}|${bath ?? 'x'}|${study === true ? 's' : study === false ? 'n' : 'x'}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(u);
    else groups.set(key, [u]);
  }

  const rows: TypologyRow[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0];
    if (!first) continue;
    const bedrooms = toNum(first.bedrooms);
    const bathrooms = toNum(first.bathrooms);
    const study = toBool(first.study);

    const prices: number[] = [];
    const areas: number[] = [];
    const perSqm: number[] = [];
    for (const u of bucket) {
      const price = toNum(u.price);
      const area = toNum(u.internalSqm);
      if (price !== null && price > 0) prices.push(price);
      if (area !== null && area > 0) areas.push(area);
      // Average the per-unit rates, not price-average ÷ area-average: the
      // latter silently weights toward whichever units happened to publish an
      // area, and drifts from the real rate whenever the two sets differ.
      if (price !== null && price > 0 && area !== null && area > 0) perSqm.push(price / area);
    }

    rows.push({
      label: labelFor(bedrooms, bathrooms, study),
      bedrooms,
      bathrooms,
      study,
      count: bucket.length,
      avgPrice: mean(prices),
      pricedCount: prices.length,
      avgInternalSqm: mean(areas),
      avgDollarPerSqm: mean(perSqm),
      sqmCount: perSqm.length,
    });
  }

  return rows.sort((a, b) => {
    // Unknown bedroom counts sort last, then by beds, then baths.
    if (a.bedrooms === null && b.bedrooms !== null) return 1;
    if (b.bedrooms === null && a.bedrooms !== null) return -1;
    if ((a.bedrooms ?? 0) !== (b.bedrooms ?? 0)) return (a.bedrooms ?? 0) - (b.bedrooms ?? 0);
    if ((a.bathrooms ?? 0) !== (b.bathrooms ?? 0)) return (a.bathrooms ?? 0) - (b.bathrooms ?? 0);
    return Number(a.study) - Number(b.study);
  });
}
