/**
 * Real static map image (with actual OSM map tile background — roads, coastline,
 * place names) for the RV Research suburb map, generated server-side.
 *
 * Why server-side rather than the client compositing a screenshot of the
 * in-app Leaflet map: OpenStreetMap's tile images are cross-origin and the
 * public tile servers don't send CORS headers, so any browser <canvas> a tile
 * gets drawn onto is "tainted" and canvas.toDataURL() throws — client-side
 * screenshot capture (html2canvas et al.) cannot reliably produce a usable
 * image. None of that applies server-side: Node's fetch has no CORS concept,
 * so the base map tile can be fetched directly, and our own suburb markers +
 * "Suburb: MHP" labels are composited on top with `sharp` (SVG overlay), all
 * server-side, then shipped to the client as one finished PNG (data URL) —
 * used both by the in-app map and embedded directly into the Excel export.
 *
 * Base map source: OpenStreetMap's standard raster tiles
 * (tile.openstreetmap.org/{z}/{x}/{y}.png) — the SAME endpoint the in-app
 * Leaflet map already renders from, stitched here into one image. Earlier this
 * used the single-shot staticmap.openstreetmap.de renderer instead; that's one
 * small community service and a single point of failure, whereas the tile
 * endpoint is the canonical one this app already depends on. It's kept as a
 * secondary fallback below. Best-effort throughout: any failure (network,
 * non-200, bad content-type) returns null rather than throwing, so a
 * suburb-pricing response still succeeds without a map image.
 *
 * Tile volume per request is a dozen or so — the same handful a browser fetches
 * to render one map view, well inside OSM's tile usage policy, and sent with an
 * identifying User-Agent as that policy requires.
 */
import sharp from 'sharp';

export interface MapPoint {
  suburb: string;
  lat: number;
  lng: number;
  medianHousePrice?: number | null;
}

const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const STATIC_MAP_URL = 'https://staticmap.openstreetmap.de/staticmap.php';
/** Identifies the app per OSM's tile usage policy — deliberately no personal contact info. */
const USER_AGENT = 'kk-feaso-model-app/1.0 (retirement-village research map)';
const TILE_SIZE = 256;
const WIDTH = 640;
const HEIGHT = 420;
const PADDING = 60; // px kept clear at the edges so markers/labels aren't clipped

/** Web Mercator world-pixel X/Y for a lat/lng at a given zoom (standard slippy-map projection). */
function mercatorPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const worldSize = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * worldSize;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

/** Highest zoom (bounded 3..16) at which every point's bounding box still fits
 *  within the image, minus padding. */
function pickZoom(points: MapPoint[], centerLat: number, centerLng: number): number {
  for (let zoom = 16; zoom >= 3; zoom--) {
    const center = mercatorPixel(centerLat, centerLng, zoom);
    const fits = points.every(p => {
      const px = mercatorPixel(p.lat, p.lng, zoom);
      return Math.abs(px.x - center.x) <= WIDTH / 2 - PADDING && Math.abs(px.y - center.y) <= HEIGHT / 2 - PADDING;
    });
    if (fits) return zoom;
  }
  return 3;
}

function money(v?: number | null): string {
  return typeof v === 'number' && isFinite(v) ? `$${Math.round(v).toLocaleString('en-AU')}` : '—';
}

function colorFor(price: number | null | undefined, min: number, max: number): string {
  if (typeof price !== 'number' || !isFinite(price) || max <= min) return '#7c3aed';
  const t = (price - min) / (max - min);
  return `hsl(${200 - t * 190}, 75%, 42%)`;
}

/**
 * Reject geocoding outliers before they set the view.
 *
 * These suburbs are all meant to be within ~5-8 km of each other, so a single
 * bad Nominatim match (a same-named suburb in another state, say) both drops a
 * pin in the wrong place AND forces `pickZoom` to zoom out far enough to fit
 * it — wrecking the framing for every other suburb. Anything more than
 * MAX_SPREAD_KM from the median point is dropped.
 */
const MAX_SPREAD_KM = 50;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function rejectOutliers(points: MapPoint[]): MapPoint[] {
  if (points.length < 3) return points; // too few to tell an outlier from the group
  const medLat = median(points.map(p => p.lat));
  const medLng = median(points.map(p => p.lng));
  const kept = points.filter(p => haversineKm(medLat, medLng, p.lat, p.lng) <= MAX_SPREAD_KM);
  return kept.length ? kept : points;
}

async function fetchImage(url: string, timeoutMs = 8000): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/png,image/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    if (!(resp.headers.get('content-type') ?? '').includes('image')) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Stitch the OSM tiles covering the WIDTH x HEIGHT viewport centred on
 * (centerLat, centerLng) at `zoom` into one base-map image.
 *
 * Tiles are composited onto a canvas sized to the whole tile grid (so every
 * offset is non-negative — sharp rejects negative composite offsets) and the
 * exact viewport is then extracted out of it. Returns null if no tile could be
 * fetched; a partial grid (some tiles missing) still renders, just with gaps.
 */
async function fetchStitchedTiles(centerLat: number, centerLng: number, zoom: number): Promise<Buffer | null> {
  const center = mercatorPixel(centerLat, centerLng, zoom);
  const left = center.x - WIDTH / 2;
  const top = center.y - HEIGHT / 2;

  const minTileX = Math.floor(left / TILE_SIZE);
  const maxTileX = Math.floor((left + WIDTH - 1) / TILE_SIZE);
  const minTileY = Math.floor(top / TILE_SIZE);
  const maxTileY = Math.floor((top + HEIGHT - 1) / TILE_SIZE);
  const tilesPerAxis = 2 ** zoom;

  const jobs: Array<Promise<{ buf: Buffer | null; left: number; top: number }>> = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      // Wrap X around the antimeridian; Y outside the world is simply absent.
      const wrappedX = ((tx % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
      const offsetLeft = (tx - minTileX) * TILE_SIZE;
      const offsetTop = (ty - minTileY) * TILE_SIZE;
      if (ty < 0 || ty >= tilesPerAxis) continue;
      jobs.push(
        fetchImage(TILE_URL(zoom, wrappedX, ty)).then(buf => ({ buf, left: offsetLeft, top: offsetTop })),
      );
    }
  }

  const tiles = await Promise.all(jobs);
  const usable = tiles.filter((t): t is { buf: Buffer; left: number; top: number } => t.buf !== null);
  if (usable.length === 0) return null;

  const gridWidth = (maxTileX - minTileX + 1) * TILE_SIZE;
  const gridHeight = (maxTileY - minTileY + 1) * TILE_SIZE;

  try {
    const grid = await sharp({
      create: { width: gridWidth, height: gridHeight, channels: 4, background: { r: 233, g: 231, b: 225, alpha: 1 } },
    })
      .composite(usable.map(t => ({ input: t.buf, left: t.left, top: t.top })))
      .png()
      .toBuffer();

    // Extract the exact viewport out of the stitched grid.
    return await sharp(grid)
      .extract({
        left: Math.round(left - minTileX * TILE_SIZE),
        top: Math.round(top - minTileY * TILE_SIZE),
        width: WIDTH,
        height: HEIGHT,
      })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** One suburb's marker, already projected to pixel coordinates within the image. */
export interface SuburbMapMarker {
  x: number;
  y: number;
  label: string;
  color: string;
}

/** The map handed to the client: base tiles as an image, markers as data. */
export interface SuburbMapData {
  /** Stitched OSM tiles as a PNG data URL — no text drawn on it. */
  image: string;
  markers: SuburbMapMarker[];
  attribution: string;
  width: number;
  height: number;
}

/**
 * Build a real OSM map for these suburbs: stitched tiles as an image, plus the
 * marker positions/labels as DATA for the client to draw.
 *
 * Labels are deliberately NOT drawn here. `sharp` renders SVG text through
 * librsvg/fontconfig, which needs system fonts — and serverless runtimes
 * (Vercel/Lambda) ship none, so every glyph came out as a tofu box □□□ in the
 * exported map. (It rendered fine in local testing precisely because a dev
 * machine has fonts, which is what hid the bug.) Rather than bundling a font
 * and a fontconfig setup that can't be verified outside the deployed runtime,
 * the client draws the text: it has real browser fonts, and drawing this
 * base image costs nothing in canvas-tainting terms because it arrives as a
 * same-origin `data:` URL rather than a cross-origin tile.
 *
 * Returns null on any failure (best-effort — the caller falls back to a
 * schematic).
 */
export async function buildSuburbMapImage(points: MapPoint[]): Promise<SuburbMapData | null> {
  const plottable = rejectOutliers(points.filter(p => isFinite(p.lat) && isFinite(p.lng)));
  if (plottable.length === 0) return null;

  const centerLat = plottable.reduce((s, p) => s + p.lat, 0) / plottable.length;
  const centerLng = plottable.reduce((s, p) => s + p.lng, 0) / plottable.length;
  const zoom = pickZoom(plottable, centerLat, centerLng);

  // Primary: stitch OSM's own tiles. Fallback: the single-shot static-map
  // renderer, in case the tile endpoint is unreachable from this environment.
  let baseBuffer = await fetchStitchedTiles(centerLat, centerLng, zoom);
  if (!baseBuffer) {
    baseBuffer = await fetchImage(
      `${STATIC_MAP_URL}?center=${centerLat},${centerLng}&zoom=${zoom}&size=${WIDTH}x${HEIGHT}&maptype=mapnik`,
    );
  }
  if (!baseBuffer) return null;

  try {
    const png = await sharp(baseBuffer).resize(WIDTH, HEIGHT, { fit: 'cover' }).png().toBuffer();

    const center = mercatorPixel(centerLat, centerLng, zoom);
    const prices = plottable.map(p => p.medianHousePrice).filter((p): p is number => typeof p === 'number' && isFinite(p));
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;

    const markers: SuburbMapMarker[] = plottable.map(p => {
      const px = mercatorPixel(p.lat, p.lng, zoom);
      return {
        x: px.x - center.x + WIDTH / 2,
        y: px.y - center.y + HEIGHT / 2,
        label: `${p.suburb}: ${money(p.medianHousePrice)}`,
        color: colorFor(p.medianHousePrice, minPrice, maxPrice),
      };
    });

    return {
      image: `data:image/png;base64,${png.toString('base64')}`,
      markers,
      // OSM's tile licence requires visible attribution wherever the tiles are
      // shown — the client draws this onto the image.
      attribution: '© OpenStreetMap contributors',
      width: WIDTH,
      height: HEIGHT,
    };
  } catch {
    return null; // malformed base image or processing failure
  }
}
