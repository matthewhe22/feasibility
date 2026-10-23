import type { ReaProfileFigures } from './reaSuburbProfile';
import { suburbSlug } from './rvDirectories';
import { toMoney } from './normalizeUnits';

/**
 * Validates RV suburb-pricing rows against the realestate.com.au suburb-profile
 * pages fetched live for this request, and reports the result.
 *
 * The profile figures are the answer (see reaSuburbProfile.ts): every row with
 * a profile is overwritten with the page's figures, and any figure the model
 * reported differently is recorded as a correction, so a reader can see that
 * the model's own number was checked and what it was replaced with. Rows with
 * no profile are left as the model gave them and listed as unverified. A
 * profile whose period ends more than STALE_MONTHS before today is listed as
 * stale.
 */

export const STALE_MONTHS = 4;

export interface SuburbCorrection {
  suburb: string;
  field: 'medianHousePrice' | 'medianUnitPrice';
  /** What the model reported. */
  aiValue: number;
  /** What the suburb-profile page publishes (null = not published). */
  pageValue: number | null;
}

export interface SuburbValidation {
  /** ISO timestamp of the check (the profile pages were fetched for this request). */
  checkedAt: string;
  suburbs: number;
  /** Rows whose MHP/MUP were read from their suburb-profile page. */
  verified: number;
  /** Suburbs with no readable profile page — figures are the model's own. */
  unverified: string[];
  corrections: SuburbCorrection[];
  /** Suburbs whose profile period ends more than STALE_MONTHS ago. */
  stale: string[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Months between the END of a period like "September 2025 - September 2026" and today. */
export function monthsSincePeriodEnd(period: string | null, today: Date): number | null {
  if (!period) return null;
  const m = /([A-Za-z]+)\s+(\d{4})\s*$/.exec(period.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  if (month < 0) return null;
  return (today.getUTCFullYear() - Number(m[2])) * 12 + (today.getUTCMonth() - month);
}

export function validateSuburbRows(
  rows: unknown[],
  profiles: Map<string, ReaProfileFigures>,
  today: Date = new Date(),
): { rows: unknown[]; validation: SuburbValidation } {
  const validation: SuburbValidation = {
    checkedAt: today.toISOString(),
    suburbs: 0,
    verified: 0,
    unverified: [],
    corrections: [],
    stale: [],
  };

  const out = rows.map(r => {
    if (!r || typeof r !== 'object') return r;
    const row = r as Record<string, unknown>;
    const name = String(row.suburb ?? '');
    validation.suburbs++;
    const f = profiles.get(suburbSlug(name));
    if (!f) {
      validation.unverified.push(name);
      return { ...row, verified: false, mhpSource: 'web search (no suburb profile found)' };
    }
    validation.verified++;

    for (const field of ['medianHousePrice', 'medianUnitPrice'] as const) {
      const ai = toMoney(row[field]);
      const page = f[field];
      if (ai !== null && ai !== page) validation.corrections.push({ suburb: name, field, aiValue: ai, pageValue: page });
    }
    const age = monthsSincePeriodEnd(f.housePeriod, today);
    if (age !== null && age > STALE_MONTHS) validation.stale.push(name);

    return {
      ...row,
      medianHousePrice: f.medianHousePrice,
      // The page is the only source: no published unit median means none, not
      // a figure the model found elsewhere.
      medianUnitPrice: f.medianUnitPrice,
      asOf: f.housePeriod ?? row.asOf ?? null,
      houseGrowth12mPct: f.houseGrowth12mPct,
      medianHousePrice12mAgo: null, // re-derived from the page's growth
      mhpSource: 'realestate.com.au suburb profile',
      profileUrl: f.url,
      verified: true,
    };
  });
  return { rows: out, validation };
}
