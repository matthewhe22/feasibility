/**
 * Coerce the numeric fields of an AI-returned competitor unit into real numbers.
 *
 * Models routinely emit numeric JSON fields as strings, and often with the unit
 * or a qualifier attached: `"internalSqm": "85"`, `"85 m²"`, `"approx. 85 sqm"`,
 * `"price": "$1,150,000"`, `"bedrooms": "2"`. The UI and the Excel export both
 * test `typeof x === 'number'`, so every one of those was silently rendering as
 * an em dash — which is why the internal-area and $/m² columns came back empty
 * even when the model had actually found the figure.
 *
 * Normalising here (server-side, once) rather than at each render point means
 * the table, the $/m² derivation and the spreadsheet all see the same clean
 * numbers.
 */

/** First number in a value. Handles thousands separators and leading qualifiers
 *  ("approx. 85", "~85", "80-90" → 80). Returns null when there's no number. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const match = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ''));
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Like toNumber, but honours a `k`/`M` magnitude suffix — listings write
 * "$1.15M" as often as "$1,150,000".
 *
 * The suffix is ignored when it's actually the start of an area unit, so
 * "85 m²" stays 85 and does not become 85 million.
 */
export function toMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/,/g, '');
  const match = /(-?\d+(?:\.\d+)?)\s*([kKmM])?/.exec(s);
  if (!match || match[1] === undefined) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;

  const suffix = match[2];
  if (!suffix) return n;
  // "85 m²" / "85 m2" — the m belongs to the unit, not to a magnitude.
  const rest = s.slice(match.index + match[0].length);
  if (/^\s*[²2]/.test(rest)) return n;
  return suffix.toLowerCase() === 'm' ? n * 1_000_000 : n * 1_000;
}

/** "Yes"/"No"/"true"/"false" → boolean; anything unrecognised → null. */
export function toBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

/**
 * Normalise every numeric/boolean field on each competitor unit, leaving all
 * other fields untouched. Non-array input is returned as-is so a malformed
 * response can't break the request.
 */
export function normalizeUnitRows(units: unknown): unknown {
  if (!Array.isArray(units)) return units;
  return units.map(u => {
    if (!u || typeof u !== 'object') return u;
    const row = u as Record<string, unknown>;
    return {
      ...row,
      price: toMoney(row.price),
      recurringFee: toMoney(row.recurringFee),
      distanceKm: toNumber(row.distanceKm),
      bedrooms: toNumber(row.bedrooms),
      bathrooms: toNumber(row.bathrooms),
      carSpaces: toNumber(row.carSpaces),
      internalSqm: toNumber(row.internalSqm),
      landSqm: toNumber(row.landSqm),
      study: toBoolean(row.study),
    };
  });
}

/** The same treatment for suburb-pricing rows. */
export function normalizeSuburbRows(suburbs: unknown): unknown {
  if (!Array.isArray(suburbs)) return suburbs;
  return suburbs.map(s => {
    if (!s || typeof s !== 'object') return s;
    const row = s as Record<string, unknown>;
    return {
      ...row,
      medianHousePrice: toMoney(row.medianHousePrice),
      medianUnitPrice: toMoney(row.medianUnitPrice),
      medianDollarPerSqm: toMoney(row.medianDollarPerSqm),
      distanceKm: toNumber(row.distanceKm),
    };
  });
}
