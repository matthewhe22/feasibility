/**
 * Keeps RV competitor evidence inside the requested scope:
 *   - SOLD records: only those dated within the last 12 months. A sold record
 *     with no date is dropped too — it can't be shown to fall inside the window.
 *   - LISTINGS: every current listing, whatever its listing date.
 *   - Distance: rows the model placed beyond the proximity radius are dropped.
 *     Rows with no distance are kept, since there's nothing to test.
 *
 * The prompt asks for exactly this, but models still return older sales (the
 * sold-history pages they read go back years) and villages from directory pages
 * that list neighbouring areas. Enforcing it here guarantees the table, the
 * typology averages and the export all see the same in-scope rows.
 */

export interface CompetitorScopeNote {
  radiusKm: number;
  /** ISO yyyy-mm-dd — sold records before this date were excluded. */
  soldSince: string;
  excludedOldSales: number;
  excludedUndatedSales: number;
  excludedOutsideRadius: number;
}

/** `today` minus 12 months, as yyyy-mm-dd. */
export function soldCutoff(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * Normalise a record date to yyyy-mm-dd for comparison, or null when it has no
 * recognisable year and month. A month-only date ("2026-03") is taken as the
 * LAST day of that month, so a sale in the cutoff month itself is kept.
 */
export function comparableDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const day = m[3] ? Number(m[3]) : new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function scopeCompetitorUnits(
  units: unknown,
  radiusKm: number,
  today: Date = new Date(),
): { units: unknown; note: CompetitorScopeNote } {
  const note: CompetitorScopeNote = {
    radiusKm,
    soldSince: soldCutoff(today),
    excludedOldSales: 0,
    excludedUndatedSales: 0,
    excludedOutsideRadius: 0,
  };
  if (!Array.isArray(units)) return { units, note };

  const kept = units.filter(u => {
    if (!u || typeof u !== 'object') return true;
    const row = u as Record<string, unknown>;
    if (typeof row.distanceKm === 'number' && row.distanceKm > radiusKm) {
      note.excludedOutsideRadius++;
      return false;
    }
    if (row.priceType === 'sold') {
      const date = comparableDate(row.date);
      if (!date) { note.excludedUndatedSales++; return false; }
      if (date < note.soldSince) { note.excludedOldSales++; return false; }
    }
    return true;
  });
  return { units: kept, note };
}
