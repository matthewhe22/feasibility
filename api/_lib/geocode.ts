/**
 * Free suburb geocoding via OpenStreetMap's Nominatim search API — no API key.
 *
 * Used to place suburbs on a real map (lat/lng) for RV Research's
 * surrounding-suburb pricing map. Nominatim's usage policy caps the public
 * instance at ~1 request/second and requires an identifying User-Agent, so
 * results are cached indefinitely in-process (a suburb's coordinates never
 * change) and lookups are issued strictly one at a time with a short gap.
 *
 * Best-effort: every failure returns null rather than throwing, so a
 * geocoding miss just drops that one suburb from the map instead of failing
 * the whole research request.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Identifies the app to Nominatim per their usage policy — not a secret, and
// deliberately has no personal contact info in it (a generic app identifier
// is all their policy actually requires).
const USER_AGENT = 'kk-feaso-model-app/1.0 (retirement-village research feature)';
const MIN_GAP_MS = 1100;

const cache = new Map<string, LatLng | null>();
let lastRequestAt = 0;

function cacheKey(suburb: string, state?: string): string {
  return `${suburb.trim().toLowerCase()}|${(state ?? '').trim().toLowerCase()}`;
}

async function throttle(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Geocode one Australian suburb to lat/lng. Returns null on any failure or
 *  no match — never throws. Results are cached in-process indefinitely. */
export async function geocodeAuSuburb(suburb: string, state?: string): Promise<LatLng | null> {
  const key = cacheKey(suburb, state);
  if (cache.has(key)) return cache.get(key) ?? null;

  await throttle();
  const q = [suburb, state, 'Australia'].filter(Boolean).join(', ');
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=au&q=${encodeURIComponent(q)}`;

  let result: LatLng | null = null;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (resp.ok) {
      const json = (await resp.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = Array.isArray(json) ? json[0] : undefined;
      const lat = hit?.lat ? Number(hit.lat) : NaN;
      const lng = hit?.lon ? Number(hit.lon) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) result = { lat, lng };
    }
  } catch {
    /* best-effort — leave result null */
  }

  cache.set(key, result);
  return result;
}

/** Geocode several suburbs sequentially (Nominatim allows ~1 req/sec on the
 *  public instance) and return a map keyed the same way callers pass names
 *  in — the caller matches by index, not by this function re-deriving keys. */
export async function geocodeAuSuburbs(
  suburbs: Array<{ suburb: string; state?: string }>,
): Promise<Array<LatLng | null>> {
  const out: Array<LatLng | null> = [];
  for (const s of suburbs) out.push(await geocodeAuSuburb(s.suburb, s.state));
  return out;
}
