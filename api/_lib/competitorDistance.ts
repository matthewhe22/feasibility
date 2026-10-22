import { geocodeAuSuburb, type LatLng } from './geocode';

/**
 * Checks competitor distances against real coordinates.
 *
 * The model's `distanceKm` is its own estimate — it has no coordinates — and
 * it often leaves the field empty, which let rows through the radius filter
 * untested. Here each row's suburb and the subject's suburb are geocoded
 * (OpenStreetMap, free, cached) and the centre-to-centre distance is used to:
 *   - fill a missing distance (marked `distanceBasis: 'suburb-centre'`), and
 *   - correct a model distance that puts a row inside the radius when its
 *     suburb is clearly outside it (beyond the radius + SUBURB_SLACK_KM).
 * The radius filter in competitorScope.ts then acts on real numbers.
 *
 * Suburb centres are approximate — a village near a suburb's edge can be a few
 * km off its centre — hence the slack before overriding the model.
 */

/** Allowance for a village sitting away from its suburb's centre. */
export const SUBURB_SLACK_KM = 3;
/** Distinct suburbs geocoded per request; Nominatim allows ~1 lookup/second. */
const MAX_SUBURBS = 8;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

type Geocoder = (suburb: string, state?: string, postcode?: string) => Promise<LatLng | null>;

/** The row's suburb: its own field, else the last part of the address. */
function rowSuburb(row: Record<string, unknown>): string | null {
  if (typeof row.suburb === 'string' && row.suburb.trim()) return row.suburb.trim();
  if (typeof row.address === 'string') {
    const parts = row.address.split(',').map(p => p.replace(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b|\d{4}/gi, '').trim()).filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1] ?? null;
  }
  return null;
}

export async function verifyCompetitorDistances(
  units: unknown,
  subject: { suburb?: string | undefined; state?: string | undefined; postcode?: string | undefined },
  radiusKm: number,
  geocode: Geocoder = geocodeAuSuburb,
): Promise<{ units: unknown; checked: number; corrected: number }> {
  if (!Array.isArray(units) || !subject.suburb) return { units, checked: 0, corrected: 0 };
  const origin = await geocode(subject.suburb, subject.state, subject.postcode).catch(() => null);
  if (!origin) return { units, checked: 0, corrected: 0 };

  const suburbs = [...new Set(
    units
      .map(u => (u && typeof u === 'object' ? rowSuburb(u as Record<string, unknown>) : null))
      .filter((s): s is string => Boolean(s))
      .map(s => s.toLowerCase()),
  )].slice(0, MAX_SUBURBS);

  const coords = new Map<string, LatLng | null>();
  for (const s of suburbs) coords.set(s, await geocode(s, subject.state).catch(() => null));

  let checked = 0;
  let corrected = 0;
  const out = units.map(u => {
    if (!u || typeof u !== 'object') return u;
    const row = u as Record<string, unknown>;
    const sub = rowSuburb(row)?.toLowerCase();
    const at = sub ? coords.get(sub) : null;
    if (!at) return row;
    checked++;
    const d = Math.round(haversineKm(origin, at) * 10) / 10;
    if (typeof row.distanceKm !== 'number') return { ...row, distanceKm: d, distanceBasis: 'suburb-centre' };
    if (row.distanceKm <= radiusKm && d > radiusKm + SUBURB_SLACK_KM) {
      corrected++;
      return { ...row, distanceKm: d, distanceBasis: 'suburb-centre' };
    }
    return row;
  });
  return { units: out, checked, corrected };
}
