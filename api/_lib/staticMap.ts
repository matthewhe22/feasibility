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

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Builds the SVG overlay (markers + "Suburb: MHP" labels) positioned by real
 *  Web Mercator projection so it lines up with the fetched base map. */
function buildOverlaySvg(points: MapPoint[], centerLat: number, centerLng: number, zoom: number): string {
  const center = mercatorPixel(centerLat, centerLng, zoom);
  const prices = points.map(p => p.medianHousePrice).filter((p): p is number => typeof p === 'number' && isFinite(p));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  const parts: string[] = [];
  for (const p of points) {
    const px = mercatorPixel(p.lat, p.lng, zoom);
    const x = px.x - center.x + WIDTH / 2;
    const y = px.y - center.y + HEIGHT / 2;
    const color = colorFor(p.medianHousePrice, minPrice, maxPrice);
    const label = `${p.suburb}: ${money(p.medianHousePrice)}`;
    const textWidth = label.length * 6.2 + 8; // monospace-ish estimate, good enough for a background box
    const boxX = Math.min(Math.max(x + 10, 4), WIDTH - textWidth - 4);

    parts.push(
      `<circle cx="${x}" cy="${y}" r="6" fill="${color}" stroke="#1f2937" stroke-width="1.5" />`,
      `<rect x="${boxX - 3}" y="${y - 9}" width="${textWidth}" height="18" fill="rgba(255,255,255,0.9)" rx="2" />`,
      `<text x="${boxX}" y="${y + 4}" font-family="Arial, sans-serif" font-size="12" fill="#111827">${escapeXml(label)}</text>`,
    );
  }

  // OSM's tile usage / licensing terms require visible attribution wherever the
  // tiles are displayed — including this image once it's embedded in Excel.
  const attribution = '© OpenStreetMap contributors';
  const attrWidth = attribution.length * 5.4 + 8;
  parts.push(
    `<rect x="${WIDTH - attrWidth - 4}" y="${HEIGHT - 18}" width="${attrWidth}" height="14" fill="rgba(255,255,255,0.75)" />`,
    `<text x="${WIDTH - attrWidth}" y="${HEIGHT - 8}" font-family="Arial, sans-serif" font-size="9" fill="#374151">${attribution}</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`;
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

/**
 * Build a real OSM map image for these suburbs and composite the markers +
 * MHP labels onto it. Returns a PNG data URL, or null on any failure
 * (best-effort — the caller falls back to a schematic).
 */
export async function buildSuburbMapImage(points: MapPoint[]): Promise<string | null> {
  const plottable = points.filter(p => isFinite(p.lat) && isFinite(p.lng));
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
    const overlay = buildOverlaySvg(plottable, centerLat, centerLng, zoom);
    const composed = await sharp(baseBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover' })
      .composite([{ input: Buffer.from(overlay) }])
      .png()
      .toBuffer();
    return `data:image/png;base64,${composed.toString('base64')}`;
  } catch {
    return null; // malformed base image or compositing failure
  }
}
