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
 * Base map source: staticmap.openstreetmap.de — a long-standing free, no-API-
 * key static-map renderer built on OpenStreetMap data (one GET request returns
 * one composed PNG for a given center/zoom/size; no tile-stitching needed on
 * our end). Best-effort throughout: any failure (network, non-200, bad
 * content-type) returns null rather than throwing, so a suburb-pricing
 * response still succeeds without a map image.
 */
import sharp from 'sharp';

export interface MapPoint {
  suburb: string;
  lat: number;
  lng: number;
  medianHousePrice?: number | null;
}

const STATIC_MAP_URL = 'https://staticmap.openstreetmap.de/staticmap.php';
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`;
}

/**
 * Fetch a real OSM-based static map and composite suburb markers + MHP labels
 * onto it. Returns a PNG data URL, or null on any failure (best-effort).
 */
export async function buildSuburbMapImage(points: MapPoint[]): Promise<string | null> {
  const plottable = points.filter(p => isFinite(p.lat) && isFinite(p.lng));
  if (plottable.length === 0) return null;

  const centerLat = plottable.reduce((s, p) => s + p.lat, 0) / plottable.length;
  const centerLng = plottable.reduce((s, p) => s + p.lng, 0) / plottable.length;
  const zoom = pickZoom(plottable, centerLat, centerLng);

  const url = `${STATIC_MAP_URL}?center=${centerLat},${centerLng}&zoom=${zoom}&size=${WIDTH}x${HEIGHT}&maptype=mapnik`;

  let baseBuffer: Buffer;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('image')) return null;
    baseBuffer = Buffer.from(await resp.arrayBuffer());
  } catch {
    return null; // network error, timeout, or service down — degrade gracefully
  }

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
