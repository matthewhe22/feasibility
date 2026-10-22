/**
 * Keeps RV competitor evidence inside the requested scope:
 *   - SOLD records: only those dated within the last 12 months. A sold record
 *     with no published date is KEPT (the page simply didn't show one) and
 *     flagged "date not published" in its note, so a reader can weigh it.
 *   - LISTINGS: every current listing, whatever its listing date.
 *   - Distance: rows the model placed beyond the proximity radius are dropped.
 *     Rows with no distance are kept, since there's nothing to test.
 *   - The SUBJECT village's own units are dropped — this is competitor evidence.
 *   - Rentals (weekly rent, rental villages) are dropped: they aren't ingoing
 *     prices and would drag the typology averages down.
 *   - The same unit listed on two sites (villages.com.au + downsizing.com.au
 *     carry many of the same agent listings) is merged into one row.
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
  /** Sales kept although no date was published — flagged in their note. */
  undatedSalesKept: number;
  excludedOutsideRadius: number;
  /** Rows belonging to the subject village itself. */
  excludedSubject: number;
  /** Weekly-rent / rental-village rows. */
  excludedRentals: number;
  /** Rows merged into another row describing the same unit. */
  duplicatesMerged: number;
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
  subjectVillageName?: string,
): { units: unknown; note: CompetitorScopeNote } {
  const note: CompetitorScopeNote = {
    radiusKm,
    soldSince: soldCutoff(today),
    excludedOldSales: 0,
    undatedSalesKept: 0,
    excludedOutsideRadius: 0,
    excludedSubject: 0,
    excludedRentals: 0,
    duplicatesMerged: 0,
  };
  if (!Array.isArray(units)) return { units, note };

  const kept: unknown[] = [];
  for (const u of units) {
    if (!u || typeof u !== 'object') { kept.push(u); continue; }
    const row = u as Record<string, unknown>;
    if (isRental(row)) {
      note.excludedRentals++;
      continue;
    }
    if (subjectVillageName && sameVillage(String(row.villageName ?? ''), subjectVillageName)) {
      note.excludedSubject++;
      continue;
    }
    if (typeof row.distanceKm === 'number' && row.distanceKm > radiusKm) {
      note.excludedOutsideRadius++;
      continue;
    }
    if (row.priceType === 'sold') {
      const date = comparableDate(row.date);
      if (!date) {
        note.undatedSalesKept++;
        const existing = typeof row.note === 'string' ? row.note : '';
        kept.push(/date not published/i.test(existing)
          ? row
          : { ...row, note: existing ? `${existing} — sale date not published` : 'Sale date not published' });
        continue;
      }
      if (date < note.soldSince) { note.excludedOldSales++; continue; }
    }
    kept.push(row);
  }
  const deduped = dedupeUnits(kept);
  note.duplicatesMerged = kept.length - deduped.length;
  return { units: deduped, note };
}

/* ── Rentals ─────────────────────────────────────────────────────────────── */

/** No retirement unit's ingoing price is under this; a figure below it is a
 *  weekly or monthly rent. */
const MIN_INGOING_PRICE = 20000;

export function isRental(row: Record<string, unknown>): boolean {
  if (typeof row.tenure === 'string' && /\brent/i.test(row.tenure)) return true;
  if (typeof row.price === 'number' && row.price > 0 && row.price < MIN_INGOING_PRICE) return true;
  return [row.unitType, row.note].some(v => typeof v === 'string' && /\bper\s+week\b|\bp\.?w\.?\b|\/\s*week\b/i.test(v));
}

/* ── Village-name matching ───────────────────────────────────────────────── */

/** Words that say what a place is rather than which one it is, plus operator
 *  brands — "Australian Unity Elderslee" and "Elderslee Retirement Community"
 *  are the same village. */
const GENERIC_NAME_WORDS = new Set([
  'retirement', 'village', 'villages', 'community', 'communities', 'resort', 'lifestyle', 'living',
  'estate', 'the', 'at', 'by', 'and', 'of', 'over', '50s', '55s', 'over50s', 'over55s', 'residences',
  'australian', 'unity', 'aveo', 'keyton', 'lendlease', 'stockland', 'levande', 'retireaustralia',
  'irt', 'ryman', 'anglicare', 'bolton', 'clarke', 'uniting', 'southern', 'cross', 'care', 'gemlife',
  'ingenia', 'opal', 'baptistcare', 'whiddon', 'mercy', 'catholic', 'healthcare',
]);

export function villageCore(name: string): Set<string> {
  return new Set(
    name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !GENERIC_NAME_WORDS.has(w)),
  );
}

/**
 * True when two village names refer to the same village: identical
 * distinctive words, or one's distinctive words all appear in the other
 * (as long as that isn't a single short, ambiguous word).
 */
export function sameVillage(a: string, b: string): boolean {
  const x = villageCore(a);
  const y = villageCore(b);
  if (!x.size || !y.size) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (![...small].every(w => big.has(w))) return false;
  return small.size > 1 || [...small][0]!.length >= 4;
}

/* ── Cross-site duplicates ───────────────────────────────────────────────── */

/** "61/15 Bias Ave" / "Unit 61/15" / unitNumber "61" → "61/15" or "61". */
function unitId(row: Record<string, unknown>): string | null {
  for (const v of [row.unitNumber, row.address]) {
    if (typeof v !== 'string') continue;
    const m = /^\s*(?:unit|villa|apartment|apt|u)?\s*(\d+[a-z]?)\s*(?:\/\s*(\d+[a-z]?))?/i.exec(v);
    if (m?.[1] && (v === row.unitNumber || m[2])) return (m[2] ? `${m[1]}/${m[2]}` : m[1]).toLowerCase();
  }
  return null;
}

function sameUnitId(a: string, b: string): boolean {
  if (a === b) return true;
  // "61" vs "61/15": one side omitted the street number.
  if (a.includes('/') !== b.includes('/')) return a.split('/')[0] === b.split('/')[0];
  return false;
}

/** "61/15 Bias Avenue" → "15 bias". */
function streetKey(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const rest = address.replace(/^\s*(?:unit|villa|apartment|apt|u)?\s*\d+[a-z]?\s*\/\s*/i, '');
  const m = /(\d+[a-z]?)(?:\s*-\s*\d+)?\s+([a-z]+)/i.exec(rest);
  return m ? `${m[1]} ${m[2]}`.toLowerCase() : null;
}

function host(row: Record<string, unknown>): string {
  const url = typeof row.sourceUrl === 'string' ? row.sourceUrl : '';
  const m = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(url);
  return (m?.[1] ?? (typeof row.source === 'string' ? row.source : '')).toLowerCase();
}

function samePlace(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const sa = streetKey(a.address);
  const sb = streetKey(b.address);
  if (sa && sb && sa === sb) return true;
  return sameVillage(String(a.villageName ?? ''), String(b.villageName ?? ''));
}

/**
 * Two rows describe the same unit when they're the same kind of record at the
 * same place and either carry the same unit number, or — where a unit number
 * is missing — come from DIFFERENT sites with the same price and bedrooms.
 * Rows from one site without unit numbers are never merged: a village often
 * has two vacancies at the same price.
 */
export function isSameUnit(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a.priceType !== b.priceType || !samePlace(a, b)) return false;
  const ia = unitId(a);
  const ib = unitId(b);
  if (ia && ib) return sameUnitId(ia, ib);
  const priced = typeof a.price === 'number' && a.price === b.price;
  const beds = a.bedrooms == null || b.bedrooms == null || a.bedrooms === b.bedrooms;
  return priced && beds && host(a) !== host(b);
}

export function dedupeUnits(rows: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') { out.push(r); continue; }
    const row = r as Record<string, unknown>;
    const match = out.find((o): o is Record<string, unknown> =>
      Boolean(o) && typeof o === 'object' && isSameUnit(o as Record<string, unknown>, row));
    if (!match) { out.push({ ...row }); continue; }
    // Fill gaps from the duplicate; never overwrite a value already present.
    for (const [k, v] of Object.entries(row)) {
      if (v != null && v !== '' && (match[k] == null || match[k] === '')) match[k] = v;
    }
    const other = host(row);
    if (other && other !== host(match)) {
      const existing = typeof match.note === 'string' ? match.note : '';
      if (!existing.includes(other)) match.note = existing ? `${existing} — also listed on ${other}` : `Also listed on ${other}`;
    }
  }
  return out;
}
